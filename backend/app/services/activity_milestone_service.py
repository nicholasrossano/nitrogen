"""Shared assessment activity milestones for the agent activity log.

Emits coarse, informative decision_events at major run/population boundaries.
Structured facts are always recorded; a short LLM polish is best-effort.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.llm_invoke import acompletion
from app.core.model_catalog import Complexity, ModelRole
from app.models.assessment_instance import AssessmentInstance
from app.models.decision_event import DecisionEvent
from app.services.decision_event_service import append_decision_event

logger = logging.getLogger(__name__)

ACTIVITY_EVENT_TYPES = frozenset({
    "agent_started",
    "agent_action",
    "agent_milestone",
    "agent_paused",
    "agent_blocked",
})

# Always emit after these steps finish.
_MATERIAL_ALWAYS = frozenset({
    "extract_from_project_materials",
    "propose_with_ai",
    "adapt_with_ai_from_project_materials",
    "infer_missing_with_ai",
    "enrich_selected_item_with_ai",
    "compute_with_assessment_logic",
    "compute_with_external_tool",
})

# Emit only when the step actually produced primary rows/items.
_MATERIAL_IF_ITEMS = frozenset({
    "seed_from_template",
    "start_from_predefined_rows",
})

_STEP_LABELS = {
    "extract_from_project_materials": "Reviewed project materials",
    "propose_with_ai": "Proposed draft items",
    "adapt_with_ai_from_project_materials": "Adapted items from project materials",
    "infer_missing_with_ai": "Inferred missing values",
    "enrich_selected_item_with_ai": "Enriched item details",
    "compute_with_assessment_logic": "Ran assessment computation",
    "compute_with_external_tool": "Ran external tool",
    "seed_from_template": "Seeded from template",
    "start_from_predefined_rows": "Loaded predefined rows",
}

_POLISH_SYSTEM = (
    "You write brief first-person agent activity log entries for an energy "
    "assessment product. Return plain text only: one short label line "
    "(max ~8 words), then a blank line, then 1-2 sentences of summary. "
    "Be concrete and informative. Do not use markdown, bullets, or quotes."
)


def is_material_population_step(step_type: str) -> bool:
    return step_type in _MATERIAL_ALWAYS or step_type in _MATERIAL_IF_ITEMS


def should_emit_population_milestone(step_type: str, result_data: dict[str, Any]) -> bool:
    if step_type in _MATERIAL_ALWAYS:
        return True
    if step_type in _MATERIAL_IF_ITEMS:
        items = result_data.get("items") or []
        return bool(items)
    return False


def facts_from_step_result(
    step_type: str,
    *,
    stage_title: str,
    config: dict[str, Any] | None,
    before: dict[str, Any],
    after: dict[str, Any],
) -> dict[str, Any]:
    config = config or {}
    before_items = before.get("items") or []
    after_items = after.get("items") or []
    facts: dict[str, Any] = {
        "step_type": step_type,
        "stage_title": stage_title,
        "item_count": len(after_items),
        "items_added": max(0, len(after_items) - len(before_items)),
    }
    tool = config.get("tool")
    if tool:
        facts["tool"] = tool
    if after.get("widget_data") is not None:
        facts["has_widget_data"] = True
    records = after.get("records")
    if isinstance(records, dict):
        facts["record_count"] = len(records)
    return facts


def build_milestone_copy(kind: str, facts: dict[str, Any]) -> tuple[str, str]:
    """Deterministic label + summary from structured facts."""
    stage_title = str(facts.get("stage_title") or "stage")
    assessment_name = str(facts.get("assessment_name") or "assessment")
    step_type = str(facts.get("step_type") or "")
    item_count = facts.get("item_count")
    items_added = facts.get("items_added")
    tool = facts.get("tool")
    error = facts.get("error")

    if kind == "run_started":
        label = f"Starting {assessment_name}"
        summary = f"Beginning the {assessment_name} run and working through its stages."
        return label, summary

    if kind == "run_resumed":
        confirmed = str(facts.get("confirmed_stage_title") or stage_title)
        label = f"Continuing after {confirmed}"
        summary = f"{confirmed} is confirmed. Moving on to the next pending stage."
        return label, summary

    if kind == "population_step":
        label = _STEP_LABELS.get(step_type, "Completed population step")
        if step_type == "compute_with_external_tool" and tool:
            label = f"Ran {tool}"
            summary = f"Computed results for {stage_title} with {tool}."
        elif step_type == "compute_with_assessment_logic":
            summary = f"Finished assessment computation for {stage_title}."
        elif step_type == "extract_from_project_materials":
            summary = f"Pulled relevant context from project materials for {stage_title}."
        elif items_added:
            summary = f"Added {items_added} item(s) while preparing {stage_title}."
        elif item_count is not None:
            summary = f"Prepared {item_count} item(s) for {stage_title}."
        else:
            summary = f"Finished {step_type.replace('_', ' ')} for {stage_title}."
        return label, summary

    if kind == "stage_paused":
        label = f"Paused for review: {stage_title}"
        summary = str(
            facts.get("summary")
            or f"Drafted {stage_title.lower()} and needs your review before continuing."
        )
        return label, summary

    if kind == "stage_blocked":
        label = f"Blocked on {stage_title}"
        summary = str(
            error
            or facts.get("summary")
            or f"Could not finish generating {stage_title.lower()}."
        )
        return label, summary

    if kind == "awaiting_final_approval":
        label = "Ready for final approval"
        summary = "All stages are confirmed. Review the results and approve when ready."
        return label, summary

    if kind == "run_paused":
        label = "Assessment run paused"
        summary = str(facts.get("summary") or "The assessment run is paused.")
        return label, summary

    label = kind.replace("_", " ").title()
    summary = str(facts.get("summary") or label)
    return label, summary


async def polish_milestone_copy(
    db: AsyncSession,
    *,
    user_id: str | None,
    kind: str,
    facts: dict[str, Any],
    label: str,
    summary: str,
) -> tuple[str, str]:
    """Best-effort LLM polish; returns deterministic copy on failure."""
    try:
        response = await acompletion(
            user_id,
            db,
            role=ModelRole.ORCHESTRATION,
            complexity=Complexity.LIGHT,
            messages=[
                {"role": "system", "content": _POLISH_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"kind: {kind}\n"
                        f"facts: {facts}\n"
                        f"fallback_label: {label}\n"
                        f"fallback_summary: {summary}\n"
                    ),
                },
            ],
            max_tokens=120,
            temperature=0.3,
        )
        content = (response.choices[0].message.content or "").strip()
        if not content:
            return label, summary
        parts = [p.strip() for p in content.split("\n") if p.strip()]
        if not parts:
            return label, summary
        polished_label = parts[0][:120]
        polished_summary = " ".join(parts[1:]).strip() if len(parts) > 1 else summary
        if not polished_summary:
            polished_summary = summary
        return polished_label, polished_summary[:500]
    except Exception as exc:
        logger.debug("Activity milestone polish failed (%s); using template copy", exc)
        return label, summary


async def has_prior_agent_activity(db: AsyncSession, inst: AssessmentInstance) -> bool:
    result = await db.execute(
        select(DecisionEvent.id)
        .where(
            DecisionEvent.assessment_instance_id == inst.id,
            DecisionEvent.event_type.in_(tuple(ACTIVITY_EVENT_TYPES)),
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


async def emit_activity_milestone(
    db: AsyncSession,
    *,
    inst: AssessmentInstance,
    kind: str,
    facts: dict[str, Any] | None = None,
    stage_id: str | None = None,
    actor_user_id: str | None = None,
    actor_email: str | None = None,
    event_type: str = "agent_milestone",
    polish: bool = True,
) -> DecisionEvent:
    """Append a milestone (or pause/block) event and update live agent status."""
    facts = dict(facts or {})
    label, summary = build_milestone_copy(kind, facts)
    if polish:
        label, summary = await polish_milestone_copy(
            db,
            user_id=actor_user_id or inst.started_by,
            kind=kind,
            facts=facts,
            label=label,
            summary=summary,
        )

    inst.agent_current_action = label if event_type == "agent_milestone" else None
    inst.agent_last_summary = summary

    entity_type = "stage" if stage_id else "assessment"
    entity_id = stage_id or str(inst.id)
    return await append_decision_event(
        db,
        inst=inst,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        stage_id=stage_id,
        actor_user_id=actor_user_id,
        actor_email=actor_email,
        payload={
            "kind": kind,
            "label": label,
            "summary": summary,
            "facts": facts,
        },
    )
