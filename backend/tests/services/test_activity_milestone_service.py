"""Tests for assessment activity milestone helpers and agent-loop emission."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from app.domain.energy.assessments.pvwatts_assessment import PVWattsTool
from app.models.assessment_instance import AssessmentInstance
from app.services.activity_milestone_service import (
    build_milestone_copy,
    facts_from_step_result,
    is_material_population_step,
    should_emit_population_milestone,
)
from app.services.agent_runner_service import run_assessment_agent_loop


def test_material_step_allowlist() -> None:
    assert is_material_population_step("extract_from_project_materials")
    assert is_material_population_step("compute_with_external_tool")
    assert is_material_population_step("seed_from_template")
    assert not is_material_population_step("read_confirmed_prior_stage")
    assert not is_material_population_step("await_user_confirmation")


def test_should_emit_population_milestone_for_template_only_with_items() -> None:
    assert should_emit_population_milestone("seed_from_template", {"items": [{"id": "1"}]})
    assert not should_emit_population_milestone("seed_from_template", {"items": []})
    assert should_emit_population_milestone("compute_with_external_tool", {"items": []})
    assert not should_emit_population_milestone("read_confirmed_prior_stage", {"items": [{"id": "1"}]})


def test_facts_and_copy_for_external_tool() -> None:
    facts = facts_from_step_result(
        "compute_with_external_tool",
        stage_title="Results",
        config={"tool": "pvwatts"},
        before={"items": []},
        after={"widget_data": {"annual_kwh": 1000}},
    )
    assert facts["tool"] == "pvwatts"
    assert facts["has_widget_data"] is True

    label, summary = build_milestone_copy("population_step", {**facts, "stage_title": "Results"})
    assert "pvwatts" in label.lower() or "Ran" in label
    assert "Results" in summary


def test_build_milestone_copy_run_and_pause() -> None:
    start_label, start_summary = build_milestone_copy(
        "run_started",
        {"assessment_name": "Solar Production Estimate"},
    )
    assert "Solar Production Estimate" in start_label
    assert start_summary

    pause_label, pause_summary = build_milestone_copy(
        "stage_paused",
        {"stage_title": "Inputs", "summary": "Needs review for inputs."},
    )
    assert "Inputs" in pause_label
    assert "Needs review" in pause_summary


def _make_instance() -> AssessmentInstance:
    return AssessmentInstance(
        id=uuid4(),
        project_id=uuid4(),
        assessment_id="pvwatts",
        instance_number=1,
        status="started",
        started_by="user-1",
        agent_loop_state="idle",
        workflow_state={
            "stages": {
                "inputs": {"status": "pending", "data": None},
                "results": {"status": "pending", "data": None},
            },
            "current_stage_id": "inputs",
            "final_approval": {"status": "pending"},
        },
    )


@pytest.mark.asyncio
async def test_agent_loop_emits_start_once_then_resume() -> None:
    assessment = PVWattsTool()
    inst = _make_instance()
    db = AsyncMock()

    emitted: list[dict] = []

    async def _fake_emit(db_arg, *, inst, kind, **kwargs):
        emitted.append({"kind": kind, **kwargs})
        return SimpleNamespace(id=uuid4())

    draft_state = {
        "stages": {
            "inputs": {"status": "draft", "data": {"items": [{"id": "1"}]}},
            "results": {"status": "pending", "data": None},
        },
        "current_stage_id": "inputs",
        "final_approval": {"status": "pending"},
    }

    with (
        patch(
            "app.services.agent_runner_service.ensure_workflow_state",
            AsyncMock(return_value=inst.workflow_state),
        ),
        patch(
            "app.services.agent_runner_service.has_prior_agent_activity",
            AsyncMock(side_effect=[False, True]),
        ),
        patch(
            "app.services.agent_runner_service.emit_activity_milestone",
            side_effect=_fake_emit,
        ),
        patch(
            "app.services.agent_runner_service.populate_stage",
            AsyncMock(return_value=draft_state),
        ),
    ):
        await run_assessment_agent_loop(db, inst, assessment, actor_user_id="user-1")
        assert emitted[0]["kind"] == "run_started"
        assert any(e["kind"] == "stage_paused" for e in emitted)
        assert all(e["kind"] != "run_resumed" for e in emitted)

        emitted.clear()
        inst.workflow_state = {
            "stages": {
                "inputs": {"status": "confirmed", "data": {"items": [{"id": "1"}]}},
                "results": {"status": "pending", "data": None},
            },
            "current_stage_id": "results",
            "final_approval": {"status": "pending"},
        }
        results_draft = {
            "stages": {
                "inputs": {"status": "confirmed", "data": {"items": [{"id": "1"}]}},
                "results": {"status": "draft", "data": {"widget_data": {}}},
            },
            "current_stage_id": "results",
            "final_approval": {"status": "pending"},
        }
        with patch(
            "app.services.agent_runner_service.ensure_workflow_state",
            AsyncMock(return_value=inst.workflow_state),
        ), patch(
            "app.services.agent_runner_service.populate_stage",
            AsyncMock(return_value=results_draft),
        ):
            await run_assessment_agent_loop(
                db,
                inst,
                assessment,
                actor_user_id="user-1",
                resume_from_stage_id="inputs",
            )

    assert emitted[0]["kind"] == "run_resumed"
    assert emitted[0].get("stage_id") == "inputs"
    assert any(e["kind"] == "stage_paused" for e in emitted)


def test_activity_event_label_prefers_payload() -> None:
    from app.api.assessment_workflow import _activity_event_label

    assert _activity_event_label("agent_milestone", {"label": "Ran pvwatts"}) == "Ran pvwatts"
    assert _activity_event_label("agent_started", None) == "Started assessment run"
