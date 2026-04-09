"""API endpoints for the multi-stage module workflow (Setup / Build / Output).

These endpoints drive the ModuleWorkspace frontend component. Each endpoint
operates on a ModuleInstance identified by its UUID.

The build stage is represented as ``workflow_state.build.stages[]`` — an ordered
array where each entry has ``id``, ``name``, ``stage_type``, ``status``, and
type-specific fields (``widget_data`` for widget stages, ``items`` for list stages).

Mounted at: /api/v1/module-workflow
"""

from __future__ import annotations

import logging
import re
import uuid as _uuid
from datetime import datetime, timezone
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
from app.modules.assessment_base import BaseAssessmentModule, get_build_stage, layers_as_dict, make_build_item
from app.services import module_service
from app.services.module_workflow_service import (
    build_deliverable_title,
    ensure_workflow_state,
    get_workspace_setup_fields,
    get_initiative_context,
    persist_widget_stage_state,
    save_workflow_state,
    uses_layered_build,
    uses_recalculating_build,
    uses_workspace_flow,
    _make_widget_stage,
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
    """Fetch the instance and its unified-workflow module class."""
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


async def _get_assessment_instance(
    db: AsyncSession,
    instance_id: _uuid.UUID,
    user: AuthUser,
) -> tuple[ModuleInstance, BaseAssessmentModule]:
    """Fetch an assessment workflow instance."""
    inst, module = await _get_workflow_instance(db, instance_id, user)
    if not isinstance(module, BaseAssessmentModule):
        raise HTTPException(
            status_code=400,
            detail=f"Module '{inst.module_id}' does not use layered build stages",
        )
    return inst, module


async def _get_editable_workflow_instance(
    db: AsyncSession,
    instance_id: _uuid.UUID,
    user: AuthUser,
) -> tuple[ModuleInstance, BaseModule]:
    """Like _get_workflow_instance but requires editor rights."""
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


async def _get_editable_instance(
    db: AsyncSession,
    instance_id: _uuid.UUID,
    user: AuthUser,
) -> tuple[ModuleInstance, BaseAssessmentModule]:
    """Like _get_assessment_instance but requires editor rights."""
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)
    if not isinstance(module, BaseAssessmentModule):
        raise HTTPException(
            status_code=400,
            detail=f"Module '{inst.module_id}' does not use layered build stages",
        )
    return inst, module


def _module_definition_payload(module: BaseModule) -> dict[str, Any]:
    payload = {
        "id": module.definition.id,
        "name": module.definition.name,
        "icon": module.definition.icon,
        "output_type": module.definition.output_type,
        "workspace_build_widget": module.manifest.workspace_build_widget,
        "workspace_output_widget": module.manifest.workspace_output_widget,
        "setup_fields": get_workspace_setup_fields(module),
    }
    if isinstance(module, BaseAssessmentModule):
        payload.update(module.assessment_definition.to_dict())
    return payload


def _get_stage_or_404(build: dict, stage_id: str, instance_id: Any) -> dict:
    """Return the stage dict or raise HTTP 404."""
    stage = get_build_stage(build, stage_id)
    if stage is None:
        raise HTTPException(status_code=404, detail=f"Stage '{stage_id}' not found on instance {instance_id}")
    return stage


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
# Setup endpoints
# ---------------------------------------------------------------------------

@router.post("/module-workflow/{instance_id}/setup/generate")
async def generate_setup_defaults(
    instance_id: _uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """AI-generate default setup field values from project context (assessment modules only)."""
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)
    if not isinstance(module, BaseAssessmentModule):
        raise HTTPException(
            status_code=400,
            detail=f"Module '{inst.module_id}' does not support generated setup defaults",
        )
    context = await get_initiative_context(db, inst.initiative_id)
    defaults = await module.generate_setup_defaults(db, inst.initiative_id, context)

    state = await ensure_workflow_state(db, inst, module)
    state["setup"]["fields"] = defaults
    save_workflow_state(inst, state)
    await db.commit()

    return {"fields": defaults}


class ConfirmSetupRequest(BaseModel):
    fields: dict[str, Any]


@router.post("/module-workflow/{instance_id}/setup/confirm")
async def confirm_setup(
    instance_id: _uuid.UUID,
    data: ConfirmSetupRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Confirm the setup fields and advance to the Build stage."""
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)
    previous_fields = dict(state["setup"].get("fields") or {})
    state["setup"]["fields"] = data.fields
    state["setup"]["confirmed"] = True
    state["setup"]["confirmed_at"] = datetime.now(timezone.utc).isoformat()
    state["current_stage"] = "build"

    # If setup fields changed for a widget module, reset build and output
    if not uses_layered_build(module) and previous_fields != data.fields:
        state["build"] = {
            "stages": [_make_widget_stage(module)],
            "current_stage_id": "main",
        }
        state["output"] = {
            "status": "pending",
            "content": None,
            "widget_type": module.manifest.workspace_output_widget,
            "widget_data": None,
        }
        inst.deliverable = None
        flag_modified(inst, "deliverable")

    save_workflow_state(inst, state)
    inst.status = ModuleInstanceStatus.GENERATING if uses_layered_build(module) else ModuleInstanceStatus.STARTED
    await db.commit()

    return {"ok": True, "current_stage": "build"}


# ---------------------------------------------------------------------------
# Build endpoints (assessment / layered modules)
# ---------------------------------------------------------------------------

@router.post("/module-workflow/{instance_id}/build/{stage_id}/generate")
async def generate_build_stage(
    instance_id: _uuid.UUID,
    stage_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Generate items for a build stage using the LLM (assessment modules only)."""
    inst, module = await _get_editable_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)

    if not state["setup"].get("confirmed"):
        raise HTTPException(status_code=400, detail="Setup must be confirmed before generating build stages")

    stage = _get_stage_or_404(state["build"], stage_id, instance_id)

    context = await get_initiative_context(db, inst.initiative_id)
    setup_fields = state["setup"]["fields"]
    prior_layers = layers_as_dict(state["build"])

    # Mark as generating
    stage["status"] = "generating"
    state["build"]["current_stage_id"] = stage_id
    save_workflow_state(inst, state)
    await db.commit()

    try:
        items = await module.generate_layer(
            db, inst.initiative_id, stage_id, setup_fields, prior_layers, context
        )
        stage["items"] = items
        stage["status"] = "in_progress"
        save_workflow_state(inst, state)
        await db.commit()
    except Exception as e:
        logger.error(f"Stage generation failed for {instance_id}/{stage_id}: {e}", exc_info=True)
        stage["status"] = "error"
        save_workflow_state(inst, state)
        await db.commit()
        raise HTTPException(status_code=500, detail=f"Generation failed: {e}")

    return {"items": items, "stage_status": "in_progress"}


class EditItemRequest(BaseModel):
    content: dict[str, Any]


@router.patch("/module-workflow/{instance_id}/build/{stage_id}/items/{item_id}")
async def edit_item(
    instance_id: _uuid.UUID,
    stage_id: str,
    item_id: str,
    data: EditItemRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Edit an item's content directly."""
    inst, module = await _get_editable_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)
    stage = _get_stage_or_404(state["build"], stage_id, instance_id)
    items = stage.get("items") or []
    item_idx = next((i for i, it in enumerate(items) if it["id"] == item_id), None)
    if item_idx is None:
        raise HTTPException(status_code=404, detail="Item not found")

    items[item_idx]["content"] = data.content
    items[item_idx]["origin"] = "user edited"
    items[item_idx]["provenance"]["derivation"] = "user_edited"
    stage["items"] = items
    save_workflow_state(inst, state)
    await db.commit()

    return {"item": items[item_idx]}


@router.post("/module-workflow/{instance_id}/build/{stage_id}/items/{item_id}/confirm")
async def confirm_item(
    instance_id: _uuid.UUID,
    stage_id: str,
    item_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Toggle an item's confirmed state."""
    inst, module = await _get_editable_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)
    stage = _get_stage_or_404(state["build"], stage_id, instance_id)
    items = stage.get("items") or []
    item_idx = next((i for i, it in enumerate(items) if it["id"] == item_id), None)
    if item_idx is None:
        raise HTTPException(status_code=404, detail="Item not found")

    now_confirmed = not items[item_idx].get("confirmed", False)
    items[item_idx]["confirmed"] = now_confirmed
    items[item_idx]["confirmed_at"] = datetime.now(timezone.utc).isoformat() if now_confirmed else None

    # If all items confirmed, mark stage as confirmed
    if all(it.get("confirmed") for it in items):
        stage["status"] = "confirmed"
    else:
        stage["status"] = "in_progress"

    stage["items"] = items
    save_workflow_state(inst, state)
    await db.commit()

    return {"item": items[item_idx], "stage_status": stage["status"]}


@router.delete("/module-workflow/{instance_id}/build/{stage_id}/items/{item_id}")
async def delete_item(
    instance_id: _uuid.UUID,
    stage_id: str,
    item_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Remove an item from a build stage."""
    inst, module = await _get_editable_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)
    stage = _get_stage_or_404(state["build"], stage_id, instance_id)
    items = stage.get("items") or []
    original_len = len(items)
    items = [it for it in items if it["id"] != item_id]
    if len(items) == original_len:
        raise HTTPException(status_code=404, detail="Item not found")

    stage["items"] = items
    save_workflow_state(inst, state)
    await db.commit()

    return {"ok": True, "remaining_count": len(items)}


class AddItemRequest(BaseModel):
    content: dict[str, Any]


@router.post("/module-workflow/{instance_id}/build/{stage_id}/items")
async def add_item(
    instance_id: _uuid.UUID,
    stage_id: str,
    data: AddItemRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Add a new manually-authored item to a build stage."""
    inst, module = await _get_editable_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)
    stage = _get_stage_or_404(state["build"], stage_id, instance_id)

    new_item = make_build_item(content=data.content, derivation="provided")
    if stage.get("items") is None:
        stage["items"] = []
    stage["items"].append(new_item)
    stage["status"] = "in_progress"
    save_workflow_state(inst, state)
    await db.commit()

    return {"item": new_item}


class ReorderItemsRequest(BaseModel):
    item_ids: list[str]


@router.post("/module-workflow/{instance_id}/build/{stage_id}/reorder")
async def reorder_items(
    instance_id: _uuid.UUID,
    stage_id: str,
    data: ReorderItemsRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Reorder items in a build stage."""
    inst, module = await _get_editable_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)
    stage = _get_stage_or_404(state["build"], stage_id, instance_id)
    items = stage.get("items") or []

    id_to_item = {it["id"]: it for it in items}
    reordered = [id_to_item[iid] for iid in data.item_ids if iid in id_to_item]
    mentioned = set(data.item_ids)
    reordered.extend(it for it in items if it["id"] not in mentioned)

    stage["items"] = reordered
    save_workflow_state(inst, state)
    await db.commit()

    return {"ok": True}


# ---------------------------------------------------------------------------
# Widget-backed workflow endpoints (calculator modules)
# ---------------------------------------------------------------------------

class PersistWidgetStateRequest(BaseModel):
    widget_data: dict[str, Any]
    stage_id: str = "main"


@router.post("/module-workflow/{instance_id}/widget-state")
async def persist_widget_state(
    instance_id: _uuid.UUID,
    data: PersistWidgetStateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Persist widget-backed workflow state for calculator modules."""
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)
    if not uses_recalculating_build(module):
        raise HTTPException(status_code=400, detail="This workflow does not support widget persistence")

    state = await persist_widget_stage_state(db, inst, module, data.widget_data, stage_id=data.stage_id)
    await db.commit()
    return {
        "instance_id": str(inst.id),
        "status": inst.status,
        "workflow_state": state,
    }


# ---------------------------------------------------------------------------
# Output endpoint
# ---------------------------------------------------------------------------

@router.post("/module-workflow/{instance_id}/output/generate")
async def generate_output(
    instance_id: _uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Generate the final assessment output from all build items."""
    inst, module = await _get_editable_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)

    # Require at least one item in the last stage
    stages = state["build"].get("stages", [])
    last_stage = stages[-1] if stages else None
    if last_stage and not last_stage.get("items"):
        raise HTTPException(
            status_code=400,
            detail=f"Stage '{last_stage['id']}' must have items before generating output",
        )

    # Build confirmed_build as {stage_id: {items}} for backward compat with generate_output hook
    confirmed_build = {
        s["id"]: {"items": s.get("items") or []}
        for s in stages
    }

    state["output"]["status"] = "generating"
    save_workflow_state(inst, state)
    await db.commit()

    try:
        output_content = await module.generate_output(
            db, inst.initiative_id,
            state["setup"]["fields"],
            confirmed_build,
        )
        state["output"]["content"] = output_content
        state["output"]["status"] = "complete"
        state["current_stage"] = "output"
        save_workflow_state(inst, state)
        inst.status = ModuleInstanceStatus.COMPLETED
        await module_service.save_deliverable(
            db,
            inst.initiative_id,
            inst.module_id,
            build_deliverable_title(module, output_content),
            module.definition.output_type,
            output_content,
            user_id=user.uid,
            instance_id=inst.id,
        )
        await db.commit()
    except Exception as e:
        logger.error(f"Output generation failed for {instance_id}: {e}", exc_info=True)
        state["output"]["status"] = "error"
        save_workflow_state(inst, state)
        await db.commit()
        raise HTTPException(status_code=500, detail=f"Output generation failed: {e}")

    return {"output": output_content, "status": "complete"}


# ---------------------------------------------------------------------------
# Export endpoint
# ---------------------------------------------------------------------------

@router.get("/module-workflow/{instance_id}/output/export")
async def export_module_output(
    instance_id: _uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Download the module output as a DOCX file."""
    from app.services.docx_exporter import DocxExporterService
    from app.core.filename_utils import safe_content_disposition

    inst, module = await _get_assessment_instance(db, instance_id, user)
    state = await ensure_workflow_state(db, inst, module)

    output = state.get("output", {})
    if output.get("status") != "complete" or not output.get("content"):
        raise HTTPException(status_code=400, detail="Output not yet generated")

    initiative = await db.get(Initiative, inst.initiative_id)
    initiative_title = initiative.title if initiative else "Assessment"

    content = dict(output["content"])
    if not content.get("title"):
        content["title"] = f"{module.definition.name} — {initiative_title}"

    exporter = DocxExporterService()
    docx_bytes = exporter.generate_assessment_docx(
        content=content,
        initiative_title=initiative_title,
    )

    safe_title = re.sub(r"[^\w\s\-.]", "_", content["title"]).replace(" ", "_")[:60]
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": safe_content_disposition(f"{safe_title}.docx")},
    )
