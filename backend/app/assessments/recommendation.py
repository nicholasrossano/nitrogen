"""Project-specific assessment recommendation (heuristic + LLM).

Proposals are relevance-gated: include every assessment that fits the project,
never dump the full catalog by default, and always propose at least two.
"""

from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assessments.utils import llm_json
from app.domain.energy.catalog import format_assessment_selection_context

if TYPE_CHECKING:
    from app.assessments.base import BaseAssessment

logger = logging.getLogger(__name__)

MIN_RECOMMENDATIONS = 2

# When no signals exist, prefer broadly useful planning assessments over finance/calc tools.
DEFAULT_FALLBACK_ORDER = (
    "stakeholder_assessment",
    "implementation_plan",
    "landscape_mapping",
    "risk_assessment",
    "lcoe_model",
    "carbon_model",
    "solar_estimate",
    "memo",
)

# Soft boosts when project_type is known (does not alone dump the catalog).
PROJECT_TYPE_BOOSTS: dict[str, dict[str, float]] = {
    "energy_access": {
        "solar_estimate": 0.8,
        "lcoe_model": 0.7,
        "carbon_model": 0.4,
        "stakeholder_assessment": 0.4,
        "implementation_plan": 0.3,
        "landscape_mapping": 0.3,
    },
    "clean_cooking": {
        "carbon_model": 0.9,
        "stakeholder_assessment": 0.5,
        "landscape_mapping": 0.4,
        "implementation_plan": 0.3,
        "risk_assessment": 0.2,
    },
    "agriculture": {
        "stakeholder_assessment": 0.5,
        "implementation_plan": 0.4,
        "landscape_mapping": 0.4,
        "carbon_model": 0.3,
        "risk_assessment": 0.2,
    },
    "water_sanitation": {
        "stakeholder_assessment": 0.5,
        "implementation_plan": 0.4,
        "landscape_mapping": 0.3,
        "risk_assessment": 0.3,
    },
    "health": {
        "stakeholder_assessment": 0.5,
        "implementation_plan": 0.4,
        "landscape_mapping": 0.3,
        "risk_assessment": 0.3,
    },
}

ASSESSMENT_PROPOSAL_SYSTEM_PROMPT = """You are recommending framework assessments for a Nitrogen AI project.

Decide for EACH catalog assessment whether it is meaningfully useful for THIS specific project.
Include every assessment that is relevant — there is no artificial maximum.
Do NOT recommend assessments that are only loosely related or generically "nice to have."
Do NOT recommend the entire catalog by default.

Return JSON only:
{
  "recommendations": [
    {"id": "<assessment_id>", "confidence": 0.0-1.0, "rationale": "<one short sentence>"}
  ]
}

Rules:
- `id` must be one of the catalog assessment IDs provided.
- Only include relevant assessments.
- Prefer precision over recall; empty or thin project context may yield fewer items.
- The application enforces a minimum of two proposals if needed — you should still only list truly relevant IDs when possible.
"""


def score_assessments(
    *,
    project_description: str,
    project_type: str | None = None,
    assessment_ids: set[str] | None = None,
) -> dict[str, float]:
    """Return raw relevance scores keyed by assessment id (0 = no evidence)."""
    from app.domain.registry import get_first_party_catalog

    catalog = get_first_party_catalog()
    ids = assessment_ids or {
        metadata.assessment_id
        for metadata in catalog.selection_metadata.values()
        if metadata.assessment_id != "generate_project_plan"
    }
    scores: dict[str, float] = {tool_id: 0.0 for tool_id in ids}
    text = (project_description or "").lower()

    if text:
        for keyword, tool_ids in catalog.recommendation_keywords.items():
            if keyword in text:
                for tool_id in tool_ids:
                    if tool_id in scores:
                        scores[tool_id] += 1.0

        for metadata in catalog.selection_metadata.values():
            if metadata.assessment_id not in scores:
                continue
            for trigger in metadata.selection_triggers:
                trigger_l = trigger.lower()
                if trigger_l and trigger_l in text:
                    scores[metadata.assessment_id] += 0.75
                    break

        for ptype, keywords in catalog.project_type_keywords.items():
            if any(kw in text for kw in keywords):
                for tool_id, boost in PROJECT_TYPE_BOOSTS.get(ptype, {}).items():
                    if tool_id in scores:
                        scores[tool_id] += boost

    if project_type:
        for tool_id, boost in PROJECT_TYPE_BOOSTS.get(project_type, {}).items():
            if tool_id in scores:
                scores[tool_id] += boost

    return scores


def _signal_present(text: str, signal: str) -> bool:
    """Word-boundary match so short signals ("cfl", "solar") don't hit substrings.

    Plain `in` matching would let unrelated prose open a scope gate — "led" matches
    "modelled", "detailed", "fuelled" — which is exactly how a land-use project
    would slip past the carbon_model gate.
    """
    return re.search(rf"\b{re.escape(signal)}\b", text) is not None


def inapplicable_ids(context_text: str, assessment_ids: set[str]) -> set[str]:
    """Return IDs gated out because their engine cannot model this project.

    Only applies to assessments declaring `applicability_signals`. Assessments
    without them are unaffected.
    """
    from app.domain.registry import get_first_party_catalog

    text = (context_text or "").lower()
    blocked: set[str] = set()
    for metadata in get_first_party_catalog().selection_metadata.values():
        signals = getattr(metadata, "applicability_signals", ())
        if not signals or metadata.assessment_id not in assessment_ids:
            continue
        if not any(_signal_present(text, signal.lower()) for signal in signals):
            blocked.add(metadata.assessment_id)
    return blocked


def confidence_from_score(raw_score: float) -> float:
    """Map raw evidence score to 0-1 confidence without equal-score collapse."""
    if raw_score <= 0:
        return 0.0
    return min(1.0, raw_score / 2.0)


def select_recommended_ids(
    scores: dict[str, float],
    *,
    min_count: int = MIN_RECOMMENDATIONS,
) -> set[str]:
    """Pick recommended IDs from scores: all with evidence, floored to min_count."""
    positive = {tool_id for tool_id, score in scores.items() if score > 0}
    if len(positive) >= min_count:
        return positive

    def sort_key(tool_id: str) -> tuple[float, int]:
        fallback_rank = (
            DEFAULT_FALLBACK_ORDER.index(tool_id)
            if tool_id in DEFAULT_FALLBACK_ORDER
            else len(DEFAULT_FALLBACK_ORDER)
        )
        return (-scores.get(tool_id, 0.0), fallback_rank)

    ordered = sorted(scores.keys(), key=sort_key)
    return set(ordered[: max(min_count, 0)])


def build_recommendation_rows(
    *,
    assessments: list["BaseAssessment"],
    scores: dict[str, float],
    recommended_ids: set[str],
) -> list[tuple["BaseAssessment", float, bool]]:
    """Build (assessment, confidence, recommended) rows sorted by relevance."""
    rows: list[tuple["BaseAssessment", float, bool]] = []
    for assessment in assessments:
        tool_id = assessment.definition.id
        raw = scores.get(tool_id, 0.0)
        confidence = confidence_from_score(raw)
        is_recommended = tool_id in recommended_ids
        if is_recommended and confidence < 0.35:
            # Floor confidence so UI thresholds treat min-floor picks as selected.
            confidence = max(confidence, 0.35)
        rows.append((assessment, confidence, is_recommended))

    rows.sort(key=lambda item: (item[2], item[1]), reverse=True)
    return rows


async def load_materials_preview(
    db: AsyncSession,
    project_id: UUID | str,
    *,
    limit: int = 8,
    max_chars_each: int = 240,
) -> str:
    """Concatenate lightweight evidence previews for recommendation context."""
    from app.models.evidence import EvidenceDoc

    result = await db.execute(
        select(EvidenceDoc.filename, EvidenceDoc.preview_text)
        .where(EvidenceDoc.project_id == project_id)
        .order_by(EvidenceDoc.filename.asc())
        .limit(limit)
    )
    chunks: list[str] = []
    for filename, preview in result.all():
        text = (preview or "").strip()
        if not text:
            continue
        clipped = text[:max_chars_each]
        title = (filename or "document").strip() or "document"
        chunks.append(f"- {title}: {clipped}")
    return "\n".join(chunks)


def _build_user_context(
    *,
    project_title: str,
    project_description: str,
    project_type: str | None,
    materials_preview: str,
    chat_summary: str | None,
) -> str:
    parts = [
        format_assessment_selection_context(),
        "",
        "## Project",
        f"Title: {project_title or 'Untitled'}",
        f"Type: {project_type or 'unspecified'}",
        f"Description: {project_description or '(none provided)'}",
    ]
    if materials_preview.strip():
        parts.extend(["", "## Uploaded materials (lightweight previews)", materials_preview.strip()])
    if chat_summary and chat_summary.strip():
        parts.extend(["", "## Recent chat context", chat_summary.strip()])
    parts.append(
        "\nReturn JSON with a `recommendations` array of relevant assessment IDs only."
    )
    return "\n".join(parts)


async def propose_with_llm(
    *,
    project_title: str,
    project_description: str,
    project_type: str | None,
    materials_preview: str = "",
    chat_summary: str | None = None,
    valid_ids: set[str],
    user_id: str | None = None,
    db: AsyncSession | None = None,
) -> list[tuple[str, float]] | None:
    """Ask the LLM which assessments are relevant. Returns None on failure."""
    try:
        data = await llm_json(
            system=ASSESSMENT_PROPOSAL_SYSTEM_PROMPT,
            user_msg=_build_user_context(
                project_title=project_title,
                project_description=project_description,
                project_type=project_type,
                materials_preview=materials_preview,
                chat_summary=chat_summary,
            ),
            user_id=user_id,
            db=db,
        )
    except Exception:
        logger.exception("Assessment proposal LLM call failed; falling back to heuristic")
        return None

    raw = data.get("recommendations") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return None

    picked: list[tuple[str, float]] = []
    seen: set[str] = set()
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        tool_id = str(entry.get("id") or "").strip()
        if not tool_id or tool_id not in valid_ids or tool_id in seen:
            continue
        try:
            confidence = float(entry.get("confidence", 0.7))
        except (TypeError, ValueError):
            confidence = 0.7
        confidence = max(0.0, min(1.0, confidence))
        seen.add(tool_id)
        picked.append((tool_id, confidence))

    return picked


def merge_llm_with_floor(
    *,
    llm_picks: list[tuple[str, float]] | None,
    heuristic_scores: dict[str, float],
    valid_ids: set[str],
    min_count: int = MIN_RECOMMENDATIONS,
) -> tuple[dict[str, float], set[str]]:
    """Combine LLM picks with heuristic scores and enforce the ≥2 floor."""
    scores = dict(heuristic_scores)
    recommended: set[str] = set()

    if llm_picks:
        for tool_id, confidence in llm_picks:
            if tool_id not in valid_ids:
                continue
            # Preserve heuristic evidence; LLM confidence maps into score space.
            scores[tool_id] = max(scores.get(tool_id, 0.0), max(confidence * 2.0, 0.5))
            recommended.add(tool_id)
    else:
        recommended = {tool_id for tool_id, score in scores.items() if score > 0}

    if len(recommended) < min_count:
        recommended = select_recommended_ids(scores, min_count=min_count)

    return scores, recommended


async def recommend_for_project(
    *,
    assessments: list["BaseAssessment"],
    project_title: str = "",
    project_description: str = "",
    project_type: str | None = None,
    materials_preview: str = "",
    chat_summary: str | None = None,
    user_id: str | None = None,
    db: AsyncSession | None = None,
    use_llm: bool = True,
) -> list[tuple["BaseAssessment", float, bool]]:
    """Full recommendation pipeline for a project."""
    valid_ids = {a.definition.id for a in assessments}
    context_text = " ".join(
        part
        for part in (project_title, project_description, materials_preview, chat_summary or "")
        if part
    )
    heuristic_scores = score_assessments(
        project_description=context_text,
        project_type=project_type,
        assessment_ids=valid_ids,
    )

    # Drop out-of-scope assessments before the floor logic can reinstate them:
    # `select_recommended_ids` picks from whatever keys remain in `scores`.
    blocked_ids = inapplicable_ids(context_text, valid_ids)
    if blocked_ids:
        logger.info(
            "Gated out-of-scope assessments for project %r: %s",
            project_title or "(untitled)",
            sorted(blocked_ids),
        )
        heuristic_scores = {
            tool_id: score
            for tool_id, score in heuristic_scores.items()
            if tool_id not in blocked_ids
        }

    llm_picks: list[tuple[str, float]] | None = None
    if use_llm and (project_description or materials_preview or project_title):
        llm_picks = await propose_with_llm(
            project_title=project_title,
            project_description=project_description,
            project_type=project_type,
            materials_preview=materials_preview,
            chat_summary=chat_summary,
            valid_ids=valid_ids,
            user_id=user_id,
            db=db,
        )

    if llm_picks and blocked_ids:
        # The prompt states the scope, but the model still sometimes picks on name
        # alone ("Carbon Emissions Calculator" for a reforestation project).
        llm_picks = [pick for pick in llm_picks if pick[0] not in blocked_ids]

    scores, recommended_ids = merge_llm_with_floor(
        llm_picks=llm_picks,
        heuristic_scores=heuristic_scores,
        valid_ids=valid_ids,
    )

    if llm_picks:
        # Prefer LLM confidence when present.
        llm_confidence = {tool_id: conf for tool_id, conf in llm_picks}
        rows: list[tuple["BaseAssessment", float, bool]] = []
        for assessment in assessments:
            tool_id = assessment.definition.id
            is_recommended = tool_id in recommended_ids
            if tool_id in llm_confidence:
                confidence = llm_confidence[tool_id]
            else:
                confidence = confidence_from_score(scores.get(tool_id, 0.0))
            if is_recommended and confidence < 0.35:
                confidence = max(confidence, 0.35)
            rows.append((assessment, confidence, is_recommended))
        rows.sort(key=lambda item: (item[2], item[1]), reverse=True)
        return rows

    return build_recommendation_rows(
        assessments=assessments,
        scores=scores,
        recommended_ids=recommended_ids,
    )
