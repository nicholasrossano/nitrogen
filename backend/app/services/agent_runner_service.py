from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.assessments.base import BaseAssessment, StageDef
from app.models.assessment_instance import AssessmentAgentLoopState, AssessmentInstance
from app.services.assessment_workflow_service import ensure_workflow_state, populate_stage
from app.services.decision_event_service import append_decision_event


USER_VISIBLE_RUN_STATES = ("running", "needs_review", "blocked", "approved")


def _has_executable_population_step(stage_def: StageDef) -> bool:
    return any(step.type != "await_user_confirmation" for step in stage_def.population)


def _requires_review_pause(stage_def: StageDef) -> bool:
    return any(step.type == "await_user_confirmation" for step in stage_def.population)


def _population_dependencies_met(stage_def: StageDef, state: dict[str, Any]) -> bool:
    stages = state.get("stages") or {}
    for step in stage_def.population:
        if step.type != "read_confirmed_prior_stage":
            continue
        prior_stage_id = step.config.get("stage_id")
        if not prior_stage_id:
            continue
        prior_state = stages.get(prior_stage_id) or {}
        if prior_state.get("status") != "confirmed":
            return False
    return True


def _find_next_pending_stage(assessment: BaseAssessment, state: dict[str, Any]) -> StageDef | None:
    stages = state.get("stages") or {}
    for stage_def in assessment.stage_defs:
        stage_state = stages.get(stage_def.id) or {}
        if stage_state.get("status") != "pending":
            continue
        if not _has_executable_population_step(stage_def):
            continue
        if not _population_dependencies_met(stage_def, state):
            continue
        return stage_def
    return None


def _all_stages_confirmed(assessment: BaseAssessment, state: dict[str, Any]) -> bool:
    stages = state.get("stages") or {}
    return bool(assessment.stage_defs) and all(
        (stages.get(stage_def.id) or {}).get("status") == "confirmed"
        for stage_def in assessment.stage_defs
    )


def derive_assessment_run_state(
    inst: AssessmentInstance,
    assessment: BaseAssessment,
    state: dict[str, Any],
) -> str:
    final_approval = state.get("final_approval") or {}
    if final_approval.get("status") == "approved":
        return "approved"

    stages = state.get("stages") or {}
    if any((stages.get(stage_def.id) or {}).get("status") == "error" for stage_def in assessment.stage_defs):
        return "blocked"

    if inst.agent_loop_state == AssessmentAgentLoopState.RUNNING.value:
        return "running"

    if any((stages.get(stage_def.id) or {}).get("status") == "draft" for stage_def in assessment.stage_defs):
        return "needs_review"

    if _all_stages_confirmed(assessment, state):
        return "needs_review"

    if _find_next_pending_stage(assessment, state) is not None:
        return "running"

    return "needs_review"


async def run_assessment_agent_loop(
    db: AsyncSession,
    inst: AssessmentInstance,
    assessment: BaseAssessment,
    *,
    actor_user_id: str | None = None,
    actor_email: str | None = None,
) -> dict[str, Any]:
    state = await ensure_workflow_state(db, inst, assessment)
    inst.agent_loop_state = AssessmentAgentLoopState.RUNNING.value
    inst.agent_current_action = "Starting assessment run"
    inst.agent_last_summary = None
    await append_decision_event(
        db,
        inst=inst,
        event_type="agent_started",
        entity_type="assessment",
        entity_id=str(inst.id),
        actor_user_id=actor_user_id,
        actor_email=actor_email,
        payload={"summary": inst.agent_current_action},
    )
    await db.commit()

    max_iterations = max(len(assessment.stage_defs) * 2, 1)
    iterations = 0
    while iterations < max_iterations:
        iterations += 1
        stage_def = _find_next_pending_stage(assessment, state)
        if stage_def is None:
            break

        inst.agent_current_action = f"Populating {stage_def.title.lower()}"
        await db.flush()
        try:
            state = await populate_stage(db, inst, assessment, stage_def.id)
        except Exception:
            inst.agent_loop_state = AssessmentAgentLoopState.PAUSED.value
            inst.agent_last_summary = f"Blocked while generating {stage_def.title.lower()}."
            inst.agent_current_action = None
            await append_decision_event(
                db,
                inst=inst,
                event_type="agent_blocked",
                entity_type="stage",
                entity_id=stage_def.id,
                stage_id=stage_def.id,
                actor_user_id=actor_user_id,
                actor_email=actor_email,
                payload={"summary": inst.agent_last_summary},
            )
            await db.commit()
            return state
        stage_status = ((state.get("stages") or {}).get(stage_def.id) or {}).get("status")
        await append_decision_event(
            db,
            inst=inst,
            event_type="agent_action",
            entity_type="stage",
            entity_id=stage_def.id,
            stage_id=stage_def.id,
            actor_user_id=actor_user_id,
            actor_email=actor_email,
            payload={"summary": inst.agent_current_action, "status": stage_status},
        )
        await db.commit()

        if stage_status == "error":
            inst.agent_loop_state = AssessmentAgentLoopState.PAUSED.value
            inst.agent_last_summary = f"Blocked while generating {stage_def.title.lower()}."
            inst.agent_current_action = None
            await append_decision_event(
                db,
                inst=inst,
                event_type="agent_blocked",
                entity_type="stage",
                entity_id=stage_def.id,
                stage_id=stage_def.id,
                actor_user_id=actor_user_id,
                actor_email=actor_email,
                payload={"summary": inst.agent_last_summary},
            )
            await db.commit()
            return state

        if stage_status == "draft":
            inst.agent_loop_state = AssessmentAgentLoopState.PAUSED.value
            if _requires_review_pause(stage_def):
                inst.agent_last_summary = f"Needs review for {stage_def.title.lower()}."
            else:
                inst.agent_last_summary = f"Drafted {stage_def.title.lower()} for review."
            inst.agent_current_action = None
            await append_decision_event(
                db,
                inst=inst,
                event_type="agent_paused",
                entity_type="stage",
                entity_id=stage_def.id,
                stage_id=stage_def.id,
                actor_user_id=actor_user_id,
                actor_email=actor_email,
                payload={"summary": inst.agent_last_summary},
            )
            await db.commit()
            return state

    inst.agent_loop_state = AssessmentAgentLoopState.PAUSED.value
    inst.agent_current_action = None
    if _all_stages_confirmed(assessment, state):
        inst.agent_last_summary = "Ready for final approval."
    else:
        inst.agent_last_summary = "Assessment run is paused."
    await db.commit()
    return state
