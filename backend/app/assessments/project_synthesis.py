"""Cross-assessment project synthesis context for narrative assessments.

Builds a soft-consume pack from approved (preferred) or confirmed assessments,
core variables, project status judgments, and the project plan. Used by
memo so writeups stay consistent with the rest of the project.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Soft dependencies — consumed when available; gaps go into open questions.
SYNTHESIS_ASSESSMENT_IDS: tuple[str, ...] = (
    "risk_assessment",
    "stakeholder_assessment",
    "landscape_mapping",
    "implementation_plan",
    "lcoe_model",
    "carbon_model",
    "solar_estimate",
)

_MAX_ITEM_LINES = 12
_MAX_FIELD_CHARS = 220
_MAX_SUMMARY_CHARS = 900


def _clip(value: Any, *, max_chars: int = _MAX_FIELD_CHARS) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text:
        return ""
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"


def _humanize_assessment_id(assessment_id: str) -> str:
    return " ".join(part.capitalize() for part in assessment_id.replace("_", " ").split())


def _stage_status(state: dict[str, Any], stage_id: str) -> str:
    stages = state.get("stages") or {}
    stage = stages.get(stage_id) if isinstance(stages, dict) else None
    if not isinstance(stage, dict):
        return "pending"
    return str(stage.get("status") or "pending")


def _confirmed_stage_count(state: dict[str, Any]) -> int:
    stages = state.get("stages") or {}
    if not isinstance(stages, dict):
        return 0
    return sum(1 for s in stages.values() if isinstance(s, dict) and s.get("status") == "confirmed")


def _is_approved(instance: Any) -> bool:
    return bool(getattr(instance, "is_plan_complete", False))


def _pick_best_instance(instances: list[Any]) -> Any | None:
    """Prefer approved instances; otherwise the one with the most confirmed stages."""
    if not instances:
        return None
    approved = [i for i in instances if _is_approved(i)]
    pool = approved or instances
    return max(
        pool,
        key=lambda i: (
            1 if _is_approved(i) else 0,
            _confirmed_stage_count(i.workflow_state or {}),
            i.updated_at or i.created_at,
        ),
    )


def _item_content_lines(items: list[dict[str, Any]], *, preferred_keys: tuple[str, ...]) -> list[str]:
    lines: list[str] = []
    for item in items[:_MAX_ITEM_LINES]:
        content = item.get("content") if isinstance(item, dict) else None
        if not isinstance(content, dict):
            continue
        parts: list[str] = []
        for key in preferred_keys:
            val = _clip(content.get(key), max_chars=140)
            if val:
                parts.append(val)
        if not parts:
            # Fall back to first short string fields.
            for key, val in content.items():
                if key.startswith("_"):
                    continue
                clipped = _clip(val, max_chars=120)
                if clipped:
                    parts.append(clipped)
                if len(parts) >= 2:
                    break
        if parts:
            lines.append(" — ".join(parts))
    return lines


def _summarize_workflow_state(assessment_id: str, state: dict[str, Any]) -> str:
    """Extract a compact confirmed-stage summary tailored by assessment type."""
    stages = state.get("stages") if isinstance(state.get("stages"), dict) else {}
    chunks: list[str] = []

    def _stage_items(stage_id: str) -> list[dict[str, Any]]:
        stage = stages.get(stage_id) or {}
        data = stage.get("data") if isinstance(stage, dict) else {}
        items = (data or {}).get("items") if isinstance(data, dict) else []
        return items if isinstance(items, list) else []

    def _widget(stage_id: str) -> dict[str, Any]:
        stage = stages.get(stage_id) or {}
        data = stage.get("data") if isinstance(stage, dict) else {}
        widget = (data or {}).get("widget_data") if isinstance(data, dict) else {}
        return widget if isinstance(widget, dict) else {}

    if assessment_id == "risk_assessment":
        if _stage_status(state, "risks") == "confirmed":
            lines = _item_content_lines(
                _stage_items("risks"),
                preferred_keys=("title", "category", "why_it_matters", "evidence_status"),
            )
            if lines:
                chunks.append("Risks:\n" + "\n".join(f"- {line}" for line in lines))
        widget = _widget("results")
        top = widget.get("top_risks") if isinstance(widget.get("top_risks"), list) else []
        if top:
            chunks.append("Top risks: " + "; ".join(_clip(t, max_chars=100) for t in top[:6] if t))
        unresolved = widget.get("unresolved_issues") if isinstance(widget.get("unresolved_issues"), list) else []
        if unresolved:
            chunks.append(
                "Unresolved: " + "; ".join(_clip(t, max_chars=100) for t in unresolved[:6] if t)
            )

    elif assessment_id == "stakeholder_assessment":
        if _stage_status(state, "stakeholders") == "confirmed":
            lines = _item_content_lines(
                _stage_items("stakeholders"),
                preferred_keys=("name", "category", "why_they_matter"),
            )
            if lines:
                chunks.append("Stakeholders:\n" + "\n".join(f"- {line}" for line in lines))

    elif assessment_id == "landscape_mapping":
        if _stage_status(state, "entities") == "confirmed":
            lines = _item_content_lines(
                _stage_items("entities"),
                preferred_keys=("name", "category", "description"),
            )
            if lines:
                chunks.append("Landscape entities:\n" + "\n".join(f"- {line}" for line in lines))

    elif assessment_id == "implementation_plan":
        if _stage_status(state, "phases") == "confirmed":
            lines = _item_content_lines(
                _stage_items("phases"),
                preferred_keys=("label", "description"),
            )
            if lines:
                chunks.append("Plan phases:\n" + "\n".join(f"- {line}" for line in lines))
        if _stage_status(state, "activities") == "confirmed":
            lines = _item_content_lines(
                _stage_items("activities"),
                preferred_keys=("name", "category", "summary"),
            )
            if lines:
                chunks.append("Activities:\n" + "\n".join(f"- {line}" for line in lines))

    elif assessment_id in {"lcoe_model", "carbon_model", "solar_estimate"}:
        for stage_id, stage in stages.items():
            if not isinstance(stage, dict) or stage.get("status") != "confirmed":
                continue
            data = stage.get("data") if isinstance(stage.get("data"), dict) else {}
            widget = data.get("widget_data") if isinstance(data, dict) else None
            if isinstance(widget, dict) and widget:
                # Prefer scalar result highlights over full tables.
                highlights: list[str] = []
                for key in (
                    "lcoe",
                    "lcoe_usd_per_kwh",
                    "annual_generation_kwh",
                    "emission_reductions_tco2e",
                    "tco2e",
                    "capacity_kw",
                    "summary",
                ):
                    if key in widget and widget[key] not in (None, "", []):
                        highlights.append(f"{key}={_clip(widget[key], max_chars=80)}")
                if highlights:
                    chunks.append(f"{stage_id}: " + "; ".join(highlights[:8]))
                else:
                    chunks.append(f"{stage_id}: confirmed computed results available")

    if not chunks:
        # Generic fallback: list confirmed stage ids + a few item labels.
        confirmed_ids = [
            sid for sid, stage in stages.items()
            if isinstance(stage, dict) and stage.get("status") == "confirmed"
        ]
        if confirmed_ids:
            chunks.append("Confirmed stages: " + ", ".join(confirmed_ids))
            for sid in confirmed_ids[:2]:
                lines = _item_content_lines(
                    _stage_items(sid),
                    preferred_keys=("label", "title", "name", "summary", "description"),
                )
                if lines:
                    chunks.append(f"{sid}:\n" + "\n".join(f"- {line}" for line in lines[:6]))

    return _clip("\n\n".join(chunks), max_chars=_MAX_SUMMARY_CHARS)


def _plan_summary(project_plan: dict[str, Any] | None) -> str:
    if not isinstance(project_plan, dict):
        return ""
    pillars = project_plan.get("pillars")
    if not isinstance(pillars, list):
        return ""
    lines: list[str] = []
    for pillar in pillars[:6]:
        if not isinstance(pillar, dict):
            continue
        label = _clip(pillar.get("label") or pillar.get("name") or pillar.get("title"), max_chars=80)
        if not label:
            continue
        items = pillar.get("items") if isinstance(pillar.get("items"), list) else []
        complete = sum(1 for i in items if isinstance(i, dict) and i.get("status") == "complete")
        lines.append(f"- {label} ({complete}/{len(items)} items complete)")
    return "\n".join(lines)


def format_synthesis_for_prompt(pack: dict[str, Any]) -> str:
    """Render a synthesis pack as prompt text."""
    parts: list[str] = ["## Project synthesis context"]

    profile = pack.get("project_profile") or {}
    if profile:
        parts.append(
            "Project: "
            + ", ".join(
                f"{k}={v}"
                for k, v in {
                    "title": profile.get("title"),
                    "geography": profile.get("geography"),
                    "type": profile.get("project_type"),
                    "stage": profile.get("stage"),
                }.items()
                if v
            )
        )
        if profile.get("description"):
            parts.append(f"Description: {profile['description']}")

    assessments = pack.get("assessments") or []
    if assessments:
        parts.append("### Confirmed / approved assessments")
        for entry in assessments:
            status = entry.get("approval_status", "confirmed")
            parts.append(
                f"#### {entry.get('display_name')} [{status}]\n{entry.get('summary') or '(no summary)'}"
            )
    else:
        parts.append("### Confirmed / approved assessments\nNone available yet.")

    variables = pack.get("variables") or {}
    examples = variables.get("examples") if isinstance(variables, dict) else None
    if examples:
        parts.append("### Core variables")
        for row in examples[:14]:
            parts.append(
                f"- {row.get('label')}: {row.get('value') or '—'} "
                f"(status={row.get('status')})"
            )

    status_rows = pack.get("status") or []
    if status_rows:
        parts.append("### Project status")
        for row in status_rows:
            parts.append(
                f"- {row.get('label')}: {row.get('status')} "
                f"(confidence={row.get('confidence')}) — {_clip(row.get('rationale'), max_chars=180)}"
            )

    plan = pack.get("project_plan_summary") or ""
    if plan:
        parts.append("### Project plan\n" + plan)

    missing = pack.get("sources_missing") or []
    if missing:
        parts.append(
            "### Sources missing (call out in Open Questions if material)\n"
            + "\n".join(f"- {_humanize_assessment_id(mid)}" for mid in missing)
        )

    return "\n\n".join(parts)


async def build_project_synthesis_context(
    db: AsyncSession | None,
    project_id: UUID | str | None,
    *,
    initiative_context: dict[str, Any] | None = None,
    exclude_assessment_id: str = "memo",
) -> dict[str, Any]:
    """Collect soft-consume project synthesis for memo-style generation.

    Returns a structured pack with:
      project_profile, assessments[], variables, status[], project_plan_summary,
      sources_used[], sources_missing[], prompt_text
    """
    ctx = initiative_context or {}
    empty = {
        "project_profile": {
            "title": ctx.get("project_title") or "",
            "geography": ctx.get("geography") or "",
            "project_type": ctx.get("project_type") or "",
            "stage": "",
            "description": _clip(ctx.get("project_description"), max_chars=420),
        },
        "assessments": [],
        "variables": {"examples": _variable_examples_from_context(ctx)},
        "status": [],
        "project_plan_summary": _plan_summary(ctx.get("project_plan")),
        "sources_used": [],
        "sources_missing": list(SYNTHESIS_ASSESSMENT_IDS),
        "prompt_text": "",
    }
    empty["prompt_text"] = format_synthesis_for_prompt(empty)

    if db is None or project_id is None:
        return empty

    try:
        pid = UUID(str(project_id))
    except (TypeError, ValueError):
        return empty

    from app.models.project import Project
    from app.models.project_status import ProjectStatusResult

    project = await db.get(Project, pid)
    if project is None:
        return empty

    instances = [
        i
        for i in (project.assessment_instances or [])
        if not getattr(i, "archived", False)
        and str(i.assessment_id or "") != exclude_assessment_id
    ]
    by_id: dict[str, list[Any]] = {}
    for inst in instances:
        aid = str(inst.assessment_id or "").strip()
        if not aid:
            continue
        by_id.setdefault(aid, []).append(inst)

    assessments_out: list[dict[str, Any]] = []
    sources_used: list[str] = []
    sources_missing: list[str] = []

    for assessment_id in SYNTHESIS_ASSESSMENT_IDS:
        best = _pick_best_instance(by_id.get(assessment_id, []))
        if best is None:
            sources_missing.append(assessment_id)
            continue
        state = best.workflow_state if isinstance(best.workflow_state, dict) else {}
        confirmed = _confirmed_stage_count(state)
        approved = _is_approved(best)
        if not approved and confirmed == 0:
            sources_missing.append(assessment_id)
            continue

        summary = _summarize_workflow_state(assessment_id, state)
        if not summary and isinstance(best.deliverable, dict):
            # Fall back to deliverable blurbs for approved exports.
            for key in ("executive_summary", "summary", "recommendation", "analysis"):
                blur = _clip(best.deliverable.get(key), max_chars=360)
                if blur:
                    summary = blur
                    break

        display_name = (
            best.title.strip()
            if isinstance(best.title, str) and best.title.strip()
            else _humanize_assessment_id(assessment_id)
        )
        assessments_out.append(
            {
                "instance_id": str(best.id),
                "assessment_id": assessment_id,
                "display_name": display_name,
                "approval_status": "approved" if approved else "confirmed_stages",
                "confirmed_stage_count": confirmed,
                "summary": summary or "(confirmed but no extractable summary)",
            }
        )
        sources_used.append(assessment_id)

    status_rows: list[dict[str, Any]] = []
    try:
        result = await db.execute(
            select(ProjectStatusResult)
            .where(ProjectStatusResult.project_id == pid)
            .order_by(ProjectStatusResult.last_updated_at.desc())
            .limit(12)
        )
        for row in result.scalars().all():
            status_rows.append(
                {
                    "category_key": row.category_key,
                    "label": row.category_label,
                    "status": row.status,
                    "confidence": row.confidence,
                    "rationale": _clip(row.rationale, max_chars=260),
                    "is_stale": bool(row.is_stale),
                }
            )
    except Exception as exc:
        logger.warning("Failed loading project status for synthesis: %s", exc)

    pack = {
        "project_profile": {
            "title": project.title or ctx.get("project_title") or "",
            "geography": project.geography or ctx.get("geography") or "",
            "project_type": project.project_type or ctx.get("project_type") or "",
            "stage": project.stage or "",
            "description": _clip(
                project.project_description or project.goal or ctx.get("project_description"),
                max_chars=420,
            ),
        },
        "assessments": assessments_out,
        "variables": {
            "examples": _variable_examples_from_context(ctx)
            or _variable_examples_from_context({"variables": getattr(project, "variables", None)})
        },
        "status": status_rows,
        "project_plan_summary": _plan_summary(project.project_plan or ctx.get("project_plan")),
        "sources_used": sources_used,
        "sources_missing": sources_missing,
        "prompt_text": "",
    }
    pack["prompt_text"] = format_synthesis_for_prompt(pack)
    return pack


def _variable_examples_from_context(ctx: dict[str, Any]) -> list[dict[str, str]]:
    """Normalize variables from initiative context (list or nested dict)."""
    variables = ctx.get("variables")

    def _from_rows(rows: list[Any]) -> list[dict[str, str]]:
        out: list[dict[str, str]] = []
        for row in rows[:14]:
            if not isinstance(row, dict):
                continue
            label = row.get("label") or row.get("name") or row.get("key")
            if not label:
                continue
            out.append(
                {
                    "label": str(label),
                    "value": _clip(row.get("value"), max_chars=120),
                    "status": str(row.get("status") or ""),
                    "notes": _clip(row.get("notes"), max_chars=120),
                }
            )
        return out

    # Primary shape from variables_as_context: list[dict]
    if isinstance(variables, list):
        return _from_rows(variables)

    if not isinstance(variables, dict):
        return []

    rows = variables.get("items") or variables.get("examples") or variables.get("active")
    if isinstance(rows, list):
        return _from_rows(rows)

    # Flat {key: {value, status}} or {key: value}
    out: list[dict[str, str]] = []
    for key, val in list(variables.items())[:14]:
        if key in {"items", "examples", "active", "total", "validated", "missing"}:
            continue
        if isinstance(val, dict):
            out.append(
                {
                    "label": str(val.get("label") or key),
                    "value": _clip(val.get("value"), max_chars=120),
                    "status": str(val.get("status") or ""),
                    "notes": _clip(val.get("notes"), max_chars=120),
                }
            )
        else:
            out.append({"label": str(key), "value": _clip(val, max_chars=120), "status": "", "notes": ""})
    return out
