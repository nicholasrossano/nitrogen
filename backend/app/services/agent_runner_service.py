from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.assessments.base import BaseAssessment, StageDef
from app.models.assessment_instance import AssessmentAgentLoopState, AssessmentInstance
from app.services.activity_milestone_service import (
    emit_activity_milestone,
    has_prior_agent_activity,
)
from app.services.assessment_workflow_service import ensure_workflow_state, populate_stage


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
    resume_from_stage_id: str | None = None,
) -> dict[str, Any]:
    state = await ensure_workflow_state(db, inst, assessment)
    assessment_name = assessment.definition.name
    stage_title_by_id = {stage.id: stage.title for stage in assessment.stage_defs}

    inst.agent_loop_state = AssessmentAgentLoopState.RUNNING.value
    prior_activity = await has_prior_agent_activity(db, inst)
    if not prior_activity:
        await emit_activity_milestone(
            db,
            inst=inst,
            kind="run_started",
            facts={"assessment_name": assessment_name},
            actor_user_id=actor_user_id,
            actor_email=actor_email,
        )
    else:
        confirmed_title = (
            stage_title_by_id.get(resume_from_stage_id)
            if resume_from_stage_id
            else None
        )
        await emit_activity_milestone(
            db,
            inst=inst,
            kind="run_resumed",
            stage_id=resume_from_stage_id,
            facts={
                "assessment_name": assessment_name,
                "confirmed_stage_title": confirmed_title or "prior stage",
                "stage_title": confirmed_title or "prior stage",
            },
            actor_user_id=actor_user_id,
            actor_email=actor_email,
        )
    await db.commit()

    max_iterations = max(len(assessment.stage_defs) * 2, 1)
    iterations = 0
    while iterations < max_iterations:
        iterations += 1
        stage_def = _find_next_pending_stage(assessment, state)
        if stage_def is None:
            break

        inst.agent_current_action = f"Working on {stage_def.title}"
        await db.flush()
        try:
            state = await populate_stage(
                db,
                inst,
                assessment,
                stage_def.id,
                actor_user_id=actor_user_id,
                actor_email=actor_email,
            )
        except Exception as exc:
            inst.agent_loop_state = AssessmentAgentLoopState.PAUSED.value
            await emit_activity_milestone(
                db,
                inst=inst,
                kind="stage_blocked",
                event_type="agent_blocked",
                stage_id=stage_def.id,
                facts={
                    "stage_title": stage_def.title,
                    "assessment_name": assessment_name,
                    "error": str(exc)[:300],
                    "summary": f"Blocked while generating {stage_def.title.lower()}.",
                },
                actor_user_id=actor_user_id,
                actor_email=actor_email,
            )
            await db.commit()
            return state

        stage_status = ((state.get("stages") or {}).get(stage_def.id) or {}).get("status")
        await db.commit()

        if stage_status == "error":
            inst.agent_loop_state = AssessmentAgentLoopState.PAUSED.value
            await emit_activity_milestone(
                db,
                inst=inst,
                kind="stage_blocked",
                event_type="agent_blocked",
                stage_id=stage_def.id,
                facts={
                    "stage_title": stage_def.title,
                    "assessment_name": assessment_name,
                    "summary": f"Blocked while generating {stage_def.title.lower()}.",
                },
                actor_user_id=actor_user_id,
                actor_email=actor_email,
            )
            await db.commit()
            return state

        if stage_status == "draft":
            inst.agent_loop_state = AssessmentAgentLoopState.PAUSED.value
            if _requires_review_pause(stage_def):
                pause_summary = f"Needs review for {stage_def.title.lower()}."
            else:
                pause_summary = f"Drafted {stage_def.title.lower()} for review."
            await emit_activity_milestone(
                db,
                inst=inst,
                kind="stage_paused",
                event_type="agent_paused",
                stage_id=stage_def.id,
                facts={
                    "stage_title": stage_def.title,
                    "assessment_name": assessment_name,
                    "summary": pause_summary,
                },
                actor_user_id=actor_user_id,
                actor_email=actor_email,
            )
            await db.commit()
            return state

    inst.agent_loop_state = AssessmentAgentLoopState.PAUSED.value
    if _all_stages_confirmed(assessment, state):
        await emit_activity_milestone(
            db,
            inst=inst,
            kind="awaiting_final_approval",
            facts={"assessment_name": assessment_name},
            actor_user_id=actor_user_id,
            actor_email=actor_email,
        )
    else:
        await emit_activity_milestone(
            db,
            inst=inst,
            kind="run_paused",
            facts={
                "assessment_name": assessment_name,
                "summary": "Assessment run is paused.",
            },
            actor_user_id=actor_user_id,
            actor_email=actor_email,
        )
    inst.agent_current_action = None
    await db.commit()
    return state
