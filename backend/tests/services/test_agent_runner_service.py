from uuid import uuid4

from app.domain.energy.assessments.lcoe_assessment import LCOETool
from app.models.assessment_instance import AssessmentInstance
from app.services.agent_runner_service import _find_next_pending_stage, derive_assessment_run_state


def _make_instance() -> AssessmentInstance:
    return AssessmentInstance(
        id=uuid4(),
        initiative_id=uuid4(),
        assessment_id="lcoe_model",
        instance_number=1,
        status="started",
        started_by="user-1",
        agent_loop_state="idle",
    )


def test_find_next_pending_stage_respects_read_confirmed_dependencies() -> None:
    assessment = LCOETool()
    state = {
        "stages": {
            "inputs": {"status": "draft"},
            "results": {"status": "pending"},
        },
        "final_approval": {"status": "pending"},
    }

    stage = _find_next_pending_stage(assessment, state)
    assert stage is None


def test_derive_run_state_reports_needs_review_for_draft_stage() -> None:
    assessment = LCOETool()
    inst = _make_instance()
    state = {
        "stages": {
            "inputs": {"status": "draft"},
            "results": {"status": "pending"},
        },
        "final_approval": {"status": "pending"},
    }

    run_state = derive_assessment_run_state(inst, assessment, state)
    assert run_state == "needs_review"
