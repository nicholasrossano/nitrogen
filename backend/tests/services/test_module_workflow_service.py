from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.models.initiative import Initiative
from app.models.module_instance import ModuleInstance
from app.modules.base import AlignmentSection, ModuleAlignment
from app.modules.investment_memo import InvestmentMemoTool
from app.modules.lcoe_module import LCOETool
from app.modules.stakeholder_assessment import StakeholderAssessmentModule
from app.services.module_workflow_service import (
    build_workflow_state,
    get_workspace_setup_fields,
    persist_calculator_widget_state,
)


class FakeDB:
    def __init__(self, records):
        self.records = records

    async def get(self, model, key):
        return self.records.get((model, key))

    async def flush(self):
        return None


@pytest.mark.asyncio
async def test_build_workflow_state_for_calculator_module() -> None:
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
    assert state["build"]["widget_type"] == "lcoe_inputs"
    assert state["build"]["widget_data"] is None
    assert state["output"]["status"] == "pending"
    assert state["current_stage"] == "setup"

    inst.workflow_state = {
        "setup": {
            "mode": "form",
            "fields": state["setup"]["fields"],
            "confirmed": True,
            "confirmed_at": "2026-01-01T00:00:00+00:00",
        }
    }

    confirmed_state = await build_workflow_state(db, inst, LCOETool())

    assert confirmed_state["build"]["widget_data"]["inputs"]["net_capacity_kw"]["value"] == 250
    assert confirmed_state["output"]["status"] == "complete"
    assert confirmed_state["current_stage"] == "output"


@pytest.mark.asyncio
async def test_build_workflow_state_for_alignment_module(monkeypatch: pytest.MonkeyPatch) -> None:
    initiative_id = uuid4()
    instance_id = uuid4()
    initiative = SimpleNamespace(
        id=initiative_id,
        tool_inputs={},
    )
    inst = ModuleInstance(
        id=instance_id,
        initiative_id=initiative_id,
        module_id="investment_memo",
        status="started",
        started_by="user-1",
    )
    module = InvestmentMemoTool()

    async def fake_generate_alignment(*args, **kwargs):
        return ModuleAlignment(
            module_id="investment_memo",
            title="Investment Memo Outline",
            description="Review the proposed memo structure.",
            sections=[
                AlignmentSection(
                    id="summary",
                    title="Executive Summary",
                    description="Topline recommendation",
                    key_points=["Project overview"],
                )
            ],
        )

    monkeypatch.setattr(module, "generate_alignment", fake_generate_alignment)

    db = FakeDB({
        (Initiative, initiative_id): initiative,
        (ModuleInstance, instance_id): inst,
    })

    state = await build_workflow_state(db, inst, module)

    assert state["setup"]["mode"] == "form"
    assert state["setup"]["confirmed"] is False
    assert state["build"]["widget_type"] == "alignment"
    assert state["build"]["widget_data"] is None
    assert state["output"]["status"] == "pending"
    assert state["current_stage"] == "setup"

    inst.workflow_state = {
        "setup": {
            "mode": "form",
            "fields": {"project_title": "Memo Draft"},
            "confirmed": True,
            "confirmed_at": "2026-01-01T00:00:00+00:00",
        }
    }

    confirmed_state = await build_workflow_state(db, inst, module)

    assert confirmed_state["build"]["widget_data"]["alignment"]["module_id"] == "investment_memo"
    assert confirmed_state["output"]["status"] == "pending"
    assert confirmed_state["current_stage"] == "build"


@pytest.mark.asyncio
async def test_persist_calculator_widget_state_creates_deliverable() -> None:
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
    widget_data = initial_state["build"]["widget_data"]

    state = await persist_calculator_widget_state(db, inst, module, widget_data)

    assert inst.deliverable is not None
    assert inst.deliverable["output_type"] == "lcoe"
    assert inst.status == "complete"
    assert state["output"]["status"] == "complete"


def test_workspace_setup_fields_cover_workspace_modules() -> None:
    lcoe_fields = get_workspace_setup_fields(LCOETool())
    memo_fields = get_workspace_setup_fields(InvestmentMemoTool())
    assessment_fields = get_workspace_setup_fields(StakeholderAssessmentModule())

    assert any(field["name"] == "technology_type" for field in lcoe_fields)
    assert any(field["name"] == "project_title" for field in memo_fields)
    assert any(field["name"] == "geography" for field in assessment_fields)
