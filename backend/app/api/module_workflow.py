"""API endpoints for the multi-stage module workflow (Setup / Build / Output).

These endpoints drive the ModuleWorkspace frontend component. Each endpoint
operates on a ModuleInstance identified by its UUID.

Mounted at: /api/v1/module-workflow
"""

from __future__ import annotations

import copy
import logging
import uuid as _uuid
from datetime import datetime, timezone
from typing import Any

import re

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from app.core.auth import get_current_user, AuthUser
from app.core.database import get_db
from app.core.permissions import require_viewer, require_editor
from app.models.module_instance import ModuleInstance
from app.models.initiative import Initiative
from app.modules.registry import get_module_registry
from app.modules.assessment_base import (
    BaseAssessmentModule,
    make_initial_workflow_state,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_assessment_instance(
    db: AsyncSession,
    instance_id: _uuid.UUID,
    user: AuthUser,
) -> tuple[ModuleInstance, BaseAssessmentModule]:
    """Fetch the instance and its assessment module class."""
    inst = await db.get(ModuleInstance, instance_id)
    if inst is None:
        raise HTTPException(status_code=404, detail="Module instance not found")

    # Authorization: viewer on the parent initiative
    await require_viewer(db, inst.initiative_id, user)

    registry = get_module_registry()
    module = registry.get_module(inst.module_id)
    if module is None or not isinstance(module, BaseAssessmentModule):
        raise HTTPException(
            status_code=400,
            detail=f"Module '{inst.module_id}' is not an assessment module",
        )
    return inst, module


async def _get_editable_instance(
    db: AsyncSession,
    instance_id: _uuid.UUID,
    user: AuthUser,
) -> tuple[ModuleInstance, BaseAssessmentModule]:
    """Like _get_assessment_instance but requires editor rights."""
    inst = await db.get(ModuleInstance, instance_id)
    if inst is None:
        raise HTTPException(status_code=404, detail="Module instance not found")

    await require_editor(db, inst.initiative_id, user)

    registry = get_module_registry()
    module = registry.get_module(inst.module_id)
    if module is None or not isinstance(module, BaseAssessmentModule):
        raise HTTPException(
            status_code=400,
            detail=f"Module '{inst.module_id}' is not an assessment module",
        )
    return inst, module


def _ensure_workflow_state(inst: ModuleInstance, module: BaseAssessmentModule) -> dict:
    """Return a deep copy of workflow_state, initialising it if absent.

    Always deep-copy so callers can mutate nested dicts without accidentally
    aliasing the original JSONB data.  Callers must reassign inst.workflow_state
    and call flag_modified(inst, 'workflow_state') before committing.
    """
    if inst.workflow_state:
        return copy.deepcopy(inst.workflow_state)
    return make_initial_workflow_state(
        module.definition.id, module.assessment_definition
    )


def _save_state(inst: ModuleInstance, state: dict) -> None:
    """Assign new state and notify SQLAlchemy so the JSONB column is flushed."""
    inst.workflow_state = state
    flag_modified(inst, "workflow_state")


async def _get_initiative_context(db: AsyncSession, initiative_id: _uuid.UUID) -> dict:
    """Build a context dict from the parent initiative for LLM prompts."""
    initiative = await db.get(Initiative, initiative_id)
    if initiative is None:
        return {}
    return {
        "project_title": initiative.title or "",
        "project_description": initiative.project_description or initiative.goal or "",
        "geography": initiative.geography or "",
        "target_population": initiative.target_population or "",
    }


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
    inst, module = await _get_assessment_instance(db, instance_id, user)
    state = _ensure_workflow_state(inst, module)

    return {
        "instance_id": str(instance_id),
        "module_id": inst.module_id,
        "status": inst.status,
        "workflow_state": state,
        "module_definition": {
            "id": module.definition.id,
            "name": module.definition.name,
            "icon": module.definition.icon,
            **module.assessment_definition.to_dict(),
        },
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
    inst, module = await _get_editable_instance(db, instance_id, user)
    context = await _get_initiative_context(db, inst.initiative_id)
    defaults = await module.generate_setup_defaults(db, inst.initiative_id, context)

    state = _ensure_workflow_state(inst, module)
    state["setup"]["fields"] = defaults
    _save_state(inst, state)
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
    inst, module = await _get_editable_instance(db, instance_id, user)

    state = _ensure_workflow_state(inst, module)
    state["setup"]["fields"] = data.fields
    state["setup"]["confirmed"] = True
    state["setup"]["confirmed_at"] = datetime.now(timezone.utc).isoformat()
    state["current_stage"] = "build"
    _save_state(inst, state)
    inst.status = "generating"
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

    state = _ensure_workflow_state(inst, module)

    if not state["setup"].get("confirmed"):
        raise HTTPException(status_code=400, detail="Setup must be confirmed before generating build layers")

    # Validate layer exists
    valid_layers = [l.id for l in module.assessment_definition.build_layers]
    if layer_id not in valid_layers:
        raise HTTPException(status_code=404, detail=f"Layer '{layer_id}' not found")

    context = await _get_initiative_context(db, inst.initiative_id)
    setup_fields = state["setup"]["fields"]
    prior_layers = state["build"]["layers"]

    # Mark as generating
    state["build"]["layers"][layer_id]["status"] = "generating"
    state["build"]["current_layer"] = layer_id
    _save_state(inst, state)
    await db.commit()

    try:
        items = await module.generate_layer(
            db, inst.initiative_id, layer_id, setup_fields, prior_layers, context
        )
        state["build"]["layers"][layer_id]["items"] = items
        state["build"]["layers"][layer_id]["status"] = "in_progress"
        _save_state(inst, state)
        await db.commit()
    except Exception as e:
        logger.error(f"Layer generation failed for {instance_id}/{layer_id}: {e}", exc_info=True)
        state["build"]["layers"][layer_id]["status"] = "error"
        _save_state(inst, state)
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

    state = _ensure_workflow_state(inst, module)
    items = state["build"]["layers"].get(layer_id, {}).get("items", [])
    item_idx = next((i for i, it in enumerate(items) if it["id"] == item_id), None)
    if item_idx is None:
        raise HTTPException(status_code=404, detail="Item not found")

    items[item_idx]["content"] = data.content
    items[item_idx]["origin"] = "user edited"
    items[item_idx]["provenance"]["derivation"] = "user_edited"
    state["build"]["layers"][layer_id]["items"] = items
    _save_state(inst, state)
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

    state = _ensure_workflow_state(inst, module)
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
    _save_state(inst, state)
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

    state = _ensure_workflow_state(inst, module)
    items = state["build"]["layers"].get(layer_id, {}).get("items", [])
    original_len = len(items)
    items = [it for it in items if it["id"] != item_id]
    if len(items) == original_len:
        raise HTTPException(status_code=404, detail="Item not found")

    state["build"]["layers"][layer_id]["items"] = items
    _save_state(inst, state)
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

    state = _ensure_workflow_state(inst, module)

    from app.modules.assessment_base import make_build_item
    new_item = make_build_item(content=data.content, derivation="provided")
    state["build"]["layers"][layer_id]["items"].append(new_item)
    state["build"]["layers"][layer_id]["status"] = "in_progress"
    _save_state(inst, state)
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

    state = _ensure_workflow_state(inst, module)
    items = state["build"]["layers"].get(layer_id, {}).get("items", [])

    id_to_item = {it["id"]: it for it in items}
    reordered = [id_to_item[iid] for iid in data.item_ids if iid in id_to_item]
    # Append any items not mentioned (safety net)
    mentioned = set(data.item_ids)
    reordered.extend(it for it in items if it["id"] not in mentioned)

    state["build"]["layers"][layer_id]["items"] = reordered
    _save_state(inst, state)
    await db.commit()

    return {"ok": True}


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

    state = _ensure_workflow_state(inst, module)

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
    _save_state(inst, state)
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
        _save_state(inst, state)
        inst.status = "complete"
        await db.commit()
    except Exception as e:
        logger.error(f"Output generation failed for {instance_id}: {e}", exc_info=True)
        state["output"]["status"] = "error"
        _save_state(inst, state)
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
    state = _ensure_workflow_state(inst, module)

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
