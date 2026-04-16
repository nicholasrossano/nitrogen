"""API endpoints for the unified staged module workflow.

Every module is an ordered sequence of confirmable stages. These endpoints
drive the ModuleWorkspace frontend component. Each endpoint operates on a
ModuleInstance identified by its UUID.

Mounted at: /api/v1/module-workflow
"""

from __future__ import annotations

import logging
import re
import uuid as _uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.auth import get_current_user, AuthUser
from app.core.database import get_db
from app.core.permissions import require_viewer, require_editor
from app.models.initiative import Initiative
from app.models.module_instance import ModuleInstance, ModuleInstanceStatus
from app.modules.base import BaseModule
from app.modules.registry import get_module_registry
from app.modules.utils import make_build_item
from app.services import module_service
from app.services.module_workflow_service import (
    build_deliverable_title,
    build_workflow_state,
    confirm_stage,
    enrich_record_item,
    ensure_workflow_state,
    get_initiative_context,
    populate_stage,
    save_workflow_state,
    uses_workspace_flow,
    _build_initial_workflow_state,
    _infer_current_stage_id,
    _is_legacy_state,
    _migrate_legacy_state,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_workflow_instance(
    db: AsyncSession,
    instance_id: _uuid.UUID,
    user: AuthUser,
) -> tuple[ModuleInstance, BaseModule]:
    inst = await db.get(ModuleInstance, instance_id)
    if inst is None:
        raise HTTPException(status_code=404, detail="Module instance not found")

    await require_viewer(db, inst.initiative_id, user)

    registry = get_module_registry()
    module = registry.get_module(inst.module_id)
    if module is None or not uses_workspace_flow(module):
        raise HTTPException(
            status_code=400,
            detail=f"Module '{inst.module_id}' is not configured for workspace flow",
        )
    return inst, module


async def _get_editable_workflow_instance(
    db: AsyncSession,
    instance_id: _uuid.UUID,
    user: AuthUser,
) -> tuple[ModuleInstance, BaseModule]:
    inst = await db.get(ModuleInstance, instance_id)
    if inst is None:
        raise HTTPException(status_code=404, detail="Module instance not found")

    await require_editor(db, inst.initiative_id, user)

    registry = get_module_registry()
    module = registry.get_module(inst.module_id)
    if module is None or not uses_workspace_flow(module):
        raise HTTPException(
            status_code=400,
            detail=f"Module '{inst.module_id}' is not configured for workspace flow",
        )
    return inst, module


def _module_definition_payload(module: BaseModule) -> dict[str, Any]:
    """Build the module definition payload returned with workflow state."""
    return {
        "id": module.definition.id,
        "name": module.definition.name,
        "icon": module.definition.icon,
        "output_type": module.definition.output_type,
        "export_format": module.definition.export_format,
        "stage_defs": [s.to_dict() for s in module.stage_defs],
    }


def _get_stage_state_or_404(
    state: dict[str, Any],
    stage_id: str,
    instance_id: Any,
) -> dict[str, Any]:
    stage_state = state["stages"].get(stage_id)
    if stage_state is None:
        raise HTTPException(
            status_code=404,
            detail=f"Stage '{stage_id}' not found on instance {instance_id}",
        )
    return stage_state


def _get_stage_def_or_404(
    module: BaseModule,
    stage_id: str,
    instance_id: Any,
) -> Any:
    stage_def = next((s for s in module.stage_defs if s.id == stage_id), None)
    if stage_def is None:
        raise HTTPException(
            status_code=404,
            detail=f"Stage '{stage_id}' not defined in module for instance {instance_id}",
        )
    return stage_def


# ---------------------------------------------------------------------------
# GET state
# ---------------------------------------------------------------------------

@router.get("/module-workflow/{instance_id}/state")
async def get_workflow_state(
    instance_id: _uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Return the full workflow state for a module instance plus its module definition."""
    inst, module = await _get_workflow_instance(db, instance_id, user)
    state = await ensure_workflow_state(db, inst, module)
    await db.commit()

    return {
        "instance_id": str(instance_id),
        "module_id": inst.module_id,
        "status": inst.status,
        "workflow_state": state,
        "module_definition": _module_definition_payload(module),
    }


# ---------------------------------------------------------------------------
# Stage population
# ---------------------------------------------------------------------------

@router.post("/module-workflow/{instance_id}/stages/{stage_id}/populate")
async def populate_stage_endpoint(
    instance_id: _uuid.UUID,
    stage_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Run the population pipeline for a stage.

    Executes the stage's declared population steps in order.
    Sets stage status to 'draft' when complete (awaiting user confirmation).
    """
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)
    _get_stage_def_or_404(module, stage_id, instance_id)

    state = await populate_stage(db, inst, module, stage_id)
    await db.commit()

    return {
        "stage_id": stage_id,
        "stage_state": state["stages"][stage_id],
        "workflow_state": state,
    }


# ---------------------------------------------------------------------------
# Stage confirmation
# ---------------------------------------------------------------------------

@router.post("/module-workflow/{instance_id}/stages/{stage_id}/confirm")
async def confirm_stage_endpoint(
    instance_id: _uuid.UUID,
    stage_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Confirm a stage with a full audit trail.

    Records confirmed_by (user uid) and confirmed_at timestamp.
    Resets any downstream stages that depend on this one.
    If the next stage is a computed_results stage that reads from this stage,
    auto-triggers its population pipeline.
    """
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)
    _get_stage_state_or_404(state, stage_id, instance_id)

    state, auto_populate_def = await confirm_stage(
        db, inst, module, stage_id, confirmed_by=user.uid
    )
    save_workflow_state(inst, state)

    inst.status = ModuleInstanceStatus.GENERATING
    await db.commit()

    # Auto-populate next computed stage if applicable (e.g. LCOE results after inputs confirmed)
    if auto_populate_def is not None:
        try:
            state = await populate_stage(db, inst, module, auto_populate_def.id)
            await db.commit()
        except Exception as e:
            logger.error(
                "Auto-population of stage '%s' failed after confirming '%s': %s",
                auto_populate_def.id, stage_id, e, exc_info=True,
            )

    return {
        "stage_id": stage_id,
        "stage_state": state["stages"][stage_id],
        "workflow_state": state,
    }


# ---------------------------------------------------------------------------
# Stage data editing (items / rows)
# ---------------------------------------------------------------------------

class EditItemRequest(BaseModel):
    content: dict[str, Any]


@router.patch("/module-workflow/{instance_id}/stages/{stage_id}/items/{item_id}")
async def edit_item(
    instance_id: _uuid.UUID,
    stage_id: str,
    item_id: str,
    data: EditItemRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Edit an item's content in a list or table stage."""
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)
    stage_state = _get_stage_state_or_404(state, stage_id, instance_id)

    stage_data = stage_state.get("data") or {}
    items = stage_data.get("items", [])
    item_idx = next((i for i, it in enumerate(items) if it["id"] == item_id), None)
    if item_idx is None:
        raise HTTPException(status_code=404, detail="Item not found")

    items[item_idx]["content"] = data.content
    items[item_idx]["origin"] = "user edited"
    if "provenance" not in items[item_idx]:
        items[item_idx]["provenance"] = {}
    items[item_idx]["provenance"]["derivation"] = "user_edited"
    stage_data["items"] = items
    stage_state["data"] = stage_data
    save_workflow_state(inst, state)
    await db.commit()

    return {"item": items[item_idx]}


class AddItemRequest(BaseModel):
    content: dict[str, Any]


@router.post("/module-workflow/{instance_id}/stages/{stage_id}/items")
async def add_item(
    instance_id: _uuid.UUID,
    stage_id: str,
    data: AddItemRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Add a new manually-authored item to a list or table stage."""
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)
    stage_state = _get_stage_state_or_404(state, stage_id, instance_id)

    stage_data = stage_state.get("data") or {"items": []}
    new_item = make_build_item(content=data.content, derivation="provided")
    stage_data.setdefault("items", []).append(new_item)
    stage_state["data"] = stage_data
    if stage_state.get("status") == "pending":
        stage_state["status"] = "draft"

    save_workflow_state(inst, state)
    await db.commit()

    return {"item": new_item}


@router.delete("/module-workflow/{instance_id}/stages/{stage_id}/items/{item_id}")
async def delete_item(
    instance_id: _uuid.UUID,
    stage_id: str,
    item_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Remove an item from a list or table stage."""
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)
    stage_state = _get_stage_state_or_404(state, stage_id, instance_id)

    stage_data = stage_state.get("data") or {}
    items = stage_data.get("items", [])
    original_len = len(items)
    items = [it for it in items if it["id"] != item_id]
    if len(items) == original_len:
        raise HTTPException(status_code=404, detail="Item not found")

    stage_data["items"] = items
    stage_state["data"] = stage_data
    save_workflow_state(inst, state)
    await db.commit()

    return {"ok": True, "remaining_count": len(items)}


class ReorderItemsRequest(BaseModel):
    item_ids: list[str]


@router.post("/module-workflow/{instance_id}/stages/{stage_id}/reorder")
async def reorder_items(
    instance_id: _uuid.UUID,
    stage_id: str,
    data: ReorderItemsRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Reorder items in a list or table stage."""
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)
    stage_state = _get_stage_state_or_404(state, stage_id, instance_id)

    stage_data = stage_state.get("data") or {}
    items = stage_data.get("items", [])
    id_to_item = {it["id"]: it for it in items}
    reordered = [id_to_item[iid] for iid in data.item_ids if iid in id_to_item]
    mentioned = set(data.item_ids)
    reordered.extend(it for it in items if it["id"] not in mentioned)

    stage_data["items"] = reordered
    stage_state["data"] = stage_data
    save_workflow_state(inst, state)
    await db.commit()

    return {"ok": True}


# ---------------------------------------------------------------------------
# Record enrichment (detail panel / record stages)
# ---------------------------------------------------------------------------

@router.post("/module-workflow/{instance_id}/stages/{stage_id}/records/{item_id}/enrich")
async def enrich_record_endpoint(
    instance_id: _uuid.UUID,
    stage_id: str,
    item_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """AI-enrich a single record in a record-component stage.

    The item_id refers to the source item from the prior list stage.
    Calls module.enrich_record() and persists the enriched field values.
    """
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)

    enriched = await enrich_record_item(db, inst, module, stage_id, item_id)
    await db.commit()

    return {"item_id": item_id, "record": enriched}


class UpdateRecordRequest(BaseModel):
    fields: dict[str, Any]


@router.patch("/module-workflow/{instance_id}/stages/{stage_id}/records/{item_id}")
async def update_record(
    instance_id: _uuid.UUID,
    stage_id: str,
    item_id: str,
    data: UpdateRecordRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Update field values for a single record in a record-component stage."""
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)
    stage_state = _get_stage_state_or_404(state, stage_id, instance_id)

    stage_data = stage_state.get("data") or {}
    records = stage_data.get("records", {})
    existing = records.get(item_id, {})
    existing.update(data.fields)
    records[item_id] = existing
    stage_data["records"] = records
    stage_state["data"] = stage_data
    save_workflow_state(inst, state)
    await db.commit()

    return {"item_id": item_id, "record": records[item_id]}


# ---------------------------------------------------------------------------
# Widget-state persistence (compatibility shim for chat-path widgets)
# ---------------------------------------------------------------------------
# The chat-path versions of LCOEModelWidget / CarbonModelWidget /
# SolarEstimateWidget call persistModuleWorkflowWidget() when the user edits
# a value inline. That function POSTs the full widget_data blob here.
# We write it to the first computed_results stage's data.

class WidgetStateRequest(BaseModel):
    widget_data: dict[str, Any]


@router.post("/module-workflow/{instance_id}/widget-state")
async def persist_widget_state(
    instance_id: _uuid.UUID,
    data: WidgetStateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Persist widget_data into the first computed_results stage of the instance.

    Compatibility shim for chat-path calculator widgets that call
    api.persistModuleWorkflowWidget() after an inline edit.
    """
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)
    state = await ensure_workflow_state(db, inst, module)

    # Find the first computed_results stage
    target_stage_def = next(
        (s for s in module.stage_defs if s.component == "computed_results"),
        None,
    )
    if target_stage_def is None:
        raise HTTPException(
            status_code=400,
            detail="This module has no computed_results stage to write widget data to",
        )

    stage_state = state["stages"].setdefault(target_stage_def.id, {
        "status": "pending",
        "confirmed_at": None,
        "confirmed_by": None,
        "data": None,
    })
    stage_data = stage_state.get("data") or {}
    stage_data["widget_data"] = data.widget_data
    stage_state["data"] = stage_data
    if stage_state.get("status") == "pending":
        stage_state["status"] = "draft"

    save_workflow_state(inst, state)
    await db.commit()

    return {
        "instance_id": str(instance_id),
        "status": inst.status,
        "workflow_state": state,
    }


# ---------------------------------------------------------------------------
# Export endpoint (generates artifact on demand from confirmed stage data)
# ---------------------------------------------------------------------------

@router.get("/module-workflow/{instance_id}/export")
async def export_module_output(
    instance_id: _uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Generate and download the module export artifact from confirmed stage data.

    For assessment modules: generates DOCX via module.generate_export().
    For calculator modules: generates XLSX via module.generate_export().

    The document is synthesized on demand — nothing is stored.
    """
    from app.core.filename_utils import safe_content_disposition

    inst, module = await _get_workflow_instance(db, instance_id, user)

    if module.definition.export_format is None:
        raise HTTPException(status_code=400, detail="This module does not support export")

    state = await ensure_workflow_state(db, inst, module)
    context = await get_initiative_context(db, inst.initiative_id)

    # Build confirmed_stages snapshot
    confirmed_stages: dict[str, Any] = {
        sid: s for sid, s in state["stages"].items()
        if s.get("status") == "confirmed"
    }

    if not confirmed_stages:
        raise HTTPException(
            status_code=400,
            detail="At least one stage must be confirmed before exporting",
        )

    try:
        export_bytes = await module.generate_export(confirmed_stages, context)
    except NotImplementedError:
        raise HTTPException(
            status_code=400,
            detail=f"Module '{module.definition.id}' does not implement generate_export()",
        )

    fmt = module.definition.export_format
    media_types = {
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
    media_type = media_types.get(fmt, "application/octet-stream")

    initiative = await db.get(Initiative, inst.initiative_id)
    initiative_title = initiative.title if initiative else "Export"
    safe_title = re.sub(r"[^\w\s\-.]", "_", f"{module.definition.name}_{initiative_title}").replace(" ", "_")[:60]

    return Response(
        content=export_bytes,
        media_type=media_type,
        headers={"Content-Disposition": safe_content_disposition(f"{safe_title}.{fmt}")},
    )
