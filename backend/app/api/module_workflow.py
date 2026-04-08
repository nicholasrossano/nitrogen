"""API endpoints for the multi-stage module workflow (Setup / Build / Output).

These endpoints drive the ModuleWorkspace frontend component. Each endpoint
operates on a ModuleInstance identified by its UUID.

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
from app.models.module_instance import ModuleInstance
from app.modules.base import BaseModule, ModuleAlignment
from app.modules.registry import get_module_registry
from app.modules.assessment_base import BaseAssessmentModule
from app.services import module_service
from app.services.module_workflow_service import (
    build_deliverable_title,
    ensure_workflow_state,
    get_workspace_setup_fields,
    get_initiative_context,
    persist_calculator_widget_state,
    save_workflow_state,
    uses_alignment_build,
    uses_layered_build,
    uses_recalculating_build,
    uses_workspace_flow,
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


def _build_execution_inputs(
    initiative: Initiative,
    setup_fields: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Normalize initiative context into execution inputs for non-assessment modules."""
    inputs = dict(initiative.tool_inputs or {})
    if initiative.title:
        inputs.setdefault("project_title", initiative.title)
    if initiative.geography:
        inputs.setdefault("geography", initiative.geography)
        inputs.setdefault("address", initiative.geography)
    if initiative.target_population:
        inputs.setdefault("target_beneficiaries", initiative.target_population)
    if initiative.goal:
        inputs.setdefault("project_goal", initiative.goal)
    if initiative.budget_range:
        inputs.setdefault("budget_range", initiative.budget_range)
    if initiative.timeline:
        inputs.setdefault("timeline", initiative.timeline)
    normalized = {
        key: value
        for key, value in inputs.items()
        if value is not None
    }
    for key, value in (setup_fields or {}).items():
        if value not in (None, ""):
            normalized[key] = value
    if normalized.get("geography") and "address" not in normalized:
        normalized["address"] = normalized["geography"]
    if normalized.get("project_description") and "project_goal" not in normalized:
        normalized["project_goal"] = normalized["project_description"]
    if normalized.get("target_population") and "target_beneficiaries" not in normalized:
        normalized["target_beneficiaries"] = normalized["target_population"]
    return normalized


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
    """AI-generate default setup field values from project context."""
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
    if not uses_layered_build(module) and previous_fields != data.fields:
        state["build"] = {
            "status": "pending",
            "current_layer": None,
            "layers": {},
            "widget_type": module.manifest.workspace_build_widget,
            "widget_data": None,
        }
        state["output"] = {
            "status": "pending",
            "content": None,
            "widget_type": module.manifest.workspace_output_widget,
            "widget_data": None,
        }
        inst.alignment = None
        inst.deliverable = None
        flag_modified(inst, "alignment")
        flag_modified(inst, "deliverable")
    save_workflow_state(inst, state)
    if uses_layered_build(module):
        inst.status = "generating"
    else:
        inst.status = "started"
    await db.commit()

    return {"ok": True, "current_stage": "build"}


# ---------------------------------------------------------------------------
# Build endpoints
# ---------------------------------------------------------------------------

@router.post("/module-workflow/{instance_id}/build/{layer_id}/generate")
async def generate_build_layer(
    instance_id: _uuid.UUID,
    layer_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Generate items for a build layer using the LLM."""
    inst, module = await _get_editable_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)

    if not state["setup"].get("confirmed"):
        raise HTTPException(status_code=400, detail="Setup must be confirmed before generating build layers")

    # Validate layer exists
    valid_layers = [layer.id for layer in module.assessment_definition.build_layers]
    if layer_id not in valid_layers:
        raise HTTPException(status_code=404, detail=f"Layer '{layer_id}' not found")

    context = await get_initiative_context(db, inst.initiative_id)
    setup_fields = state["setup"]["fields"]
    prior_layers = state["build"]["layers"]

    # Mark as generating
    state["build"]["layers"][layer_id]["status"] = "generating"
    state["build"]["current_layer"] = layer_id
    save_workflow_state(inst, state)
    await db.commit()

    try:
        items = await module.generate_layer(
            db, inst.initiative_id, layer_id, setup_fields, prior_layers, context
        )
        state["build"]["layers"][layer_id]["items"] = items
        state["build"]["layers"][layer_id]["status"] = "in_progress"
        save_workflow_state(inst, state)
        await db.commit()
    except Exception as e:
        logger.error(f"Layer generation failed for {instance_id}/{layer_id}: {e}", exc_info=True)
        state["build"]["layers"][layer_id]["status"] = "error"
        save_workflow_state(inst, state)
        await db.commit()
        raise HTTPException(status_code=500, detail=f"Generation failed: {e}")

    return {"items": items, "layer_status": "in_progress"}


class EditItemRequest(BaseModel):
    content: dict[str, Any]


@router.patch("/module-workflow/{instance_id}/build/{layer_id}/items/{item_id}")
async def edit_item(
    instance_id: _uuid.UUID,
    layer_id: str,
    item_id: str,
    data: EditItemRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Edit an item's content directly."""
    inst, module = await _get_editable_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)
    items = state["build"]["layers"].get(layer_id, {}).get("items", [])
    item_idx = next((i for i, it in enumerate(items) if it["id"] == item_id), None)
    if item_idx is None:
        raise HTTPException(status_code=404, detail="Item not found")

    items[item_idx]["content"] = data.content
    items[item_idx]["origin"] = "user edited"
    items[item_idx]["provenance"]["derivation"] = "user_edited"
    state["build"]["layers"][layer_id]["items"] = items
    save_workflow_state(inst, state)
    await db.commit()

    return {"item": items[item_idx]}


@router.post("/module-workflow/{instance_id}/build/{layer_id}/items/{item_id}/confirm")
async def confirm_item(
    instance_id: _uuid.UUID,
    layer_id: str,
    item_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Toggle an item's confirmed state."""
    inst, module = await _get_editable_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)
    items = state["build"]["layers"].get(layer_id, {}).get("items", [])
    item_idx = next((i for i, it in enumerate(items) if it["id"] == item_id), None)
    if item_idx is None:
        raise HTTPException(status_code=404, detail="Item not found")

    now_confirmed = not items[item_idx].get("confirmed", False)
    items[item_idx]["confirmed"] = now_confirmed
    items[item_idx]["confirmed_at"] = datetime.now(timezone.utc).isoformat() if now_confirmed else None

    # If all items confirmed, mark layer as confirmed
    if all(it.get("confirmed") for it in items):
        state["build"]["layers"][layer_id]["status"] = "confirmed"
    else:
        state["build"]["layers"][layer_id]["status"] = "in_progress"

    state["build"]["layers"][layer_id]["items"] = items
    save_workflow_state(inst, state)
    await db.commit()

    return {"item": items[item_idx], "layer_status": state["build"]["layers"][layer_id]["status"]}


@router.delete("/module-workflow/{instance_id}/build/{layer_id}/items/{item_id}")
async def delete_item(
    instance_id: _uuid.UUID,
    layer_id: str,
    item_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Remove an item from a build layer."""
    inst, module = await _get_editable_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)
    items = state["build"]["layers"].get(layer_id, {}).get("items", [])
    original_len = len(items)
    items = [it for it in items if it["id"] != item_id]
    if len(items) == original_len:
        raise HTTPException(status_code=404, detail="Item not found")

    state["build"]["layers"][layer_id]["items"] = items
    save_workflow_state(inst, state)
    await db.commit()

    return {"ok": True, "remaining_count": len(items)}


class AddItemRequest(BaseModel):
    content: dict[str, Any]


@router.post("/module-workflow/{instance_id}/build/{layer_id}/items")
async def add_item(
    instance_id: _uuid.UUID,
    layer_id: str,
    data: AddItemRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Add a new manually-authored item to a build layer."""
    inst, module = await _get_editable_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)

    from app.modules.assessment_base import make_build_item
    new_item = make_build_item(content=data.content, derivation="provided")
    state["build"]["layers"][layer_id]["items"].append(new_item)
    state["build"]["layers"][layer_id]["status"] = "in_progress"
    save_workflow_state(inst, state)
    await db.commit()

    return {"item": new_item}


class ReorderItemsRequest(BaseModel):
    item_ids: list[str]


@router.post("/module-workflow/{instance_id}/build/{layer_id}/reorder")
async def reorder_items(
    instance_id: _uuid.UUID,
    layer_id: str,
    data: ReorderItemsRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Reorder items in a build layer."""
    inst, module = await _get_editable_instance(db, instance_id, user)

    state = await ensure_workflow_state(db, inst, module)
    items = state["build"]["layers"].get(layer_id, {}).get("items", [])

    id_to_item = {it["id"]: it for it in items}
    reordered = [id_to_item[iid] for iid in data.item_ids if iid in id_to_item]
    # Append any items not mentioned (safety net)
    mentioned = set(data.item_ids)
    reordered.extend(it for it in items if it["id"] not in mentioned)

    state["build"]["layers"][layer_id]["items"] = reordered
    save_workflow_state(inst, state)
    await db.commit()

    return {"ok": True}


# ---------------------------------------------------------------------------
# Widget-backed workflow endpoints
# ---------------------------------------------------------------------------


class PersistWidgetStateRequest(BaseModel):
    widget_data: dict[str, Any]


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

    state = await persist_calculator_widget_state(db, inst, module, data.widget_data)
    await db.commit()
    return {
        "instance_id": str(inst.id),
        "status": inst.status,
        "workflow_state": state,
    }


class ConfirmAlignmentRequest(BaseModel):
    sections: list[dict[str, Any]] | None = None
    parameters: list[dict[str, Any]] | None = None


@router.post("/module-workflow/{instance_id}/alignment/confirm")
async def confirm_workflow_alignment(
    instance_id: _uuid.UUID,
    data: ConfirmAlignmentRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Confirm an alignment workflow instance and generate its deliverable."""
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)
    if not uses_alignment_build(module):
        raise HTTPException(status_code=400, detail="This workflow does not use alignment confirmation")

    state = await ensure_workflow_state(db, inst, module)
    alignment_data = dict(inst.alignment or state.get("build", {}).get("widget_data", {}).get("alignment") or {})
    if not alignment_data:
        raise HTTPException(status_code=400, detail="No alignment is available for this module instance")

    if data.sections is not None:
        alignment_data["sections"] = data.sections
    if data.parameters is not None:
        alignment_data["parameters"] = data.parameters
    alignment_data["confirmed"] = True
    alignment_data["feedback"] = None

    await module_service.save_alignment(
        db,
        inst.initiative_id,
        inst.module_id,
        alignment_data,
        user_id=user.uid,
        instance_id=inst.id,
    )

    initiative = await db.get(Initiative, inst.initiative_id)
    if initiative is None:
        raise HTTPException(status_code=404, detail="Initiative not found")

    output = await module.execute(
        db=db,
        initiative_id=initiative.id,
        inputs=_build_execution_inputs(initiative, state.get("setup", {}).get("fields")),
        include_corpus=True,
        alignment=ModuleAlignment.from_dict(alignment_data),
    )

    await module_service.save_deliverable(
        db,
        initiative.id,
        inst.module_id,
        output.title,
        output.output_type,
        output.content,
        user_id=user.uid,
        instance_id=inst.id,
    )
    state = await ensure_workflow_state(db, inst, module)
    await db.commit()

    return {
        "instance_id": str(inst.id),
        "status": inst.status,
        "workflow_state": state,
        "output": output.content,
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

    # Require at least one item in the final layer
    build_layers = module.assessment_definition.build_layers
    last_layer_id = build_layers[-1].id if build_layers else None
    if last_layer_id:
        last_layer = state["build"]["layers"].get(last_layer_id, {})
        if not last_layer.get("items"):
            raise HTTPException(
                status_code=400,
                detail=f"Layer '{last_layer_id}' must have items before generating output",
            )

    # Pass all items from every layer to the output generator
    confirmed_build = {
        lid: {"items": layer_state.get("items", [])}
        for lid, layer_state in state["build"]["layers"].items()
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
