from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.models.initiative import Initiative
from app.models.module_instance import ModuleInstance, ModuleInstanceStatus
from app.modules.carbon_module import CarbonTool
from app.modules.lcoe_module import LCOETool
from app.modules.pvwatts_module import PVWattsTool
from app.modules.stakeholder_assessment import StakeholderAssessmentModule
from app.services.module_workflow_service import (
    build_workflow_state,
    get_workspace_setup_fields,
    persist_widget_stage_state,
)


class FakeDB:
    def __init__(self, records):
        self.records = records

    async def get(self, model, key):
        return self.records.get((model, key))

    async def flush(self):
        return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_main_stage(state: dict) -> dict | None:
    """Return the 'main' entry from build.stages[], or None."""
    return next(
        (s for s in state["build"].get("stages", []) if s.get("id") == "main"),
        None,
    )


# ---------------------------------------------------------------------------
# build_workflow_state — widget module shape
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_build_workflow_state_for_calculator_module_pre_confirm() -> None:
    """Before setup is confirmed, build.stages[0] has no widget_data."""
    initiative_id = uuid4()
    instance_id = uuid4()
    initiative = SimpleNamespace(
        id=initiative_id,
        title="Kenya Solar Pilot",
        geography="Kenya",
        project_type="solar_pv",
        tool_inputs={
            "net_capacity_kw": 250,
            "total_capex": 600000,
            "annual_opex": 25000,
            "technology_type": "solar_pv",
        },
    )
    inst = ModuleInstance(
        id=instance_id,
        initiative_id=initiative_id,
        module_id="lcoe_model",
        status="started",
        started_by="user-1",
    )
    db = FakeDB({
        (Initiative, initiative_id): initiative,
        (ModuleInstance, instance_id): inst,
    })

    state = await build_workflow_state(db, inst, LCOETool())

    assert state["setup"]["mode"] == "form"
    assert state["setup"]["confirmed"] is False
    assert state["setup"]["fields"]["technology_type"] == "solar_pv"
    assert state["current_stage"] == "setup"
    assert state["output"]["status"] == "pending"

    # build.stages[] should contain one widget stage with no data yet
    assert "stages" in state["build"]
    main = _get_main_stage(state)
    assert main is not None
    assert main["stage_type"] == "widget"
    assert main["widget_type"] == "lcoe_inputs"
    assert main["widget_data"] is None


@pytest.mark.asyncio
async def test_build_workflow_state_for_calculator_module_post_confirm() -> None:
    """After setup is confirmed, the main stage contains populated widget_data."""
    initiative_id = uuid4()
    instance_id = uuid4()
    initiative = SimpleNamespace(
        id=initiative_id,
        title="Kenya Solar Pilot",
        geography="Kenya",
        project_type="solar_pv",
        tool_inputs={
            "net_capacity_kw": 250,
            "total_capex": 600000,
            "annual_opex": 25000,
            "technology_type": "solar_pv",
        },
    )
    inst = ModuleInstance(
        id=instance_id,
        initiative_id=initiative_id,
        module_id="lcoe_model",
        status="started",
        started_by="user-1",
    )
    db = FakeDB({
        (Initiative, initiative_id): initiative,
        (ModuleInstance, instance_id): inst,
    })

    # Prime the instance with a confirmed setup
    pre_state = await build_workflow_state(db, inst, LCOETool())
    inst.workflow_state = {
        "setup": {
            "mode": "form",
            "fields": pre_state["setup"]["fields"],
            "confirmed": True,
            "confirmed_at": "2026-01-01T00:00:00+00:00",
        }
    }

    state = await build_workflow_state(db, inst, LCOETool())

    main = _get_main_stage(state)
    assert main is not None
    assert main["widget_data"] is not None
    assert main["widget_data"]["inputs"]["net_capacity_kw"]["value"] == 250
    assert state["output"]["status"] == "complete"
    assert state["current_stage"] == "output"


# ---------------------------------------------------------------------------
# persist_widget_stage_state
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_persist_widget_stage_state_creates_deliverable() -> None:
    initiative_id = uuid4()
    instance_id = uuid4()
    initiative = SimpleNamespace(
        id=initiative_id,
        title="Solar Farm",
        geography="Kenya",
        project_type="solar_pv",
        tool_inputs={
            "net_capacity_kw": 100,
            "total_capex": 500000,
            "annual_opex": 20000,
            "technology_type": "solar_pv",
        },
    )
    inst = ModuleInstance(
        id=instance_id,
        initiative_id=initiative_id,
        module_id="lcoe_model",
        status="started",
        started_by="user-1",
    )
    db = FakeDB({
        (Initiative, initiative_id): initiative,
        (ModuleInstance, instance_id): inst,
    })
    module = LCOETool()

    inst.workflow_state = {
        "setup": {
            "mode": "form",
            "fields": {
                "technology_type": "solar_pv",
                "project_title": "Solar Farm",
            },
            "confirmed": True,
            "confirmed_at": "2026-01-01T00:00:00+00:00",
        }
    }
    initial_state = await build_workflow_state(db, inst, module)
    widget_data = _get_main_stage(initial_state)["widget_data"]

    state = await persist_widget_stage_state(db, inst, module, widget_data)

    assert inst.deliverable is not None
    assert inst.deliverable["output_type"] == "lcoe"
    assert inst.status == ModuleInstanceStatus.READY
    assert state["output"]["status"] == "complete"


# ---------------------------------------------------------------------------
# build_stages[] shape invariants
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_build_stages_shape_for_assessment_module() -> None:
    """Assessment module stages[] should have stage_type != 'widget' and no widget_data."""
    instance_id = uuid4()
    initiative_id = uuid4()
    initiative = SimpleNamespace(
        id=initiative_id,
        title="Project",
        geography="Kenya",
        project_type=None,
        tool_inputs={},
        project_description=None,
        goal=None,
        target_population=None,
    )
    inst = ModuleInstance(
        id=instance_id,
        initiative_id=initiative_id,
        module_id="stakeholder_assessment",
        status="started",
        started_by="user-1",
    )
    db = FakeDB({
        (Initiative, initiative_id): initiative,
        (ModuleInstance, instance_id): inst,
    })

    state = await build_workflow_state(db, inst, StakeholderAssessmentModule())

    stages = state["build"].get("stages", [])
    assert len(stages) > 0, "Assessment module must produce at least one build stage"
    for stage in stages:
        assert stage["stage_type"] != "widget", (
            f"Assessment stage '{stage['id']}' must not be stage_type='widget'"
        )
        assert stage.get("widget_data") is None, (
            f"Assessment stage '{stage['id']}' must not have widget_data"
        )
        assert "items" in stage, f"Assessment stage '{stage['id']}' must have an items list"


# ---------------------------------------------------------------------------
# Setup field coverage
# ---------------------------------------------------------------------------

def test_workspace_setup_fields_cover_workspace_modules() -> None:
    lcoe_fields = get_workspace_setup_fields(LCOETool())
    carbon_fields = get_workspace_setup_fields(CarbonTool())
    solar_fields = get_workspace_setup_fields(PVWattsTool())
    assessment_fields = get_workspace_setup_fields(StakeholderAssessmentModule())

    assert any(field["name"] == "technology_type" for field in lcoe_fields)
    assert any(field["name"] == "method_pack" for field in carbon_fields)
    assert any(field["name"] == "address" for field in solar_fields)
    assert any(field["name"] == "geography" for field in assessment_fields)
    assert len(assessment_fields) == 2
