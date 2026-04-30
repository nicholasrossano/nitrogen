"""Unified staged module workflow service.

Every module is an ordered sequence of stages. Each stage is a confirmable
workspace. The workflow state stored in module_instances.workflow_state is:

{
    "module_type": "stakeholder_assessment",
    "current_stage_id": "categories",
    "stages": {
        "categories": {
            "status": "confirmed",    # pending | populating | draft | confirmed | error
            "confirmed_at": "2024-01-01T00:00:00+00:00",
            "confirmed_by": "user:abc123",
            "data": { "items": [...] }   # shape depends on component type
        },
        "stakeholders": {
            "status": "draft",
            "confirmed_at": null,
            "confirmed_by": null,
            "data": { "items": [...] }
        },
        "details": {
            "status": "pending",
            "confirmed_at": null,
            "confirmed_by": null,
            "data": null
        }
    }
}

Stage data shapes by component type:
  table / list:       { "items": [{ id, content, provenance, ... }] }
  record:             { "source_stage_id": str, "records": { item_id: { field: val } } }
  computed_results:   { "widget_data": { ... } }
"""

from __future__ import annotations

import copy
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.initiative import Initiative
from app.models.module_instance import ModuleInstance
from app.modules.base import BaseModule, StageDef
from app.modules.utils import make_build_item
from app.services.assumptions import (
    AssumptionActor,
    apply_assumptions_to_items,
    assumptions_as_context,
    sync_stage_assumptions,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------------------------

def save_workflow_state(
    inst: ModuleInstance,
    state: dict[str, Any],
    *,
    increment_version: bool = False,
) -> None:
    inst.workflow_state = state
    flag_modified(inst, "workflow_state")
    if increment_version:
        inst.workflow_version = (inst.workflow_version or 1) + 1


def _initial_final_approval_state() -> dict[str, Any]:
    return {
        "status": "pending",
        "approved_at": None,
        "approved_by": None,
        "approved_by_email": None,
    }


def requires_final_approval(module: BaseModule) -> bool:
    """Whether a workspace module should require explicit final approval."""
    return bool(module.stage_defs)


def clear_final_approval(state: dict[str, Any]) -> bool:
    """Reset final approval after a meaningful workflow mutation."""
    existing = state.get("final_approval") or _initial_final_approval_state()
    if existing.get("status") != "approved":
        state["final_approval"] = existing
        return False
    state["final_approval"] = _initial_final_approval_state()
    return True


def build_deliverable_title(module: BaseModule, content: dict[str, Any] | None) -> str:
    if isinstance(content, dict):
        title = content.get("title")
        if isinstance(title, str) and title.strip():
            return title.strip()
    return module.definition.name


# ---------------------------------------------------------------------------
# Initiative context helpers
# ---------------------------------------------------------------------------

async def get_initiative_context(db: AsyncSession, initiative_id: Any) -> dict[str, Any]:
    initiative = await db.get(Initiative, initiative_id)
    if initiative is None:
        return {}
    return {
        "initiative_id": str(initiative_id),
        "project_title": initiative.title or "",
        "project_description": initiative.project_description or initiative.goal or "",
        "geography": initiative.geography or "",
        "target_population": initiative.target_population or "",
        "project_type": initiative.project_type or "",
        "project_plan": initiative.project_plan or {},
        "tool_inputs": dict(initiative.tool_inputs or {}),
        "assumptions": await assumptions_as_context(db, initiative.id),
    }


# ---------------------------------------------------------------------------
# Initial state builder
# ---------------------------------------------------------------------------

def _initial_stage_state() -> dict[str, Any]:
    return {
        "status": "pending",
        "confirmed_at": None,
        "confirmed_by": None,
        "confirmed_by_email": None,
        "data": None,
    }


def _build_initial_workflow_state(module: BaseModule) -> dict[str, Any]:
    """Build the initial workflow state dict from the module's stage_defs."""
    stage_defs = module.stage_defs
    stages: dict[str, Any] = {}
    for stage_def in stage_defs:
        stages[stage_def.id] = _initial_stage_state()

    first_id = stage_defs[0].id if stage_defs else None
    return {
        "module_type": module.definition.id,
        "current_stage_id": first_id,
        "stages": stages,
        "final_approval": _initial_final_approval_state(),
    }


def _infer_current_stage_id(module: BaseModule, stages: dict[str, Any]) -> str | None:
    """First stage whose status is not 'confirmed'; last stage if all confirmed."""
    stage_defs = module.stage_defs
    if not stage_defs:
        return None
    for stage_def in stage_defs:
        stage_state = stages.get(stage_def.id, {})
        if stage_state.get("status") != "confirmed":
            return stage_def.id
    return stage_defs[-1].id


# ---------------------------------------------------------------------------
# Legacy state migration
# ---------------------------------------------------------------------------

def _migrate_legacy_state(old_state: dict[str, Any], module: BaseModule) -> dict[str, Any]:
    """Convert old {setup, build, output} state to the new flat {stages} shape.

    Best-effort: any stage that cannot be mapped gets status="pending".
    Handles four legacy shapes:
      1. build.stages[]:          list of {id, items, widget_data, status}
      2. build.layers{}:          dict of {stage_id: {items, widget_data}}
      3. build.widget_state{}:    single widget blob (calculator modules)
      4. output.widget_data:      top-level output blob (calculator modules)
    """
    new_state = _build_initial_workflow_state(module)
    stages = new_state["stages"]
    stage_defs = module.stage_defs

    old_build = old_state.get("build", {})
    old_output = old_state.get("output", {})

    old_build_stages: list[dict] = old_build.get("stages", [])

    # layers{} format (old assessment modules)
    if not old_build_stages and old_build.get("layers"):
        old_build_stages = [
            {
                "id": k,
                "items": v.get("items", []),
                "stage_type": "simple_list",
                "widget_data": v.get("widget_data"),
                "status": v.get("status", "pending"),
            }
            for k, v in old_build.get("layers", {}).items()
        ]

    old_by_id = {s["id"]: s for s in old_build_stages}

    for stage_def in stage_defs:
        old_stage = old_by_id.get(stage_def.id)
        if old_stage is None:
            continue

        old_items = old_stage.get("items")
        old_widget_data = old_stage.get("widget_data")

        if stage_def.component == "computed_results" and old_widget_data:
            stages[stage_def.id]["data"] = {"widget_data": old_widget_data}
            stages[stage_def.id]["status"] = "draft"
        elif old_items:
            stages[stage_def.id]["data"] = {"items": old_items}
            old_status = old_stage.get("status", "pending")
            if old_status in ("confirmed", "complete"):
                stages[stage_def.id]["status"] = "confirmed"
                stages[stage_def.id]["confirmed_at"] = old_stage.get("confirmed_at")
            elif old_status in ("in_progress", "generating", "draft"):
                stages[stage_def.id]["status"] = "draft"

    # widget_state blob (old calculator modules stored results in build.widget_state)
    old_widget_state = old_build.get("widget_state") or {}
    if old_widget_state and not old_by_id:
        widget_data = old_widget_state.get("widget_data") or old_widget_state
        # Map to the last computed_results stage
        for stage_def in reversed(stage_defs):
            if stage_def.component == "computed_results":
                if widget_data:
                    stages[stage_def.id]["data"] = {"widget_data": widget_data}
                    stages[stage_def.id]["status"] = "draft"
                break

    # output.widget_data blob (another legacy calculator format)
    old_output_data = old_output.get("widget_data") or old_output.get("data")
    if old_output_data and not old_by_id:
        for stage_def in reversed(stage_defs):
            if stage_def.component == "computed_results":
                stages[stage_def.id]["data"] = {"widget_data": old_output_data}
                stages[stage_def.id]["status"] = "draft"
                break

    new_state["current_stage_id"] = _infer_current_stage_id(module, stages)
    logger.info(
        "Migrated legacy workflow state for module '%s'", module.definition.id
    )
    return new_state


def _is_legacy_state(state: dict[str, Any]) -> bool:
    """Return True if this is the old {setup, build, output} shape."""
    return "setup" in state or "build" in state or "output" in state


# ---------------------------------------------------------------------------
# Downstream invalidation
# ---------------------------------------------------------------------------

def _get_downstream_stage_ids(module: BaseModule, changed_stage_id: str) -> list[str]:
    """Return stage IDs that directly depend on changed_stage_id via population steps."""
    stage_defs = module.stage_defs
    downstream = []
    # Find the index of the changed stage
    changed_idx = next(
        (i for i, s in enumerate(stage_defs) if s.id == changed_stage_id), -1
    )
    if changed_idx < 0:
        return []

    for stage_def in stage_defs[changed_idx + 1:]:
        for step in stage_def.population:
            if (
                step.type == "read_confirmed_prior_stage"
                and step.config.get("stage_id") == changed_stage_id
            ):
                downstream.append(stage_def.id)
                break

    return downstream


def _invalidate_downstream(
    state: dict[str, Any],
    module: BaseModule,
    changed_stage_id: str,
) -> None:
    """Reset all downstream stages that depend on changed_stage_id to pending."""
    for stage_id in _get_downstream_stage_ids(module, changed_stage_id):
        if stage_id in state["stages"]:
            state["stages"][stage_id] = _initial_stage_state()
            logger.debug(
                "Invalidated downstream stage '%s' after '%s' was re-confirmed",
                stage_id, changed_stage_id,
            )


# ---------------------------------------------------------------------------
# State hydration helper
# ---------------------------------------------------------------------------

def _hydrate_state(inst: ModuleInstance, module: BaseModule) -> dict[str, Any]:
    """Return a deepcopy of workflow_state with any missing stage keys added.

    This ensures that stages added to a module after an instance was created
    (e.g. a new 'map' stage) are present in the returned state without
    requiring a full legacy migration.
    """
    existing = copy.deepcopy(inst.workflow_state) if inst.workflow_state else None
    if existing is None:
        return _build_initial_workflow_state(module)
    if _is_legacy_state(existing):
        return _migrate_legacy_state(existing, module)
    # Add any stages defined in the module that aren't in the stored state
    stages = existing.setdefault("stages", {})
    for stage_def in module.stage_defs:
        if stage_def.id not in stages:
            stages[stage_def.id] = _initial_stage_state()
    existing.setdefault("final_approval", _initial_final_approval_state())
    if not existing.get("current_stage_id"):
        existing["current_stage_id"] = _infer_current_stage_id(module, stages)
    return existing


# ---------------------------------------------------------------------------
# Population step executor
# ---------------------------------------------------------------------------

async def populate_stage(
    db: AsyncSession,
    inst: ModuleInstance,
    module: BaseModule,
    stage_id: str,
) -> dict[str, Any]:
    """Run the population pipeline for a stage and persist the result.

    Returns the updated workflow state.
    """
    state = _hydrate_state(inst, module)

    if stage_id not in state["stages"]:
        raise ValueError(f"Stage '{stage_id}' not found in module '{module.definition.id}'")

    stage_def = next((s for s in module.stage_defs if s.id == stage_id), None)
    if stage_def is None:
        raise ValueError(f"Stage '{stage_id}' not found in stage_defs for '{module.definition.id}'")

    context = await get_initiative_context(db, inst.initiative_id)
    context["_db"] = db

    # Mark as populating
    state["stages"][stage_id]["status"] = "populating"
    state["current_stage_id"] = stage_id
    save_workflow_state(inst, state)

    # Build confirmed_stages snapshot for reference by population steps
    confirmed_stages: dict[str, Any] = {
        sid: s_state for sid, s_state in state["stages"].items()
        if s_state.get("status") == "confirmed"
    }

    # Accumulated data for this stage
    accumulated_data: dict[str, Any] = {}

    try:
        for step in stage_def.population:
            accumulated_data = await _execute_population_step(
                step_type=step.type,
                config=step.config,
                stage_def=stage_def,
                accumulated_data=accumulated_data,
                confirmed_stages=confirmed_stages,
                module=module,
                context=context,
                db=db,
            )
            if step.type == "await_user_confirmation":
                # Pipeline terminates here
                break

        state["stages"][stage_id]["data"] = accumulated_data

        # If AI generation steps ran but produced no items, surface as error
        # so the frontend can offer a retry instead of a stuck disabled-Confirm state.
        ai_steps_ran = any(
            s.type in ("propose_with_ai", "adapt_with_ai_from_project_materials")
            for s in stage_def.population
        )
        items_empty = stage_def.component in ("list", "table") and not accumulated_data.get("items")
        if ai_steps_ran and items_empty:
            state["stages"][stage_id]["status"] = "error"
        else:
            state["stages"][stage_id]["status"] = "draft"

        state["current_stage_id"] = stage_id
        clear_final_approval(state)
        save_workflow_state(inst, state, increment_version=True)

    except Exception as e:
        logger.error(
            "Population failed for stage '%s' on instance '%s': %s",
            stage_id, inst.id, e, exc_info=True,
        )
        state["stages"][stage_id]["status"] = "error"
        save_workflow_state(inst, state, increment_version=True)
        raise

    return state


async def _execute_population_step(
    step_type: str,
    config: dict,
    stage_def: StageDef,
    accumulated_data: dict[str, Any],
    confirmed_stages: dict[str, Any],
    module: BaseModule,
    context: dict,
    db: AsyncSession,
) -> dict[str, Any]:
    """Execute a single population step and return the merged accumulated data."""

    if step_type == "await_user_confirmation":
        # Terminal signal — caller breaks out of loop
        return accumulated_data

    if step_type == "start_from_predefined_rows":
        rows = await module.get_predefined_rows(stage_def.id, context)
        items = [
            make_build_item(content=row, derivation="template")
            for row in rows
        ]
        items = apply_assumptions_to_items(
            items,
            context.get("assumptions") or [],
            module_id=module.definition.id,
        )
        existing = accumulated_data.get("items", [])
        return {"items": existing + items}

    if step_type == "seed_from_template":
        raw_items = await module.generate_items_for_stage(
            stage_def.id, step_type, context, confirmed_stages
        )
        items = [
            make_build_item(content=raw, derivation="template")
            for raw in raw_items
        ]
        existing = accumulated_data.get("items", [])
        return {"items": existing + items}

    if step_type in ("propose_with_ai", "adapt_with_ai_from_project_materials"):
        existing = accumulated_data.get("items", [])
        if step_type == "adapt_with_ai_from_project_materials" and existing:
            return accumulated_data
        raw_items = await module.generate_items_for_stage(
            stage_def.id, step_type, context, confirmed_stages
        )
        items = [
            make_build_item(content=raw, derivation="inferred")
            for raw in raw_items
        ]
        return {"items": existing + items}

    if step_type == "extract_from_project_materials":
        # RAG retrieval — attempt to augment existing items with evidence
        # For now this is a no-op that passes through; modules that need RAG
        # implement it inside generate_items_for_stage with the retrieval adapter.
        return accumulated_data

    if step_type == "infer_missing_with_ai":
        # For table stages: fill empty values in existing rows via LLM.
        # Assessment modules handle this within generate_items_for_stage.
        # For calculator modules this is also handled in get_predefined_rows
        # (engine provides defaults). Pass through.
        return accumulated_data

    if step_type == "read_confirmed_prior_stage":
        prior_stage_id = config.get("stage_id")
        if not prior_stage_id:
            return accumulated_data
        prior_state = confirmed_stages.get(prior_stage_id)
        if prior_state is None:
            raise ValueError(
                f"Stage '{prior_stage_id}' is not confirmed — "
                f"cannot read_confirmed_prior_stage in population step"
            )
        prior_data = prior_state.get("data") or {}

        if stage_def.component == "record":
            # Initialize empty records from prior list items
            prior_items = prior_data.get("items", [])
            existing_records = accumulated_data.get("records", {})
            records = {item["id"]: existing_records.get(item["id"], {}) for item in prior_items}
            return {
                "source_stage_id": prior_stage_id,
                "records": records,
            }
        else:
            # For list/table stages, expose prior items as context (already in confirmed_stages)
            return accumulated_data

    if step_type == "enrich_selected_item_with_ai":
        if config.get("bulk") and stage_def.component == "record":
            source_stage_id = accumulated_data.get("source_stage_id")
            if not source_stage_id:
                return accumulated_data
            prior_state = confirmed_stages.get(source_stage_id) or {}
            source_items = (prior_state.get("data") or {}).get("items", [])
            existing_records = accumulated_data.get("records", {})
            bulk_enricher = getattr(module, "enrich_records_for_stage", None)
            if callable(bulk_enricher):
                records = await bulk_enricher(stage_def.id, source_items, existing_records, context)
                return {
                    **accumulated_data,
                    "records": records,
                }

        # Enrichment is on-demand per-record, not bulk. This step during
        # population just ensures the record structure is initialized from
        # read_confirmed_prior_stage (which must have run first). No-op here.
        return accumulated_data

    if step_type == "compute_with_module_logic":
        widget_data = await module.compute_stage(stage_def.id, confirmed_stages, context)
        return {"widget_data": widget_data}

    if step_type == "compute_with_external_tool":
        tool = config.get("tool", "")
        widget_data = await module.compute_external(stage_def.id, tool, confirmed_stages, context)
        return {"widget_data": widget_data}

    logger.warning("Unknown population step type: '%s' — skipping", step_type)
    return accumulated_data


# ---------------------------------------------------------------------------
# Stage confirmation
# ---------------------------------------------------------------------------

async def confirm_stage(
    db: AsyncSession,
    inst: ModuleInstance,
    module: BaseModule,
    stage_id: str,
    confirmed_by: str,
    confirmed_by_email: str | None = None,
) -> dict[str, Any]:
    """Confirm a stage, record audit info, and invalidate downstream stages."""
    state = _hydrate_state(inst, module)

    if stage_id not in state["stages"]:
        raise ValueError(f"Stage '{stage_id}' not found")

    stage_state = state["stages"][stage_id]
    stage_state["status"] = "confirmed"
    stage_state["confirmed_at"] = datetime.now(timezone.utc).isoformat()
    stage_state["confirmed_by"] = confirmed_by
    stage_state["confirmed_by_email"] = confirmed_by_email

    await sync_stage_assumptions(
        db,
        initiative_id=inst.initiative_id,
        module_id=module.definition.id,
        stage_id=stage_id,
        stage_data=stage_state.get("data") or {},
        actor=AssumptionActor(user_id=confirmed_by, email=confirmed_by_email or confirmed_by),
        status="confirmed",
    )

    _invalidate_downstream(state, module, stage_id)

    # Invalidate cached write-up whenever a non-computed stage is confirmed,
    # since the underlying data has changed.
    stage_def_being_confirmed = next(
        (s for s in module.stage_defs if s.id == stage_id), None
    )
    if stage_def_being_confirmed and stage_def_being_confirmed.component != "computed_results":
        if state.get("cached_exports"):
            state["cached_exports"] = {}

    state["current_stage_id"] = _infer_current_stage_id(module, state["stages"])
    clear_final_approval(state)

    # Trigger auto-population of the next computed_results stage, if any
    next_stage_def = _get_auto_populate_stage(module, stage_id, state)

    save_workflow_state(inst, state, increment_version=True)
    return state, next_stage_def


def _get_auto_populate_stage(
    module: BaseModule,
    confirmed_stage_id: str,
    state: dict[str, Any],
) -> StageDef | None:
    """Return the next stage if it should be auto-populated after confirmation."""
    stage_defs = module.stage_defs
    confirmed_idx = next(
        (i for i, s in enumerate(stage_defs) if s.id == confirmed_stage_id), -1
    )
    if confirmed_idx < 0 or confirmed_idx + 1 >= len(stage_defs):
        return None

    next_def = stage_defs[confirmed_idx + 1]
    next_state = state["stages"].get(next_def.id, {})

    # Auto-populate if: next stage is pending AND has a read_confirmed_prior_stage
    # pointing to the just-confirmed stage. This covers calculator outputs as
    # well as assessment follow-on stages (e.g. categories -> entities).
    if next_state.get("status") != "pending":
        return None

    for step in next_def.population:
        if (
            step.type == "read_confirmed_prior_stage"
            and step.config.get("stage_id") == confirmed_stage_id
        ):
            # If the next stage has any executable population step, auto-run it.
            has_executable_steps = any(
                s.type != "await_user_confirmation"
                for s in next_def.population
            )
            if has_executable_steps:
                return next_def
            break

    return None


# ---------------------------------------------------------------------------
# Record enrichment
# ---------------------------------------------------------------------------

async def enrich_record_item(
    db: AsyncSession,
    inst: ModuleInstance,
    module: BaseModule,
    stage_id: str,
    item_id: str,
) -> dict[str, Any]:
    """AI-enrich a single record item and persist the result."""
    state = inst.workflow_state or _build_initial_workflow_state(module)
    if _is_legacy_state(state):
        state = _migrate_legacy_state(state, module)

    stage_state = state["stages"].get(stage_id)
    if not stage_state:
        raise ValueError(f"Stage '{stage_id}' not found")

    data = stage_state.get("data") or {}
    records = data.get("records", {})
    source_stage_id = data.get("source_stage_id")

    if not source_stage_id:
        raise ValueError(f"Stage '{stage_id}' has no source_stage_id — cannot enrich records")

    # Find the source item content from the prior stage
    source_stage_state = state["stages"].get(source_stage_id, {})
    source_items = (source_stage_state.get("data") or {}).get("items", [])
    source_item = next((it for it in source_items if it["id"] == item_id), None)
    if source_item is None:
        raise ValueError(f"Source item '{item_id}' not found in stage '{source_stage_id}'")

    item_content = source_item.get("content", {})
    existing_record = records.get(item_id, {})
    context = await get_initiative_context(db, inst.initiative_id)
    context["_db"] = db

    enriched = await module.enrich_record(stage_id, item_content, existing_record, context)
    records[item_id] = enriched
    data["records"] = records
    stage_state["data"] = data

    clear_final_approval(state)
    save_workflow_state(inst, state, increment_version=True)
    return enriched


# ---------------------------------------------------------------------------
# Top-level state builders
# ---------------------------------------------------------------------------

async def build_workflow_state(
    db: AsyncSession,
    inst: ModuleInstance,
    module: BaseModule,
) -> dict[str, Any]:
    """Return the canonical workflow state, migrating legacy state if needed."""
    existing = copy.deepcopy(inst.workflow_state) if inst.workflow_state else None

    if existing is None:
        return _build_initial_workflow_state(module)

    if _is_legacy_state(existing):
        return _migrate_legacy_state(existing, module)

    # Ensure all stage_defs are represented (new stages added since last save)
    stages = existing.setdefault("stages", {})
    for stage_def in module.stage_defs:
        if stage_def.id not in stages:
            stages[stage_def.id] = _initial_stage_state()

    # Recompute current_stage_id if missing
    if not existing.get("current_stage_id"):
        existing["current_stage_id"] = _infer_current_stage_id(module, stages)

    return existing


async def ensure_workflow_state(
    db: AsyncSession,
    inst: ModuleInstance,
    module: BaseModule,
) -> dict[str, Any]:
    """Ensure workflow_state exists and reflects the latest instance state."""
    state = await build_workflow_state(db, inst, module)
    save_workflow_state(inst, state)
    return state


# ---------------------------------------------------------------------------
# Capability helpers (kept for compatibility, now derived from stage_defs)
# ---------------------------------------------------------------------------

def uses_workspace_flow(module: BaseModule) -> bool:
    """Whether the module can open inside the workspace flow."""
    return bool(module.stage_defs)


def is_calculator_module(module: BaseModule) -> bool:
    """Whether any stage uses compute_with_module_logic or compute_with_external_tool."""
    for stage_def in module.stage_defs:
        for step in stage_def.population:
            if step.type in ("compute_with_module_logic", "compute_with_external_tool"):
                return True
    return False


def is_assessment_module(module: BaseModule) -> bool:
    """Whether any stage uses AI item generation steps (assessment pattern)."""
    for stage_def in module.stage_defs:
        for step in stage_def.population:
            if step.type in (
                "seed_from_template", "propose_with_ai",
                "adapt_with_ai_from_project_materials", "enrich_selected_item_with_ai",
            ):
                return True
    return False
