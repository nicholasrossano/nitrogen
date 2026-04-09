"""Helpers for the unified module workflow lifecycle.

All modules — whether widget-backed calculators or layered assessments — share
the same `setup -> build -> output` lifecycle.  The build stage is represented
as a single ``build.stages[]`` array:

  Widget module:   one stage with stage_type="widget"
  Assessment:      N stages with stage_type="simple_list" | "structured_list"

The workflow service is generic over stage type.  It never branches on module
family or inspects ``module_id`` strings.
"""

from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.initiative import Initiative
from app.models.module_instance import ModuleInstance, ModuleInstanceStatus
from app.modules.assessment_base import (
    BaseAssessmentModule,
    get_build_stage,
    layers_as_dict,
    make_initial_workflow_state,
)
from app.modules.base import BaseModule
from app.services import module_service


# ---------------------------------------------------------------------------
# Module capability checks (read from declared contract, not class hierarchy)
# ---------------------------------------------------------------------------

def uses_workspace_flow(module: BaseModule) -> bool:
    """Whether the module can open inside the unified workspace flow."""
    return (
        isinstance(module, BaseAssessmentModule)
        or callable(getattr(module, "recalculate", None))
    )


def uses_layered_build(module: BaseModule) -> bool:
    """Whether the build stage uses the layered item editor (assessment modules)."""
    return isinstance(module, BaseAssessmentModule)


def uses_recalculating_build(module: BaseModule) -> bool:
    """Whether the build stage is a widget-backed input editor (calculator modules)."""
    return callable(getattr(module, "recalculate", None))


# ---------------------------------------------------------------------------
# Stage helpers
# ---------------------------------------------------------------------------

def _make_widget_stage(module: BaseModule) -> dict:
    """Return a single widget-type build stage for a calculator module."""
    return {
        "id": "main",
        "name": module.definition.name,
        "stage_type": "widget",
        "status": "pending",
        "widget_type": module.manifest.workspace_build_widget,
        "widget_data": None,
        "items": None,
        "view_config": {},
    }


# ---------------------------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------------------------

def save_workflow_state(inst: ModuleInstance, state: dict[str, Any]) -> None:
    """Persist workflow state on the instance."""
    inst.workflow_state = state
    flag_modified(inst, "workflow_state")


def build_deliverable_title(module: BaseModule, content: dict[str, Any] | None) -> str:
    """Best-effort deliverable title for workflow-backed outputs."""
    if isinstance(content, dict):
        title = content.get("title")
        if isinstance(title, str) and title.strip():
            return title.strip()
    return module.definition.name


# ---------------------------------------------------------------------------
# Initiative context helpers
# ---------------------------------------------------------------------------

async def get_initiative_context(db: AsyncSession, initiative_id) -> dict[str, str]:
    """Build a normalized initiative context dict for workflow generation."""
    initiative = await db.get(Initiative, initiative_id)
    if initiative is None:
        return {}
    return {
        "project_title": initiative.title or "",
        "project_description": initiative.project_description or initiative.goal or "",
        "geography": initiative.geography or "",
        "target_population": initiative.target_population or "",
    }


def _build_known_values_from_initiative(initiative: Initiative | None) -> dict[str, Any]:
    known_values: dict[str, Any] = {}
    if initiative is None:
        return known_values

    tool_inputs = dict(initiative.tool_inputs or {})
    known_values.update({k: v for k, v in tool_inputs.items() if v is not None})

    if initiative.geography and "address" not in known_values:
        known_values["address"] = initiative.geography
    if initiative.project_type and "technology_type" not in known_values:
        known_values["technology_type"] = initiative.project_type

    return known_values


def get_workspace_setup_fields(module: BaseModule) -> list[dict[str, Any]]:
    """Return setup field definitions for workspace modules."""
    if isinstance(module, BaseAssessmentModule):
        return module.assessment_definition.to_dict()["setup_fields"]
    return copy.deepcopy(module.workspace_setup_fields)


def _build_setup_fields_from_context(
    module: BaseModule,
    initiative: Initiative | None,
) -> dict[str, Any]:
    if initiative is None:
        return {}

    context = {
        "project_title": getattr(initiative, "title", None),
        "project_description": getattr(initiative, "project_description", None) or getattr(initiative, "goal", None),
        "project_goal": getattr(initiative, "goal", None) or getattr(initiative, "project_description", None),
        "geography": getattr(initiative, "geography", None),
        "address": getattr(initiative, "geography", None),
        "target_population": getattr(initiative, "target_population", None),
        "target_beneficiaries": getattr(initiative, "target_population", None),
        "technology_type": getattr(initiative, "project_type", None),
        "project_type": getattr(initiative, "project_type", None),
    }
    tool_inputs = dict(getattr(initiative, "tool_inputs", {}) or {})
    if tool_inputs.get("method_pack"):
        context["method_pack"] = tool_inputs["method_pack"]

    fields: dict[str, Any] = {}
    for field_def in get_workspace_setup_fields(module):
        value = tool_inputs.get(field_def["name"], context.get(field_def["name"]))
        if value is not None:
            fields[field_def["name"]] = value
    return fields


def _merge_setup_fields(
    known_values: dict[str, Any],
    setup_fields: dict[str, Any] | None,
) -> dict[str, Any]:
    merged = dict(known_values)
    for key, value in (setup_fields or {}).items():
        if value in (None, ""):
            continue
        merged[key] = value

    if merged.get("geography") and "address" not in merged:
        merged["address"] = merged["geography"]
    if merged.get("address") and "geography" not in merged:
        merged["geography"] = merged["address"]
    if merged.get("project_description") and "project_goal" not in merged:
        merged["project_goal"] = merged["project_description"]
    if merged.get("project_goal") and "project_description" not in merged:
        merged["project_description"] = merged["project_goal"]
    if merged.get("target_population") and "target_beneficiaries" not in merged:
        merged["target_beneficiaries"] = merged["target_population"]
    if merged.get("target_beneficiaries") and "target_population" not in merged:
        merged["target_population"] = merged["target_beneficiaries"]
    return merged


# ---------------------------------------------------------------------------
# Stage-level state builders
# ---------------------------------------------------------------------------

async def _build_calculator_widget_data(
    db: AsyncSession,
    inst: ModuleInstance,
    module: BaseModule,
    setup_fields: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return initial widget data for a calculator module's main stage."""
    if inst.deliverable and isinstance(inst.deliverable.get("content"), dict):
        return copy.deepcopy(inst.deliverable["content"])

    # Check if existing workflow state has data in the main widget stage
    existing_build = (inst.workflow_state or {}).get("build", {})
    for stage in existing_build.get("stages", []):
        if stage.get("stage_type") == "widget" and isinstance(stage.get("widget_data"), dict):
            return copy.deepcopy(stage["widget_data"])

    initiative = await db.get(Initiative, inst.initiative_id)
    known_values = _merge_setup_fields(
        _build_known_values_from_initiative(initiative),
        setup_fields,
    )
    return await module.build_workspace_widget_data(known_values)


async def _build_setup_state(
    db: AsyncSession,
    inst: ModuleInstance,
    module: BaseModule,
    existing_state: dict[str, Any] | None,
) -> dict[str, Any]:
    if existing_state and isinstance(existing_state.get("setup"), dict):
        setup = copy.deepcopy(existing_state["setup"])
    else:
        setup = {
            "mode": "form",
            "fields": {},
            "confirmed": False,
            "confirmed_at": None,
        }

    setup["mode"] = "form"
    if not setup.get("fields"):
        if uses_layered_build(module):
            context = await get_initiative_context(db, inst.initiative_id)
            try:
                defaults = await module.generate_setup_defaults(db, inst.initiative_id, context)
                setup["fields"] = defaults
            except Exception:
                setup["fields"] = {}
        else:
            initiative = await db.get(Initiative, inst.initiative_id)
            setup["fields"] = _build_setup_fields_from_context(module, initiative)

    return setup


async def _build_build_state(
    db: AsyncSession,
    inst: ModuleInstance,
    module: BaseModule,
    existing_state: dict[str, Any] | None,
    setup_state: dict[str, Any],
) -> dict[str, Any]:
    """Build the canonical build state using unified stages[]."""

    if uses_layered_build(module):
        # --- Assessment module: N ordered list stages ---
        if existing_state and isinstance(existing_state.get("build"), dict):
            existing_build = existing_state["build"]
            # Migrate legacy layers{} format to stages[] if needed
            if "layers" in existing_build and "stages" not in existing_build:
                existing_build = _migrate_legacy_build(existing_build, module)
            build = copy.deepcopy(existing_build)
        else:
            build = make_initial_workflow_state(
                module.definition.id,
                module.assessment_definition,
            )["build"]
        build.setdefault("current_stage_id", build.get("stages", [{}])[0].get("id") if build.get("stages") else None)
        return build

    # --- Widget module: single widget stage ---
    if not setup_state.get("confirmed"):
        return {
            "stages": [_make_widget_stage(module)],
            "current_stage_id": "main",
        }

    if uses_recalculating_build(module):
        widget_data = await _build_calculator_widget_data(db, inst, module, setup_state.get("fields"))
        stage = _make_widget_stage(module)
        stage["widget_data"] = widget_data
        stage["status"] = "complete" if widget_data.get("computable") else "in_progress"
        return {
            "stages": [stage],
            "current_stage_id": "main",
        }

    raise ValueError(f"Module '{module.definition.id}' is not configured for workspace build flow")


def _migrate_legacy_build(existing_build: dict, module: BaseModule) -> dict:
    """Migrate a legacy layers{} build state to stages[] format.

    Pre-migration format (assessment):
      { "current_layer": "outline", "layers": { "outline": {status, items}, ... } }

    Post-migration format:
      { "stages": [...], "current_stage_id": "outline" }
    """
    layers_dict = existing_build.get("layers", {})
    current_layer = existing_build.get("current_layer")

    stages = []
    for layer_def in module.assessment_definition.build_layers:
        old_layer = layers_dict.get(layer_def.id, {})
        stages.append({
            "id": layer_def.id,
            "name": layer_def.name,
            "stage_type": layer_def.view_type,
            "status": old_layer.get("status", "pending"),
            "widget_type": None,
            "widget_data": None,
            "items": old_layer.get("items", []),
            "view_config": {
                "removable": layer_def.removable,
                "item_schema": layer_def.item_schema,
                "description": layer_def.description,
            },
        })

    return {
        "stages": stages,
        "current_stage_id": current_layer or (stages[0]["id"] if stages else None),
    }


async def _build_output_state(
    db: AsyncSession,
    inst: ModuleInstance,
    module: BaseModule,
    existing_state: dict[str, Any] | None,
    build_state: dict[str, Any],
) -> dict[str, Any]:
    if uses_layered_build(module):
        if existing_state and isinstance(existing_state.get("output"), dict):
            output = copy.deepcopy(existing_state["output"])
        else:
            output = {
                "status": "pending",
                "content": None,
            }
        output["widget_type"] = module.manifest.workspace_output_widget
        output["widget_data"] = None
        return output

    if uses_recalculating_build(module):
        # Pull widget data from the main stage
        stages = build_state.get("stages", [])
        main_stage = next((s for s in stages if s.get("id") == "main"), None)
        widget_data = copy.deepcopy(main_stage.get("widget_data")) if main_stage else None
        is_complete = bool(widget_data and widget_data.get("computable"))
        return {
            "status": "complete" if is_complete else "pending",
            "content": widget_data if is_complete else None,
            "widget_type": module.manifest.workspace_output_widget,
            "widget_data": widget_data if is_complete else None,
        }

    raise ValueError(f"Module '{module.definition.id}' is not configured for workspace output flow")


def _infer_current_stage(setup: dict[str, Any], build: dict[str, Any], output: dict[str, Any]) -> str:
    if not setup.get("confirmed"):
        return "setup"
    if output.get("status") in {"generating", "complete", "error"}:
        return "output"
    # Check if any build stage is actively in progress
    for stage in build.get("stages", []):
        if stage.get("status") in {"generating", "in_progress", "confirmed", "complete"}:
            return "build"
    if setup.get("confirmed"):
        return "build"
    return "setup"


# ---------------------------------------------------------------------------
# Top-level state builders
# ---------------------------------------------------------------------------

async def build_workflow_state(
    db: AsyncSession,
    inst: ModuleInstance,
    module: BaseModule,
) -> dict[str, Any]:
    """Build the canonical workflow state for a module instance."""
    if not uses_workspace_flow(module):
        raise ValueError(f"Module '{module.definition.id}' is not configured for workspace flow")

    existing_state = copy.deepcopy(inst.workflow_state) if inst.workflow_state else None
    setup = await _build_setup_state(db, inst, module, existing_state)
    build = await _build_build_state(db, inst, module, existing_state, setup)
    output = await _build_output_state(db, inst, module, existing_state, build)
    current_stage = _infer_current_stage(setup, build, output)

    return {
        "module_type": module.definition.id,
        "current_stage": current_stage,
        "setup": setup,
        "build": build,
        "output": output,
    }


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
# Widget state persistence (calculator modules)
# ---------------------------------------------------------------------------

async def persist_widget_stage_state(
    db: AsyncSession,
    inst: ModuleInstance,
    module: BaseModule,
    widget_data: dict[str, Any],
    stage_id: str = "main",
) -> dict[str, Any]:
    """Persist widget-stage state back onto the module instance.

    Updates the named stage in build.stages[] and syncs output state.
    """
    if not uses_recalculating_build(module):
        raise ValueError(f"Module '{module.definition.id}' does not support widget stage persistence")

    state = await ensure_workflow_state(db, inst, module)

    # Update the target stage in stages[]
    target_stage = get_build_stage(state["build"], stage_id)
    if target_stage is None:
        raise ValueError(f"Stage '{stage_id}' not found in module '{module.definition.id}'")

    target_stage["widget_data"] = copy.deepcopy(widget_data)
    target_stage["status"] = "complete" if widget_data.get("computable") else "in_progress"

    if widget_data.get("computable"):
        state["current_stage"] = "output"
        state["output"]["status"] = "complete"
        state["output"]["content"] = copy.deepcopy(widget_data)
        state["output"]["widget_data"] = copy.deepcopy(widget_data)
        inst.status = ModuleInstanceStatus.READY
        await module_service.save_deliverable(
            db,
            inst.initiative_id,
            inst.module_id,
            build_deliverable_title(module, widget_data.get("result") if isinstance(widget_data.get("result"), dict) else widget_data),
            module.definition.output_type,
            widget_data,
            user_id=inst.started_by,
            instance_id=inst.id,
        )
    else:
        state["output"]["status"] = "pending"
        state["output"]["content"] = None
        state["output"]["widget_data"] = None
        inst.status = ModuleInstanceStatus.STARTED
        inst.deliverable = None
        inst.updated_at = datetime.now(timezone.utc)
        flag_modified(inst, "deliverable")

    save_workflow_state(inst, state)
    return state


# Keep old name as alias for backward compat during API transition
persist_calculator_widget_state = persist_widget_stage_state
