"""Helpers for the unified module workflow lifecycle."""

from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.initiative import Initiative
from app.models.module_instance import ModuleInstance
from app.modules.assessment_base import BaseAssessmentModule, make_initial_workflow_state
from app.modules.base import BaseModule
from app.services import module_service

LCOE_TECHNOLOGY_OPTIONS = [
    "solar_pv",
    "wind",
    "battery",
    "mini_grid",
    "clean_cooking",
    "hydro",
    "other",
]

CARBON_METHOD_PACK_OPTIONS = [
    "cookstoves",
    "fuel_switch",
    "safe_water",
    "grid_renewable",
    "solar_home",
    "biodigester",
    "efficient_lighting",
]

DUE_DILIGENCE_STAGE_OPTIONS = [
    "Concept/Idea",
    "Feasibility",
    "Pilot",
    "Implementation",
    "Scale-up",
]

DUE_DILIGENCE_PROJECT_TYPE_OPTIONS = [
    "energy_access",
    "clean_cooking",
    "water_sanitation",
    "agriculture",
    "health",
    "general",
]


def uses_workspace_flow(module: BaseModule) -> bool:
    """Whether the module can open inside the unified workspace flow."""
    return (
        isinstance(module, BaseAssessmentModule)
        or module.requires_alignment
        or callable(getattr(module, "recalculate", None))
    )


def uses_layered_build(module: BaseModule) -> bool:
    """Whether the build stage uses the layered item editor."""
    return isinstance(module, BaseAssessmentModule)


def uses_alignment_build(module: BaseModule) -> bool:
    """Whether the build stage is an alignment editor."""
    return module.requires_alignment


def uses_recalculating_build(module: BaseModule) -> bool:
    """Whether the build stage is a widget-backed input editor."""
    return callable(getattr(module, "recalculate", None))


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

    module_id = module.definition.id
    if module_id == "lcoe_model":
        return [
            {
                "name": "geography",
                "label": "Geography",
                "description": "Project geography or market context.",
                "field_type": "text",
                "required": False,
                "placeholder": "e.g. Kenya",
            },
            {
                "name": "technology_type",
                "label": "Technology Type",
                "description": "Confirm the primary technology for the model.",
                "field_type": "select",
                "required": True,
                "options": LCOE_TECHNOLOGY_OPTIONS,
                "placeholder": None,
            },
            {
                "name": "project_title",
                "label": "Project Title",
                "description": "Working title for this module run.",
                "field_type": "text",
                "required": False,
                "placeholder": "Project title",
            },
        ]

    if module_id == "carbon_model":
        return [
            {
                "name": "geography",
                "label": "Geography",
                "description": "Project geography or operating market.",
                "field_type": "text",
                "required": False,
                "placeholder": "e.g. Kenya",
            },
            {
                "name": "method_pack",
                "label": "Project Type",
                "description": "Select the carbon methodology family that best matches the project.",
                "field_type": "select",
                "required": True,
                "options": CARBON_METHOD_PACK_OPTIONS,
                "placeholder": None,
            },
            {
                "name": "project_title",
                "label": "Project Title",
                "description": "Working title for this module run.",
                "field_type": "text",
                "required": False,
                "placeholder": "Project title",
            },
        ]

    if module_id == "solar_estimate":
        return [
            {
                "name": "address",
                "label": "Geography",
                "description": "Project site, city, region, or country for the solar estimate.",
                "field_type": "text",
                "required": True,
                "placeholder": "e.g. Nairobi, Kenya",
            },
            {
                "name": "project_title",
                "label": "Project Title",
                "description": "Working title for this module run.",
                "field_type": "text",
                "required": False,
                "placeholder": "Project title",
            },
        ]

    if module_id == "investment_memo":
        return [
            {
                "name": "project_title",
                "label": "Project Title",
                "description": "Name of the project or initiative.",
                "field_type": "text",
                "required": True,
                "placeholder": "Project title",
            },
            {
                "name": "geography",
                "label": "Geography",
                "description": "Primary geography for the memo.",
                "field_type": "text",
                "required": False,
                "placeholder": "e.g. Kenya",
            },
            {
                "name": "project_goal",
                "label": "Project Goal",
                "description": "Short summary of what the project is trying to achieve.",
                "field_type": "textarea",
                "required": False,
                "placeholder": "Summarize the project goal",
            },
            {
                "name": "target_beneficiaries",
                "label": "Target Beneficiaries",
                "description": "Who the project is intended to serve.",
                "field_type": "text",
                "required": False,
                "placeholder": "Target communities or user segment",
            },
        ]

    if module_id == "due_diligence_checklist":
        return [
            {
                "name": "project_title",
                "label": "Project Title",
                "description": "Name of the project or initiative.",
                "field_type": "text",
                "required": True,
                "placeholder": "Project title",
            },
            {
                "name": "geography",
                "label": "Geography",
                "description": "Primary geography for due diligence.",
                "field_type": "text",
                "required": False,
                "placeholder": "e.g. Kenya",
            },
            {
                "name": "project_type",
                "label": "Project Type",
                "description": "High-level sector classification for the checklist.",
                "field_type": "select",
                "required": False,
                "options": DUE_DILIGENCE_PROJECT_TYPE_OPTIONS,
                "placeholder": None,
            },
            {
                "name": "project_stage",
                "label": "Project Stage",
                "description": "Current maturity of the project.",
                "field_type": "select",
                "required": False,
                "options": DUE_DILIGENCE_STAGE_OPTIONS,
                "placeholder": None,
            },
        ]

    return []


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


async def _build_calculator_widget_data(
    db: AsyncSession,
    inst: ModuleInstance,
    module: BaseModule,
    setup_fields: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if inst.deliverable and isinstance(inst.deliverable.get("content"), dict):
        return copy.deepcopy(inst.deliverable["content"])

    existing = (inst.workflow_state or {}).get("build", {}).get("widget_data")
    if isinstance(existing, dict):
        return copy.deepcopy(existing)

    initiative = await db.get(Initiative, inst.initiative_id)
    known_values = _merge_setup_fields(
        _build_known_values_from_initiative(initiative),
        setup_fields,
    )

    if inst.module_id == "lcoe_model":
        from app.services.lcoe_engine import LCOEEngine

        tech_type = known_values.get("technology_type")
        inputs = LCOEEngine.build_default_inputs(tech_type=tech_type, known_values=known_values)
        serialized_inputs = {k: v.to_dict() for k, v in inputs.items()}
        return await module.recalculate(serialized_inputs)

    if inst.module_id == "carbon_model":
        from app.services.carbon_engine import CarbonEngine

        method_pack = known_values.get("method_pack")
        inputs = CarbonEngine.build_default_inputs(method_pack=method_pack, known_values=known_values)
        serialized_inputs = {k: v.to_dict() for k, v in inputs.items()}
        return await module.recalculate(serialized_inputs)

    if inst.module_id == "solar_estimate":
        from app.services.pvwatts_engine import PVWattsEngine

        inputs = PVWattsEngine.build_default_inputs(known_values=known_values)
        serialized_inputs = {k: v.to_dict() for k, v in inputs.items()}
        return await module.recalculate(serialized_inputs)

    raise ValueError(f"Unsupported calculator workflow module '{inst.module_id}'")


async def _ensure_alignment_data(
    db: AsyncSession,
    inst: ModuleInstance,
    module: BaseModule,
    setup_fields: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if inst.alignment:
        return copy.deepcopy(inst.alignment)

    initiative = await db.get(Initiative, inst.initiative_id)
    if initiative is None:
        return {}

    alignment_obj = await module.generate_alignment(
        db=db,
        initiative_id=initiative.id,
        inputs=_merge_setup_fields(dict(initiative.tool_inputs or {}), setup_fields),
    )
    alignment_data = alignment_obj.to_dict()
    await module_service.save_alignment(
        db,
        initiative.id,
        inst.module_id,
        alignment_data,
        user_id=inst.started_by,
        instance_id=inst.id,
    )
    return copy.deepcopy(alignment_data)


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

    if uses_layered_build(module):
        setup["mode"] = "form"
        if not setup.get("fields"):
            context = await get_initiative_context(db, inst.initiative_id)
            try:
                defaults = await module.generate_setup_defaults(db, inst.initiative_id, context)
                setup["fields"] = defaults
            except Exception:
                setup["fields"] = {}
    else:
        setup["mode"] = "form"
        if not setup.get("fields"):
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
    if uses_layered_build(module):
        if existing_state and isinstance(existing_state.get("build"), dict):
            build = copy.deepcopy(existing_state["build"])
        else:
            build = make_initial_workflow_state(
                module.definition.id,
                module.assessment_definition,
            )["build"]
        build.setdefault("status", "pending")
        build["widget_type"] = None
        build["widget_data"] = None
        return build

    if not setup_state.get("confirmed"):
        return {
            "status": "pending",
            "current_layer": None,
            "layers": {},
            "widget_type": module.manifest.workspace_build_widget,
            "widget_data": None,
        }

    if uses_alignment_build(module):
        alignment_data = await _ensure_alignment_data(db, inst, module, setup_state.get("fields"))
        from app.api.alignment_helpers import build_alignment_widget_data

        return {
            "status": "confirmed" if alignment_data.get("confirmed") else "in_progress",
            "current_layer": None,
            "layers": {},
            "widget_type": module.manifest.workspace_build_widget,
            "widget_data": build_alignment_widget_data(
                tool_id=inst.module_id,
                alignment_data=alignment_data,
                pending_tool_ids=[],
            ),
        }

    if uses_recalculating_build(module):
        widget_data = await _build_calculator_widget_data(db, inst, module, setup_state.get("fields"))
        return {
            "status": "complete" if widget_data.get("computable") else "in_progress",
            "current_layer": None,
            "layers": {},
            "widget_type": module.manifest.workspace_build_widget,
            "widget_data": widget_data,
        }

    raise ValueError(f"Module '{module.definition.id}' is not configured for workspace build flow")


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

    if uses_alignment_build(module):
        output_widget_data = None
        output_status = "pending"
        output_content = None
        if inst.deliverable and isinstance(inst.deliverable.get("content"), dict):
            output_content = copy.deepcopy(inst.deliverable["content"])
            output_widget_data = {"content": output_content}
            output_status = "complete"
        return {
            "status": output_status,
            "content": output_content,
            "widget_type": module.manifest.workspace_output_widget,
            "widget_data": output_widget_data,
        }

    if uses_recalculating_build(module):
        widget_data = copy.deepcopy(build_state.get("widget_data"))
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
    if build.get("status") in {"generating", "in_progress", "confirmed", "complete"}:
        return "build"
    if setup.get("confirmed"):
        return "build"
    return "setup"


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


async def persist_calculator_widget_state(
    db: AsyncSession,
    inst: ModuleInstance,
    module: BaseModule,
    widget_data: dict[str, Any],
) -> dict[str, Any]:
    """Persist calculator widget state back onto the module instance."""
    if not uses_recalculating_build(module):
        raise ValueError(f"Module '{module.definition.id}' does not support recalculating widget persistence")

    state = await ensure_workflow_state(db, inst, module)
    state["build"]["widget_data"] = copy.deepcopy(widget_data)
    state["build"]["status"] = "complete" if widget_data.get("computable") else "in_progress"

    if widget_data.get("computable"):
        state["current_stage"] = "output"
        state["output"]["status"] = "complete"
        state["output"]["content"] = copy.deepcopy(widget_data)
        state["output"]["widget_data"] = copy.deepcopy(widget_data)
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
        inst.status = "started"
        inst.deliverable = None
        inst.updated_at = datetime.now(timezone.utc)
        flag_modified(inst, "deliverable")

    save_workflow_state(inst, state)
    return state

