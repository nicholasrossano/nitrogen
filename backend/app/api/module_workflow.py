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
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, AuthUser
from app.core.billing_guard import require_ai_access
from app.core.database import get_db
from app.core.filename_utils import safe_content_disposition
from app.core.permissions import require_viewer, require_editor
from app.models.initiative import Initiative
from app.models.module_instance import ModuleInstance, ModuleInstanceStatus
from app.models.user import User
from app.modules.base import BaseModule
from app.modules.implementation_plan import ImplementationPlanModule
from app.modules.registry import get_module_registry
from app.modules.stakeholder_assessment import StakeholderAssessmentModule
from app.modules.utils import make_build_item
from app.services.deep_dive import DeepDiveService
from app.services.module_workflow_service import (
    clear_final_approval,
    confirm_stage,
    enrich_record_item,
    ensure_workflow_state,
    get_initiative_context,
    populate_stage,
    requires_final_approval,
    save_workflow_state,
    uses_workspace_flow,
)
from app.services.decision_event_service import append_decision_event
from app.services.decision_log_service import (
    build_module_decision_history_report,
    build_module_decision_log_xlsx,
)
from app.services.assumptions import AssumptionActor, sync_stage_assumptions, sync_widget_assumptions

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
        "requires_final_approval": requires_final_approval(module),
        "stage_defs": [s.to_dict() for s in module.stage_defs],
    }


async def _instance_creator_token(db: AsyncSession, inst: ModuleInstance) -> str:
    creator = await db.get(User, inst.started_by)
    email = (creator.email if creator else "").strip() if creator else ""
    email_local = email.split("@", 1)[0].strip().lower()
    if email_local:
        return re.sub(r"[^\w.-]", "-", email_local).strip("._-") or "user"

    fallback = re.sub(r"[^\w.-]", "-", inst.started_by).strip("._-").lower()
    return fallback or "user"


async def _module_export_filename(
    *,
    db: AsyncSession,
    inst: ModuleInstance,
    module: BaseModule,
    ext: str,
    prefix: str | None = None,
) -> str:
    """Build a consistent filename for module-scoped exports."""
    module_token = re.sub(r"[^\w.-]", "-", module.definition.name.lower()).strip("._-") or "module"
    number_token = inst.instance_number
    creator_token = await _instance_creator_token(db, inst)
    date_token = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    base = f"{module_token}_n{number_token}_{creator_token}_{date_token}"
    if prefix:
        safe_prefix = re.sub(r"[^\w.-]", "_", prefix).strip("._") + "_"
    else:
        safe_prefix = ""
    return f"{safe_prefix}{base}.{ext}"


async def _read_response_bytes(response: Response) -> bytes:
    """Materialize a FastAPI response body into bytes."""
    body = getattr(response, "body", None)
    if isinstance(body, bytes):
        return body

    body_iterator = getattr(response, "body_iterator", None)
    if body_iterator is None:
        raise RuntimeError("Export response did not expose body bytes")

    chunks: list[bytes] = []
    async for chunk in body_iterator:
        chunks.append(chunk if isinstance(chunk, bytes) else chunk.encode("utf-8"))
    return b"".join(chunks)


async def _generate_legacy_calculator_export(
    module_id: str,
    confirmed_stages: dict[str, Any],
) -> bytes:
    """Reuse existing calculator workbook exports for staged module workflows."""
    results_data = (confirmed_stages.get("results") or {}).get("data") or {}
    widget_data = results_data.get("widget_data") or {}

    if module_id == "lcoe_model":
        from app.api.lcoe import RecalculateRequest, export_lcoe_excel

        response = await export_lcoe_excel(
            RecalculateRequest(inputs=widget_data.get("inputs") or {})
        )
        return await _read_response_bytes(response)

    if module_id == "carbon_model":
        from app.api.carbon import RecalculateRequest, export_carbon_excel

        response = await export_carbon_excel(
            RecalculateRequest(inputs=widget_data.get("inputs") or {})
        )
        return await _read_response_bytes(response)

    if module_id == "solar_estimate":
        from app.api.pvwatts import ExportRequest, export_solar_excel

        response = await export_solar_excel(
            ExportRequest(
                inputs=widget_data.get("inputs") or {},
                result=widget_data.get("result") or {},
            )
        )
        return await _read_response_bytes(response)

    raise RuntimeError(f"No legacy export fallback is defined for module '{module_id}'")


def _workflow_response(
    instance_id: _uuid.UUID,
    inst: ModuleInstance,
    module: BaseModule,
    state: dict[str, Any],
) -> dict[str, Any]:
    return {
        "instance_id": str(instance_id),
        "module_id": inst.module_id,
        "status": inst.status,
        "workflow_version": inst.workflow_version,
        "workflow_state": state,
        "module_definition": _module_definition_payload(module),
    }


def _get_expected_workflow_version(request: Request) -> int | None:
    raw = request.headers.get("x-workflow-version")
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid X-Workflow-Version header") from exc


def _assert_workflow_version(inst: ModuleInstance, request: Request) -> None:
    expected = _get_expected_workflow_version(request)
    if expected is None:
        return
    current = inst.workflow_version or 1
    if expected != current:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "This module was updated elsewhere. Refresh and try again.",
                "current_workflow_version": current,
            },
        )


def _all_required_stages_confirmed(module: BaseModule, state: dict[str, Any]) -> bool:
    return bool(module.stage_defs) and all(
        state["stages"].get(stage_def.id, {}).get("status") == "confirmed"
        for stage_def in module.stage_defs
    )


def _has_meaningful_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, set)):
        return any(_has_meaningful_value(item) for item in value)
    if isinstance(value, dict):
        return any(_has_meaningful_value(item) for item in value.values())
    return True


def _get_auto_confirmable_final_stage(module: BaseModule, state: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    """Return the terminal stage when it is ready to auto-confirm during final approval."""
    if not module.stage_defs:
        return None

    final_stage = module.stage_defs[-1]
    final_stage_state = state["stages"].get(final_stage.id, {})
    if final_stage_state.get("status") == "confirmed":
        return None

    if final_stage_state.get("status") != "draft":
        return None

    final_stage_data = final_stage_state.get("data") or {}
    has_computed_widget_data = (
        getattr(final_stage, "component", None) == "computed_results"
        and isinstance(final_stage_data, dict)
        and final_stage_data.get("widget_data") is not None
    )
    if not has_computed_widget_data and not _has_meaningful_value(final_stage_data):
        return None

    prior_stage_defs = module.stage_defs[:-1]
    if not all(
        state["stages"].get(stage_def.id, {}).get("status") == "confirmed"
        for stage_def in prior_stage_defs
    ):
        return None

    return final_stage.id, final_stage_state


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


def _normalized_items(value: Any) -> list[dict[str, Any]]:
    """Return a safe list of item dicts for stage-data operations."""
    if not isinstance(value, list):
        return []
    return [it for it in value if isinstance(it, dict)]


def _build_confirmed_stages_snapshot(state: dict[str, Any]) -> dict[str, Any]:
    """Build a confirmed-stage snapshot from persisted workflow state."""
    return {
        stage_id: stage_state
        for stage_id, stage_state in (state.get("stages") or {}).items()
        if stage_state.get("status") == "confirmed"
    }


def _stakeholder_detail_records(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Return stakeholder detail records stored outside formal stage defs."""
    records = state.get("stakeholder_details")
    if isinstance(records, dict):
        return records
    return {}


async def _refresh_stakeholder_map_widget(
    module: StakeholderAssessmentModule,
    state: dict[str, Any],
    context: dict[str, Any],
    records: dict[str, dict[str, Any]],
) -> None:
    """Recompute and persist map widget_data with current stakeholder details."""
    stages = state.get("stages") or {}
    map_stage = stages.get("map")
    if not isinstance(map_stage, dict):
        return
    if map_stage.get("status") not in ("draft", "confirmed"):
        return

    confirmed_stages = _build_confirmed_stages_snapshot(state)
    confirmed_stages["stakeholder_details"] = {"data": {"records": records}}
    widget_data = await module.compute_stage("map", confirmed_stages, context)

    map_data = map_stage.get("data")
    if not isinstance(map_data, dict):
        map_data = {}
    map_data["widget_data"] = widget_data
    map_stage["data"] = map_data


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
    return _workflow_response(instance_id, inst, module, state)


# ---------------------------------------------------------------------------
# Stage population
# ---------------------------------------------------------------------------

@router.post("/module-workflow/{instance_id}/stages/{stage_id}/populate")
async def populate_stage_endpoint(
    instance_id: _uuid.UUID,
    stage_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Run the population pipeline for a stage.

    Executes the stage's declared population steps in order.
    Sets stage status to 'draft' when complete (awaiting user confirmation).
    """
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)
    _assert_workflow_version(inst, request)
    _get_stage_def_or_404(module, stage_id, instance_id)

    prior_approved = ((inst.workflow_state or {}).get("final_approval") or {}).get("status") == "approved"
    state = await populate_stage(db, inst, module, stage_id)
    await append_decision_event(
        db,
        inst=inst,
        event_type="stage_populated",
        entity_type="stage",
        entity_id=stage_id,
        stage_id=stage_id,
        actor_user_id=user.uid,
        actor_email=user.email,
        payload={"status": state["stages"][stage_id].get("status")},
    )
    if prior_approved and (state.get("final_approval") or {}).get("status") != "approved":
        await append_decision_event(
            db,
            inst=inst,
            event_type="final_approval_revoked",
            entity_type="module",
            actor_user_id=user.uid,
            actor_email=user.email,
            payload={"reason": "stage_repopulated", "stage_id": stage_id},
        )
    await db.commit()

    return {
        "stage_id": stage_id,
        "stage_state": state["stages"][stage_id],
        "workflow_state": state,
        "workflow_version": inst.workflow_version,
    }


# ---------------------------------------------------------------------------
# Stage confirmation
# ---------------------------------------------------------------------------

@router.post("/module-workflow/{instance_id}/stages/{stage_id}/confirm")
async def confirm_stage_endpoint(
    instance_id: _uuid.UUID,
    stage_id: str,
    request: Request,
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
    _assert_workflow_version(inst, request)

    state = await ensure_workflow_state(db, inst, module)
    _get_stage_state_or_404(state, stage_id, instance_id)
    prior_approved = ((state.get("final_approval") or {}).get("status") == "approved")

    state, auto_populate_def = await confirm_stage(
        db,
        inst,
        module,
        stage_id,
        confirmed_by=user.uid,
        confirmed_by_email=user.email,
    )
    save_workflow_state(inst, state)
    await append_decision_event(
        db,
        inst=inst,
        event_type="stage_confirmed",
        entity_type="stage",
        entity_id=stage_id,
        stage_id=stage_id,
        actor_user_id=user.uid,
        actor_email=user.email,
        payload={
            "confirmed_at": state["stages"][stage_id].get("confirmed_at"),
            "confirmed_by": user.uid,
            "confirmed_by_email": user.email,
        },
    )
    if prior_approved and (state.get("final_approval") or {}).get("status") != "approved":
        await append_decision_event(
            db,
            inst=inst,
            event_type="final_approval_revoked",
            entity_type="module",
            actor_user_id=user.uid,
            actor_email=user.email,
            payload={"reason": "stage_reconfirmed", "stage_id": stage_id},
        )

    inst.status = ModuleInstanceStatus.GENERATING
    await db.commit()

    # Auto-populate next computed stage if applicable (e.g. LCOE results after inputs confirmed)
    if auto_populate_def is not None:
        try:
            state = await populate_stage(db, inst, module, auto_populate_def.id)
            await append_decision_event(
                db,
                inst=inst,
                event_type="stage_populated",
                entity_type="stage",
                entity_id=auto_populate_def.id,
                stage_id=auto_populate_def.id,
                actor_user_id=user.uid,
                actor_email=user.email,
                payload={"trigger": "auto_after_confirmation", "source_stage_id": stage_id},
            )
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
        "workflow_version": inst.workflow_version,
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
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Edit an item's content in a list or table stage."""
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)
    _assert_workflow_version(inst, request)

    state = await ensure_workflow_state(db, inst, module)
    stage_state = _get_stage_state_or_404(state, stage_id, instance_id)
    prior_approved = ((state.get("final_approval") or {}).get("status") == "approved")

    stage_data = stage_state.get("data") or {}
    items = _normalized_items(stage_data.get("items"))
    item_idx = next((i for i, it in enumerate(items) if str(it.get("id")) == item_id), None)
    if item_idx is None:
        raise HTTPException(status_code=404, detail="Item not found")

    previous_content = items[item_idx].get("content", {}) or {}
    updated_content = dict(data.content)
    new_value = updated_content.get("value")
    value_is_present = new_value is not None and str(new_value).strip() != ""
    value_changed = new_value != previous_content.get("value")
    if value_changed and value_is_present:
        # Any explicit user-supplied value should become confirmed to avoid
        # stale "missing" badges after manual edits or chat-applied updates.
        updated_content["status"] = "confirmed"
        updated_content["source"] = "user"

    items[item_idx]["content"] = updated_content
    items[item_idx]["origin"] = "user edited"
    if "provenance" not in items[item_idx]:
        items[item_idx]["provenance"] = {}
    items[item_idx]["provenance"]["derivation"] = "user_edited"
    stage_data["items"] = items
    stage_state["data"] = stage_data
    await sync_stage_assumptions(
        db,
        initiative_id=inst.initiative_id,
        module_id=module.definition.id,
        stage_id=stage_id,
        stage_data={"items": [items[item_idx]]},
        actor=AssumptionActor(user_id=user.uid, email=user.email or user.uid),
        status="confirmed" if value_is_present else "needs_review",
    )
    clear_final_approval(state)
    save_workflow_state(inst, state, increment_version=True)
    await append_decision_event(
        db,
        inst=inst,
        event_type="item_updated",
        entity_type="item",
        entity_id=item_id,
        stage_id=stage_id,
        actor_user_id=user.uid,
        actor_email=user.email,
        payload={"content": updated_content},
    )
    if prior_approved and (state.get("final_approval") or {}).get("status") != "approved":
        await append_decision_event(
            db,
            inst=inst,
            event_type="final_approval_revoked",
            entity_type="module",
            actor_user_id=user.uid,
            actor_email=user.email,
            payload={"reason": "item_updated", "stage_id": stage_id, "entity_id": item_id},
        )
    await db.commit()

    return {"item": items[item_idx], "workflow_version": inst.workflow_version}


class AddItemRequest(BaseModel):
    content: dict[str, Any]


@router.post("/module-workflow/{instance_id}/stages/{stage_id}/items")
async def add_item(
    instance_id: _uuid.UUID,
    stage_id: str,
    data: AddItemRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Add a new manually-authored item to a list or table stage."""
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)
    _assert_workflow_version(inst, request)

    state = await ensure_workflow_state(db, inst, module)
    stage_state = _get_stage_state_or_404(state, stage_id, instance_id)
    prior_approved = ((state.get("final_approval") or {}).get("status") == "approved")

    stage_data = stage_state.get("data") or {"items": []}
    new_item = make_build_item(content=data.content, derivation="provided")
    stage_data.setdefault("items", []).append(new_item)
    stage_state["data"] = stage_data
    await sync_stage_assumptions(
        db,
        initiative_id=inst.initiative_id,
        module_id=module.definition.id,
        stage_id=stage_id,
        stage_data={"items": [new_item]},
        actor=AssumptionActor(user_id=user.uid, email=user.email or user.uid),
        status="confirmed",
    )
    if stage_state.get("status") == "pending":
        stage_state["status"] = "draft"

    clear_final_approval(state)
    save_workflow_state(inst, state, increment_version=True)
    await append_decision_event(
        db,
        inst=inst,
        event_type="item_added",
        entity_type="item",
        entity_id=new_item["id"],
        stage_id=stage_id,
        actor_user_id=user.uid,
        actor_email=user.email,
        payload={"content": new_item["content"]},
    )
    if prior_approved and (state.get("final_approval") or {}).get("status") != "approved":
        await append_decision_event(
            db,
            inst=inst,
            event_type="final_approval_revoked",
            entity_type="module",
            actor_user_id=user.uid,
            actor_email=user.email,
            payload={"reason": "item_added", "stage_id": stage_id, "entity_id": new_item["id"]},
        )
    await db.commit()

    return {"item": new_item, "workflow_version": inst.workflow_version}


@router.delete("/module-workflow/{instance_id}/stages/{stage_id}/items/{item_id}")
async def delete_item(
    instance_id: _uuid.UUID,
    stage_id: str,
    item_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Remove an item from a list or table stage."""
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)
    _assert_workflow_version(inst, request)

    state = await ensure_workflow_state(db, inst, module)
    stage_state = _get_stage_state_or_404(state, stage_id, instance_id)
    prior_approved = ((state.get("final_approval") or {}).get("status") == "approved")

    stage_data = stage_state.get("data") or {}
    items = _normalized_items(stage_data.get("items"))
    original_len = len(items)
    items = [it for it in items if str(it.get("id")) != item_id]
    if len(items) == original_len:
        raise HTTPException(status_code=404, detail="Item not found")

    stage_data["items"] = items
    stage_state["data"] = stage_data
    clear_final_approval(state)
    save_workflow_state(inst, state, increment_version=True)
    await append_decision_event(
        db,
        inst=inst,
        event_type="item_deleted",
        entity_type="item",
        entity_id=item_id,
        stage_id=stage_id,
        actor_user_id=user.uid,
        actor_email=user.email,
        payload={},
    )
    if prior_approved and (state.get("final_approval") or {}).get("status") != "approved":
        await append_decision_event(
            db,
            inst=inst,
            event_type="final_approval_revoked",
            entity_type="module",
            actor_user_id=user.uid,
            actor_email=user.email,
            payload={"reason": "item_deleted", "stage_id": stage_id, "entity_id": item_id},
        )
    await db.commit()

    return {"ok": True, "remaining_count": len(items), "workflow_version": inst.workflow_version}


class ReorderItemsRequest(BaseModel):
    item_ids: list[str]


@router.post("/module-workflow/{instance_id}/stages/{stage_id}/reorder")
async def reorder_items(
    instance_id: _uuid.UUID,
    stage_id: str,
    data: ReorderItemsRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Reorder items in a list or table stage."""
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)
    _assert_workflow_version(inst, request)

    state = await ensure_workflow_state(db, inst, module)
    stage_state = _get_stage_state_or_404(state, stage_id, instance_id)
    prior_approved = ((state.get("final_approval") or {}).get("status") == "approved")

    stage_data = stage_state.get("data") or {}
    items = _normalized_items(stage_data.get("items"))
    id_to_item = {
        str(it.get("id")): it
        for it in items
        if it.get("id") is not None
    }
    reordered = [id_to_item[iid] for iid in data.item_ids if iid in id_to_item]
    mentioned = set(data.item_ids)
    reordered.extend(
        it
        for it in items
        if (it.get("id") is None) or (str(it.get("id")) not in mentioned)
    )

    stage_data["items"] = reordered
    stage_state["data"] = stage_data
    clear_final_approval(state)
    save_workflow_state(inst, state, increment_version=True)
    await append_decision_event(
        db,
        inst=inst,
        event_type="items_reordered",
        entity_type="stage",
        entity_id=stage_id,
        stage_id=stage_id,
        actor_user_id=user.uid,
        actor_email=user.email,
        payload={"item_ids": data.item_ids},
    )
    if prior_approved and (state.get("final_approval") or {}).get("status") != "approved":
        await append_decision_event(
            db,
            inst=inst,
            event_type="final_approval_revoked",
            entity_type="module",
            actor_user_id=user.uid,
            actor_email=user.email,
            payload={"reason": "items_reordered", "stage_id": stage_id},
        )
    await db.commit()

    return {"ok": True, "workflow_version": inst.workflow_version}


# ---------------------------------------------------------------------------
# Record enrichment (detail panel / record stages)
# ---------------------------------------------------------------------------

@router.post("/module-workflow/{instance_id}/stages/{stage_id}/records/{item_id}/enrich")
async def enrich_record_endpoint(
    instance_id: _uuid.UUID,
    stage_id: str,
    item_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """AI-enrich a single record in a record-component stage.

    The item_id refers to the source item from the prior list stage.
    Calls module.enrich_record() and persists the enriched field values.
    """
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)
    _assert_workflow_version(inst, request)
    prior_approved = ((inst.workflow_state or {}).get("final_approval") or {}).get("status") == "approved"

    enriched = await enrich_record_item(db, inst, module, stage_id, item_id)
    await append_decision_event(
        db,
        inst=inst,
        event_type="record_enriched",
        entity_type="record",
        entity_id=item_id,
        stage_id=stage_id,
        actor_user_id=user.uid,
        actor_email=user.email,
        payload={"fields": enriched},
    )
    state = inst.workflow_state or {}
    if prior_approved and (state.get("final_approval") or {}).get("status") != "approved":
        await append_decision_event(
            db,
            inst=inst,
            event_type="final_approval_revoked",
            entity_type="module",
            actor_user_id=user.uid,
            actor_email=user.email,
            payload={"reason": "record_enriched", "stage_id": stage_id, "entity_id": item_id},
        )
    await db.commit()

    return {"item_id": item_id, "record": enriched, "workflow_version": inst.workflow_version}


@router.post("/module-workflow/{instance_id}/stakeholders/{item_id}/enrich")
async def enrich_stakeholder_from_map(
    instance_id: _uuid.UUID,
    item_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """AI-enrich a stakeholder from the map inspector (no dedicated details stage)."""
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)
    if not isinstance(module, StakeholderAssessmentModule):
        raise HTTPException(status_code=400, detail="Stakeholder enrichment is only supported for stakeholder assessment")
    _assert_workflow_version(inst, request)
    state = await ensure_workflow_state(db, inst, module)
    prior_approved = ((state.get("final_approval") or {}).get("status") == "approved")

    stakeholders_stage = _get_stage_state_or_404(state, "stakeholders", instance_id)
    stakeholder_items = (stakeholders_stage.get("data") or {}).get("items") or []
    source_item = next((it for it in stakeholder_items if it.get("id") == item_id), None)
    if source_item is None:
        raise HTTPException(status_code=404, detail=f"Stakeholder '{item_id}' not found")

    context = await get_initiative_context(db, inst.initiative_id)
    records = _stakeholder_detail_records(state)
    existing = records.get(item_id) or {}
    enriched = await module.enrich_stakeholder_detail(
        source_item.get("content", {}),
        existing,
        context,
        db=db,
        initiative_id=inst.initiative_id,
    )
    records[item_id] = enriched
    state["stakeholder_details"] = records

    if state.get("cached_exports"):
        state["cached_exports"] = {}

    await _refresh_stakeholder_map_widget(module, state, context, records)
    clear_final_approval(state)
    save_workflow_state(inst, state, increment_version=True)
    await append_decision_event(
        db,
        inst=inst,
        event_type="record_enriched",
        entity_type="record",
        entity_id=item_id,
        stage_id="map",
        actor_user_id=user.uid,
        actor_email=user.email,
        payload={"fields": enriched, "scope": "stakeholder_map"},
    )
    if prior_approved and (state.get("final_approval") or {}).get("status") != "approved":
        await append_decision_event(
            db,
            inst=inst,
            event_type="final_approval_revoked",
            entity_type="module",
            actor_user_id=user.uid,
            actor_email=user.email,
            payload={"reason": "record_enriched", "stage_id": "map", "entity_id": item_id},
        )
    await db.commit()
    return {"item_id": item_id, "record": enriched, "workflow_version": inst.workflow_version}


@router.post("/module-workflow/{instance_id}/implementation/{item_id}/deep-dive")
async def deep_dive_implementation_item(
    instance_id: _uuid.UUID,
    item_id: str,
    body: ImplementationDeepDiveRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_ai_access),
):
    """Run and cache implementation-task deep dive research for inspector panels."""
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)
    if not isinstance(module, ImplementationPlanModule):
        raise HTTPException(status_code=400, detail="Implementation deep dive is only supported for implementation plan")

    state = await ensure_workflow_state(db, inst, module)
    cache_key = "implementation_deep_dives"
    cache = state.get(cache_key) if isinstance(state.get(cache_key), dict) else {}
    cached = cache.get(item_id)
    service = DeepDiveService(db, user_id=user.uid)
    if cached and "summary_citations" not in cached:
        cached = None

    if cached:
        serialized = cached
    else:
        initiative = await db.get(Initiative, inst.initiative_id)
        if initiative is None:
            raise HTTPException(status_code=404, detail="Initiative not found")
        try:
            generated = await service.generate(
                initiative=initiative,
                item_id=item_id,
                item_title=body.item_title,
                item_classification=body.item_classification,
                item_rationale=body.item_rationale,
                pillar_name=body.pillar_name,
            )
        except Exception:
            logger.exception("Implementation deep dive failed for item %s in instance %s", item_id, instance_id)
            raise HTTPException(status_code=500, detail="Deep dive failed. Please try again.")
        serialized = _serialize_deep_dive_payload(generated)
        cache[item_id] = serialized
        state[cache_key] = cache
        save_workflow_state(inst, state, increment_version=False)
        await db.commit()

    return serialized


class UpdateRecordRequest(BaseModel):
    fields: dict[str, Any]


class ImplementationDeepDiveRequest(BaseModel):
    item_title: str
    item_classification: str
    item_rationale: str
    pillar_name: str


def _serialize_deep_dive_payload(result: Any) -> dict[str, Any]:
    if isinstance(result, dict):
        return result
    return {
        "item_id": result.item_id,
        "item_title": result.item_title,
        "pillar_name": result.pillar_name,
        "what_this_is": list(result.what_this_is or []),
        "summary_citations": list(result.summary_citations or []),
        "elements": [
            {
                "title": element.title,
                "description": element.description,
                "classification": element.classification,
            }
            for element in (result.elements or [])
        ],
        "dependencies": [
            {
                "condition": dependency.condition,
                "effect": dependency.effect,
            }
            for dependency in (result.dependencies or [])
        ],
        "sources": [
            {
                "title": source.title,
                "url": source.url,
                "source_type": source.source_type,
                **({"publisher": source.publisher} if source.publisher else {}),
                **({"excerpt": source.excerpt} if source.excerpt else {}),
                **({"evidence_doc_id": source.evidence_doc_id} if source.evidence_doc_id else {}),
                **({"chunk_id": source.chunk_id} if source.chunk_id else {}),
            }
            for source in (result.sources or [])
        ],
        "generated_at": result.generated_at,
        "latency_ms": result.latency_ms,
    }


@router.patch("/module-workflow/{instance_id}/stages/{stage_id}/records/{item_id}")
async def update_record(
    instance_id: _uuid.UUID,
    stage_id: str,
    item_id: str,
    data: UpdateRecordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Update field values for a single record in a record-component stage."""
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)
    _assert_workflow_version(inst, request)

    state = await ensure_workflow_state(db, inst, module)
    stage_state = _get_stage_state_or_404(state, stage_id, instance_id)
    prior_approved = ((state.get("final_approval") or {}).get("status") == "approved")

    stage_data = stage_state.get("data") or {}
    records = stage_data.get("records", {})
    existing = records.get(item_id, {})
    existing.update(data.fields)
    records[item_id] = existing
    stage_data["records"] = records
    stage_state["data"] = stage_data
    clear_final_approval(state)
    save_workflow_state(inst, state, increment_version=True)
    await append_decision_event(
        db,
        inst=inst,
        event_type="record_updated",
        entity_type="record",
        entity_id=item_id,
        stage_id=stage_id,
        actor_user_id=user.uid,
        actor_email=user.email,
        payload={"fields": data.fields},
    )
    if prior_approved and (state.get("final_approval") or {}).get("status") != "approved":
        await append_decision_event(
            db,
            inst=inst,
            event_type="final_approval_revoked",
            entity_type="module",
            actor_user_id=user.uid,
            actor_email=user.email,
            payload={"reason": "record_updated", "stage_id": stage_id, "entity_id": item_id},
        )
    await db.commit()

    return {"item_id": item_id, "record": records[item_id], "workflow_version": inst.workflow_version}


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
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Persist widget_data into the first computed_results stage of the instance.

    Compatibility shim for chat-path calculator widgets that call
    api.persistModuleWorkflowWidget() after an inline edit.
    """
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)
    _assert_workflow_version(inst, request)
    state = await ensure_workflow_state(db, inst, module)
    prior_approved = ((state.get("final_approval") or {}).get("status") == "approved")

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
    await sync_widget_assumptions(
        db,
        initiative_id=inst.initiative_id,
        module_id=module.definition.id,
        widget_data=data.widget_data,
        actor=AssumptionActor(user_id=user.uid, email=user.email or user.uid),
    )
    if stage_state.get("status") == "pending":
        stage_state["status"] = "draft"

    clear_final_approval(state)
    save_workflow_state(inst, state, increment_version=True)
    await append_decision_event(
        db,
        inst=inst,
        event_type="widget_state_updated",
        entity_type="stage",
        entity_id=target_stage_def.id,
        stage_id=target_stage_def.id,
        actor_user_id=user.uid,
        actor_email=user.email,
        payload={"widget_keys": sorted(data.widget_data.keys())},
    )
    if prior_approved and (state.get("final_approval") or {}).get("status") != "approved":
        await append_decision_event(
            db,
            inst=inst,
            event_type="final_approval_revoked",
            entity_type="module",
            actor_user_id=user.uid,
            actor_email=user.email,
            payload={"reason": "widget_state_updated", "stage_id": target_stage_def.id},
        )
    await db.commit()

    return {
        "instance_id": str(instance_id),
        "status": inst.status,
        "workflow_state": state,
        "workflow_version": inst.workflow_version,
    }


# ---------------------------------------------------------------------------
# Final approval
# ---------------------------------------------------------------------------

@router.post("/module-workflow/{instance_id}/final-approval")
async def approve_final_output(
    instance_id: _uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Approve the fully confirmed workflow so it counts as plan-complete."""
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)
    _assert_workflow_version(inst, request)

    state = await ensure_workflow_state(db, inst, module)
    auto_confirm_candidate = _get_auto_confirmable_final_stage(module, state)
    if auto_confirm_candidate is not None:
        final_stage_id, _ = auto_confirm_candidate
        state, _ = await confirm_stage(
            db,
            inst,
            module,
            final_stage_id,
            user.uid,
            confirmed_by_email=user.email,
        )
        confirmed_stage_state = state["stages"].get(final_stage_id, {})
        await append_decision_event(
            db,
            inst=inst,
            event_type="stage_confirmed",
            stage_id=final_stage_id,
            entity_type="stage",
            entity_id=final_stage_id,
            actor_user_id=user.uid,
            actor_email=user.email,
            payload={
                "status": confirmed_stage_state.get("status"),
                "confirmed_at": confirmed_stage_state.get("confirmed_at"),
                "confirmed_by": confirmed_stage_state.get("confirmed_by"),
                "confirmed_by_email": confirmed_stage_state.get("confirmed_by_email"),
            },
        )

    if not _all_required_stages_confirmed(module, state):
        raise HTTPException(
            status_code=400,
            detail="All workflow stages must be confirmed before final approval",
        )

    state["final_approval"] = {
        "status": "approved",
        "approved_at": datetime.now(timezone.utc).isoformat(),
        "approved_by": user.uid,
        "approved_by_email": user.email,
    }
    save_workflow_state(inst, state, increment_version=True)
    await append_decision_event(
        db,
        inst=inst,
        event_type="final_approved",
        entity_type="module",
        actor_user_id=user.uid,
        actor_email=user.email,
        payload=state["final_approval"],
    )
    await db.commit()

    return {
        "workflow_state": state,
        "workflow_version": inst.workflow_version,
    }


@router.delete("/module-workflow/{instance_id}/final-approval")
async def revoke_final_approval(
    instance_id: _uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Revoke final approval so the workflow can return to the approvable state."""
    inst, module = await _get_editable_workflow_instance(db, instance_id, user)
    _assert_workflow_version(inst, request)

    state = await ensure_workflow_state(db, inst, module)
    was_revoked = clear_final_approval(state)
    if was_revoked:
        save_workflow_state(inst, state, increment_version=True)
        await append_decision_event(
            db,
            inst=inst,
            event_type="final_approval_revoked",
            entity_type="module",
            actor_user_id=user.uid,
            actor_email=user.email,
            payload={"reason": "manual_revoke"},
        )
        await db.commit()

    return {
        "workflow_state": state,
        "workflow_version": inst.workflow_version,
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
    except AttributeError as exc:
        if "export_xlsx" not in str(exc):
            raise
        logger.warning(
            "Falling back to legacy calculator export for module '%s': %s",
            module.definition.id,
            exc,
        )
        export_bytes = await _generate_legacy_calculator_export(
            module.definition.id,
            confirmed_stages,
        )

    fmt = module.definition.export_format
    media_types = {
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
    media_type = media_types.get(fmt, "application/octet-stream")

    filename = await _module_export_filename(db=db, inst=inst, module=module, ext=fmt)
    await append_decision_event(
        db,
        inst=inst,
        event_type="exported",
        entity_type="export",
        entity_id=fmt,
        actor_user_id=user.uid,
        actor_email=user.email,
        payload={"format": fmt, "scope": "module"},
    )
    await db.commit()

    return Response(
        content=export_bytes,
        media_type=media_type,
        headers={"Content-Disposition": safe_content_disposition(filename)},
    )


# ---------------------------------------------------------------------------
# Write-up export (LLM-generated, cached)
# ---------------------------------------------------------------------------

@router.get("/module-workflow/{instance_id}/export/writeup")
async def export_writeup(
    instance_id: _uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Export the write-up DOCX for an assessment module.

    The write-up is generated once by LLM and cached in workflow_state.
    Subsequent calls return the cached version instantly unless backing
    stages have been re-confirmed (which invalidates the cache).
    """
    from app.services.docx_exporter import DocxExporterService

    inst, module = await _get_workflow_instance(db, instance_id, user)

    if not hasattr(module, "generate_writeup_content"):
        raise HTTPException(
            status_code=400,
            detail=f"Module '{module.definition.id}' does not support write-up export",
        )

    state = await ensure_workflow_state(db, inst, module)
    cached_exports = state.get("cached_exports") or {}
    cached_writeup = cached_exports.get("writeup") or {}
    context = await get_initiative_context(db, inst.initiative_id)

    confirmed_stages: dict[str, Any] = _build_confirmed_stages_snapshot(state)
    if not confirmed_stages:
        raise HTTPException(
            status_code=400,
            detail="At least one stage must be confirmed before generating a write-up",
        )

    if isinstance(module, StakeholderAssessmentModule):
        stakeholder_items = (confirmed_stages.get("stakeholders") or {}).get("data", {}).get("items", [])
        existing_records = _stakeholder_detail_records(state)
        if stakeholder_items:
            records, changed = await module.ensure_all_stakeholder_details(
                stakeholder_items=stakeholder_items,
                existing_records=existing_records,
                context=context,
                db=db,
                initiative_id=inst.initiative_id,
            )
            if changed:
                state["stakeholder_details"] = records
                await _refresh_stakeholder_map_widget(module, state, context, records)
                if state.get("cached_exports"):
                    state["cached_exports"] = {}
                save_workflow_state(inst, state, increment_version=True)
                await db.commit()
                cached_writeup = {}
                confirmed_stages = _build_confirmed_stages_snapshot(state)
            elif records:
                confirmed_stages["stakeholder_details"] = {"data": {"records": records}}

    # Use cache if valid (not explicitly invalidated)
    content = cached_writeup.get("content") if not cached_writeup.get("invalidated") else None

    if not content:
        try:
            if isinstance(module, StakeholderAssessmentModule):
                records = _stakeholder_detail_records(state)
                if records:
                    confirmed_stages["stakeholder_details"] = {"data": {"records": records}}
            content = await module.generate_writeup_content(confirmed_stages, context)
        except Exception as e:
            logger.error("Write-up generation failed for instance %s: %s", instance_id, e, exc_info=True)
            raise HTTPException(status_code=500, detail=f"Write-up generation failed: {e}")

        # Cache the generated content
        state.setdefault("cached_exports", {})["writeup"] = {
            "content": content,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "invalidated": False,
        }
        save_workflow_state(inst, state)
        await db.commit()
    else:
        logger.info("Returning cached write-up for instance %s", instance_id)

    docx_bytes = DocxExporterService().generate_assessment_docx(
        content=content,
        initiative_title=context.get("project_title", ""),
    )

    filename = await _module_export_filename(
        db=db,
        inst=inst,
        module=module,
        ext="docx",
        prefix="writeup",
    )

    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": safe_content_disposition(filename)},
    )


# ---------------------------------------------------------------------------
# Module-scoped decision log (deterministic, no LLM, always fast)
# ---------------------------------------------------------------------------

@router.get("/module-workflow/{instance_id}/decision-log")
async def get_module_decision_log(
    instance_id: _uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Return module-scoped, value-level decision history rows."""
    inst, module = await _get_workflow_instance(db, instance_id, user)
    state = await ensure_workflow_state(db, inst, module)
    return build_module_decision_history_report(
        workflow_state=state,
        stage_defs=module.stage_defs,
        module_id=inst.module_id,
        module_name=module.definition.name,
        module_instance_id=str(inst.id),
    )


@router.get("/module-workflow/{instance_id}/decision-log/export.xlsx")
async def export_module_decision_log_xlsx(
    instance_id: _uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Export module-scoped decision history as XLSX."""
    inst, module = await _get_workflow_instance(db, instance_id, user)
    state = await ensure_workflow_state(db, inst, module)
    report = build_module_decision_history_report(
        workflow_state=state,
        stage_defs=module.stage_defs,
        module_id=inst.module_id,
        module_name=module.definition.name,
        module_instance_id=str(inst.id),
    )
    xlsx_bytes = build_module_decision_log_xlsx(report)

    await append_decision_event(
        db,
        inst=inst,
        event_type="decision_log_exported",
        entity_type="export",
        entity_id="xlsx",
        actor_user_id=user.uid,
        actor_email=user.email,
        payload={"format": "xlsx", "scope": "module"},
    )
    await db.commit()

    filename = await _module_export_filename(
        db=db,
        inst=inst,
        module=module,
        ext="xlsx",
        prefix="log",
    )

    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": safe_content_disposition(filename)},
    )
