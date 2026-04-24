"""Tests for the unified staged module workflow service.

Tests the new flat-stages state shape, initial state building, legacy
migration, and downstream invalidation.
"""

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.models.initiative import Initiative
from app.models.module_instance import ModuleInstance
from app.modules.lcoe_module import LCOETool
from app.modules.stakeholder_assessment import StakeholderAssessmentModule
from app.modules.carbon_module import CarbonTool
from app.modules.pvwatts_module import PVWattsTool
from app.services.module_workflow_service import (
    build_workflow_state,
    _build_initial_workflow_state,
    _is_legacy_state,
    _migrate_legacy_state,
    _get_downstream_stage_ids,
    _infer_current_stage_id,
    uses_workspace_flow,
    is_calculator_module,
    is_assessment_module,
)


class FakeDB:
    def __init__(self, records=None):
        self.records = records or {}

    async def get(self, model, key):
        return self.records.get((model, key))

    async def flush(self):
        return None


def _make_instance(module_id: str, initiative_id=None) -> ModuleInstance:
    iid = initiative_id or uuid4()
    return ModuleInstance(
        id=uuid4(),
        initiative_id=iid,
        module_id=module_id,
        status="started",
        started_by="user-1",
    )


def _make_initiative(initiative_id=None, **kwargs) -> SimpleNamespace:
    defaults = dict(
        id=initiative_id or uuid4(),
        title="Test Project",
        geography="Kenya",
        project_type="solar_pv",
        tool_inputs={},
        project_description="Test description",
        goal=None,
        target_population=None,
    )
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


# ---------------------------------------------------------------------------
# Initial state shape
# ---------------------------------------------------------------------------

def test_initial_workflow_state_for_calculator_module():
    """LCOE module starts with two stages, both pending."""
    module = LCOETool()
    state = _build_initial_workflow_state(module)

    assert state["module_type"] == "lcoe_model"
    assert state["current_stage_id"] == "inputs"
    assert set(state["stages"].keys()) == {"inputs", "results"}
    for stage_id, stage_state in state["stages"].items():
        assert stage_state["status"] == "pending"
        assert stage_state["confirmed_at"] is None
        assert stage_state["confirmed_by"] is None
        assert stage_state["data"] is None
    assert state["final_approval"]["status"] == "pending"
    assert state["final_approval"]["approved_at"] is None


def test_initial_workflow_state_for_assessment_module():
    """Stakeholder assessment starts with map-first stages, all pending."""
    module = StakeholderAssessmentModule()
    state = _build_initial_workflow_state(module)

    assert state["module_type"] == "stakeholder_assessment"
    assert state["current_stage_id"] == "categories"
    assert {"categories", "stakeholders", "map"}.issubset(set(state["stages"].keys()))
    assert all(s["status"] == "pending" for s in state["stages"].values())


# ---------------------------------------------------------------------------
# build_workflow_state — fresh instance
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_build_workflow_state_fresh_instance_lcoe():
    iid = uuid4()
    initiative = _make_initiative(initiative_id=iid)
    inst = _make_instance("lcoe_model", iid)
    db = FakeDB({(Initiative, iid): initiative})

    state = await build_workflow_state(db, inst, LCOETool())

    assert state["module_type"] == "lcoe_model"
    assert state["current_stage_id"] == "inputs"
    assert "inputs" in state["stages"]
    assert "results" in state["stages"]


@pytest.mark.asyncio
async def test_build_workflow_state_fresh_instance_assessment():
    iid = uuid4()
    initiative = _make_initiative(initiative_id=iid)
    inst = _make_instance("stakeholder_assessment", iid)
    db = FakeDB({(Initiative, iid): initiative})

    state = await build_workflow_state(db, inst, StakeholderAssessmentModule())

    assert state["module_type"] == "stakeholder_assessment"
    assert state["current_stage_id"] == "categories"
    assert {"categories", "stakeholders", "map"}.issubset(set(state["stages"].keys()))


# ---------------------------------------------------------------------------
# Legacy state migration
# ---------------------------------------------------------------------------

def test_is_legacy_state_detects_old_shape():
    old = {"setup": {}, "build": {}, "output": {}}
    assert _is_legacy_state(old) is True

    new = {"module_type": "lcoe_model", "stages": {}}
    assert _is_legacy_state(new) is False


def test_migrate_legacy_state_resets_to_pending_on_empty():
    """Old state with no meaningful data should produce all-pending new state."""
    old_state = {
        "setup": {"confirmed": True, "fields": {}},
        "build": {"stages": []},
        "output": {"status": "pending"},
    }
    module = LCOETool()
    new_state = _migrate_legacy_state(old_state, module)

    assert new_state["module_type"] == "lcoe_model"
    assert set(new_state["stages"].keys()) == {"inputs", "results"}
    for stage_state in new_state["stages"].values():
        assert stage_state["status"] == "pending"


def test_migrate_legacy_state_preserves_confirmed_stages():
    """Old stages with items and confirmed status should be migrated to confirmed."""
    old_items = [
        {"id": "item-1", "content": {"variable": "Net Capacity", "value": 500}, "provenance": {}}
    ]
    old_state = {
        "setup": {"confirmed": True, "fields": {}},
        "build": {
            "stages": [
                {
                    "id": "inputs",
                    "stage_type": "widget",
                    "status": "confirmed",
                    "confirmed_at": "2026-01-01T00:00:00+00:00",
                    "items": old_items,
                    "widget_data": None,
                }
            ]
        },
        "output": {"status": "pending"},
    }
    module = LCOETool()
    new_state = _migrate_legacy_state(old_state, module)

    inputs_state = new_state["stages"]["inputs"]
    assert inputs_state["status"] == "confirmed"
    assert inputs_state["data"]["items"] == old_items


# ---------------------------------------------------------------------------
# Current stage inference
# ---------------------------------------------------------------------------

def test_infer_current_stage_id_returns_first_unconfirmed():
    module = StakeholderAssessmentModule()
    stages = {
        "categories": {"status": "confirmed"},
        "stakeholders": {"status": "draft"},
        "map": {"status": "pending"},
    }
    result = _infer_current_stage_id(module, stages)
    assert result == "stakeholders"


def test_infer_current_stage_id_all_confirmed_returns_last():
    module = LCOETool()
    stages = {
        "inputs": {"status": "confirmed"},
        "results": {"status": "confirmed"},
    }
    result = _infer_current_stage_id(module, stages)
    assert result == "results"


# ---------------------------------------------------------------------------
# Downstream invalidation
# ---------------------------------------------------------------------------

def test_get_downstream_stage_ids_for_calculator():
    """LCOE: results depends on inputs via read_confirmed_prior_stage."""
    module = LCOETool()
    downstream = _get_downstream_stage_ids(module, "inputs")
    assert "results" in downstream


def test_get_downstream_stage_ids_for_assessment():
    """Stakeholder: stakeholders depends on categories; map depends on stakeholders."""
    module = StakeholderAssessmentModule()

    from_categories = _get_downstream_stage_ids(module, "categories")
    assert "stakeholders" in from_categories

    from_stakeholders = _get_downstream_stage_ids(module, "stakeholders")
    assert "map" in from_stakeholders


# ---------------------------------------------------------------------------
# Capability helpers
# ---------------------------------------------------------------------------

def test_uses_workspace_flow_all_modules():
    for module in [LCOETool(), CarbonTool(), PVWattsTool(), StakeholderAssessmentModule()]:
        assert uses_workspace_flow(module), f"Module '{module.definition.id}' should use workspace flow"


def test_is_calculator_module():
    assert is_calculator_module(LCOETool())
    assert is_calculator_module(CarbonTool())
    assert is_calculator_module(PVWattsTool())
    assert is_calculator_module(StakeholderAssessmentModule())


def test_is_assessment_module():
    assert is_assessment_module(StakeholderAssessmentModule())
    assert not is_assessment_module(LCOETool())
