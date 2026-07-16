from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assessments.registry import get_assessment_registry
from app.assumptions.config import (
    ASSUMPTION_BY_KEY,
    AssumptionDefinition,
    expected_assumptions_for_assessments,
)
from app.config import get_settings
from app.core.llm_invoke import acompletion
from app.core.model_catalog import Complexity, ModelRole
from app.domain.resolver import get_active_domain
from app.models.assessment_instance import AssessmentInstance
from app.models.assumption import Assumption, AssumptionBinding, AssumptionComment
from app.models.evidence import EvidenceChunk, EvidenceDoc
from app.models.project import Project
from app.models.project_material import ProjectMaterial

logger = logging.getLogger(__name__)
settings = get_settings()

ATTENTION_STATUSES = {"missing", "extracted", "assumed"}
ACTIVE_STATUSES = {"validated", "extracted", "assumed", "missing"}
SYSTEM_ACTOR = "system"
MAX_PROMPT_ASSUMPTIONS = 12
MAX_EXTRACTION_CHARS = 14000
WORLDBANK_INDICATOR_TO_ASSUMPTION_KEY: dict[str, str] = {
    "EG.ELC.ACCS.ZS": "electricity_access_total",
    "EG.ELC.ACCS.RU.ZS": "electricity_access_rural",
    "EG.ELC.ACCS.UR.ZS": "electricity_access_urban",
    "EG.CFT.ACCS.ZS": "clean_cooking_access",
    "SP.POP.TOTL": "population_total",
    "NY.GDP.PCAP.CD": "gdp_per_capita",
    "FP.CPI.TOTL.ZG": "inflation",
    "SI.POV.DDAY": "poverty_headcount",
}


@dataclass(frozen=True)
class AssumptionActor:
    user_id: str | None = None
    email: str | None = None

    @classmethod
    def system(cls) -> "AssumptionActor":
        return cls(user_id=SYSTEM_ACTOR, email=SYSTEM_ACTOR)


def normalize_assumption_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def _definition_for_key(key: str) -> AssumptionDefinition | None:
    return ASSUMPTION_BY_KEY.get(normalize_assumption_key(key))


def _definition_for_assessment_field(field_key: str, assessment_id: str) -> AssumptionDefinition | None:
    normalized = normalize_assumption_key(field_key)
    exact = _definition_for_key(normalized)
    if exact and assessment_id in exact.used_in_assessments:
        return exact
    for definition in ASSUMPTION_BY_KEY.values():
        aliases = {
            normalize_assumption_key(alias)
            for alias in definition.assessment_field_keys.get(assessment_id, [])
        }
        if normalized in aliases:
            return definition
    return None


def _assessment_ids_from_initiative(initiative: Project) -> list[str]:
    # Drive assumption requirements from active assessment instances, not planned tools.
    # This prevents static required placeholders from appearing before a assessment exists.
    assessments: set[str] = set()
    for inst in initiative.assessment_instances or []:
        if not getattr(inst, "archived", False):
            assessments.add(inst.assessment_id)
    return sorted(assessments)


def _coerce_assessments(assessments: list[str] | None, definition: AssumptionDefinition | None) -> list[str]:
    values = set(assessments or [])
    if definition:
        values.update(definition.used_in_assessments)
    return sorted(values)


def suggest_assumption_candidates(facts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Suggest durable assumption candidates from retrieved World Bank indicators."""
    if get_active_domain() != "energy":
        return []
    candidates: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    for fact in facts:
        source_type = str(fact.get("source_type") or "").lower()
        if source_type != "worldbank_indicator":
            continue

        chunk_id = str(fact.get("chunk_id") or "")
        indicator_code = ""
        if ":" in chunk_id:
            parts = chunk_id.split(":")
            if len(parts) >= 2:
                indicator_code = parts[1]
        if not indicator_code:
            content = str(fact.get("content") or "")
            match = re.search(r"\(([A-Z0-9.]+)\)", content)
            if match:
                indicator_code = match.group(1)
        if not indicator_code:
            continue

        candidate_key = WORLDBANK_INDICATOR_TO_ASSUMPTION_KEY.get(indicator_code)
        if not candidate_key or candidate_key in seen_keys:
            continue
        seen_keys.add(candidate_key)

        definition = _definition_for_key(candidate_key)
        candidates.append(
            {
                "key": candidate_key,
                "label": definition.label if definition else candidate_key.replace("_", " ").title(),
                "value": None,
                "unit": definition.unit if definition else None,
                "status": "suggested",
                "source_reference": {
                    "source_type": fact.get("source_type"),
                    "source_title": fact.get("source_title"),
                    "source_url": fact.get("source_url"),
                    "indicator_code": indicator_code,
                    "retrieved_fact_id": chunk_id or None,
                },
            }
        )
    return candidates


def _source_type_value(source_type: Any) -> str:
    return str(getattr(source_type, "value", source_type) or "").lower()


def _worldbank_indicator_code(fact: Any) -> str | None:
    chunk_id = str(getattr(fact, "chunk_id", None) or "")
    if ":" in chunk_id:
        parts = chunk_id.split(":")
        if len(parts) >= 2 and parts[1]:
            return parts[1]

    content = str(getattr(fact, "content", "") or "")
    match = re.search(r"\(([A-Z0-9.]+)\)", content)
    return match.group(1) if match else None


def _worldbank_country_name(fact: Any) -> str | None:
    content = str(getattr(fact, "content", "") or "")
    match = re.search(r"\sfor\s+(.+?)\s+in\s+\d{4}\s*:", content)
    if match:
        return match.group(1).strip()

    source_title = str(getattr(fact, "source_title", "") or "")
    match = re.search(r"\(([^()]+)\)\s*$", source_title)
    return match.group(1).strip() if match else None


def _worldbank_indicator_value(fact: Any) -> float | int | None:
    content = str(getattr(fact, "content", "") or "")
    match = re.search(r":\s*(-?\d+(?:\.\d+)?)\s*\.?\s*$", content)
    if not match:
        return None
    value = float(match.group(1))
    return int(value) if value.is_integer() else value


def _fact_was_cited(answer_content: str, fact: Any) -> bool:
    citation = getattr(fact, "to_citation_string", lambda: "")()
    if citation and citation in answer_content:
        return True
    source_title = str(getattr(fact, "source_title", "") or "")
    return bool(source_title and f"Country Indicator: {source_title}" in answer_content)


def build_chat_assumption_candidate(
    fact: Any,
    *,
    answer_content: str,
) -> dict[str, Any] | None:
    """Build a syntactic assumption candidate from a cited indicator fact."""
    if get_active_domain() != "energy":
        return None
    if _source_type_value(getattr(fact, "source_type", None)) != "worldbank_indicator":
        return None
    if not _fact_was_cited(answer_content, fact):
        return None

    indicator_code = _worldbank_indicator_code(fact)
    candidate_key = WORLDBANK_INDICATOR_TO_ASSUMPTION_KEY.get(indicator_code or "")
    definition = _definition_for_key(candidate_key or "")
    if candidate_key is None or definition is None:
        return None

    value = _worldbank_indicator_value(fact)
    if value is None:
        return None

    return {
        "key": candidate_key,
        "value": value,
        "label": definition.label,
        "unit": definition.unit,
        "value_type": definition.value_type,
        "used_in_assessments": definition.used_in_assessments,
        "source_reference": {
            "source_type": _source_type_value(getattr(fact, "source_type", None)),
            "source_title": getattr(fact, "source_title", None),
            "source_url": getattr(fact, "source_url", None),
            "publisher": getattr(fact, "publisher", None),
            "indicator_code": indicator_code,
            "country": _worldbank_country_name(fact),
            "retrieved_fact_id": getattr(fact, "chunk_id", None),
            "quote": getattr(fact, "content", None),
        },
    }


def _initiative_relevance_context(initiative: Project) -> dict[str, Any]:
    return {
        "title": getattr(initiative, "title", None),
        "geography": getattr(initiative, "geography", None),
        "project_type": getattr(initiative, "project_type", None),
        "sector": getattr(initiative, "sector", None),
        "description": getattr(initiative, "project_description", None),
        "goal": getattr(initiative, "goal", None),
    }


async def _should_log_chat_assumption(
    db: AsyncSession,
    initiative: Project,
    candidate: dict[str, Any],
    *,
    actor: AssumptionActor,
    user_message: str | None,
    answer_content: str,
) -> tuple[bool, str | None]:
    prompt = (
        "Decide whether a cited chat fact should be saved as a reusable project variable.\n\n"
        "Only return should_log=true when the cited fact is actually relevant to this project as a "
        "baseline, model input, planning assumption, or explicitly adopted proxy. Return false for "
        "general trivia, unrelated countries or sectors, background comparisons not adopted for the "
        "project, or facts merely mentioned while answering a side question.\n\n"
        f"Project context:\n{json.dumps(_initiative_relevance_context(initiative), indent=2)}\n\n"
        f"User question:\n{user_message or ''}\n\n"
        f"Assistant answer:\n{answer_content[:3000]}\n\n"
        f"Candidate assumption:\n{json.dumps(candidate, indent=2)}"
    )
    tool_def = {
        "type": "function",
        "function": {
            "name": "classify_assumption_relevance",
            "description": "Decide whether a cited fact should be logged as a reusable project variable.",
            "parameters": {
                "type": "object",
                "properties": {
                    "should_log": {
                        "type": "boolean",
                        "description": "True only if this should become a project variable.",
                    },
                    "reason": {
                        "type": "string",
                        "description": "One concise sentence explaining the decision.",
                    },
                },
                "required": ["should_log", "reason"],
            },
        },
    }
    try:
        resp = await acompletion(
            actor.user_id,
            db,
            role=ModelRole.ORCHESTRATION,
            complexity=Complexity.STANDARD,
            messages=[{"role": "user", "content": prompt}],
            tools=[tool_def],
            tool_choice={"type": "function", "function": {"name": "classify_assumption_relevance"}},
            temperature=0,
            max_tokens=180,
        )
        tool_calls = resp.choices[0].message.tool_calls or []
        if not tool_calls:
            return False, "No relevance decision returned."
        payload = json.loads(tool_calls[0].function.arguments)
        return bool(payload.get("should_log")), str(payload.get("reason") or "")
    except Exception as exc:
        logger.warning("Chat assumption relevance classification failed: %s", exc, exc_info=True)
        return False, "Relevance classification failed."


async def extract_assumptions_from_cited_chat_sources(
    db: AsyncSession,
    initiative: Project | None,
    cited_sources: list[Any],
    *,
    answer_content: str,
    actor: AssumptionActor,
    user_message: str | None = None,
    chat_id: str | None = None,
) -> list[Assumption]:
    """Persist project-relevant assumptions from facts the final chat answer cited."""
    if initiative is None or not getattr(initiative, "id", None):
        return []

    touched: list[Assumption] = []
    seen_keys: set[str] = set()
    for fact in cited_sources:
        candidate = build_chat_assumption_candidate(
            fact,
            answer_content=answer_content,
        )
        if candidate is None or candidate["key"] in seen_keys:
            continue
        should_log, relevance_reason = await _should_log_chat_assumption(
            db,
            initiative,
            candidate,
            actor=actor,
            user_message=user_message,
            answer_content=answer_content,
        )
        if not should_log:
            continue
        seen_keys.add(candidate["key"])
        source_reference = {
            **candidate["source_reference"],
            "chat_id": chat_id,
            "user_message": user_message,
            "relevance_reason": relevance_reason,
            "extracted_at": datetime.now(timezone.utc).isoformat(),
        }
        assumption, _created = await upsert_assumption(
            db,
            project_id=initiative.id,
            key=candidate["key"],
            value=candidate["value"],
            label=candidate["label"],
            unit=candidate["unit"],
            value_type=candidate["value_type"],
            source_type="model_candidate",
            source_reference=source_reference,
            status="extracted",
            used_in_assessments=candidate["used_in_assessments"],
            actor=actor,
            allow_create=False,
        )
        if assumption is None:
            continue
        touched.append(assumption)
    return touched


def _actor_email(actor: AssumptionActor | None) -> str | None:
    return actor.email if actor and actor.email else None


def _actor_user_id(actor: AssumptionActor | None) -> str | None:
    return actor.user_id if actor and actor.user_id else None


def normalize_assumption_status(status: str | None, *, default: str = "assumed") -> str:
    normalized = (status or "").strip().lower()
    mapping = {
        "validated": "validated",
        "inferred": "extracted",
        "extracted": "extracted",
        "assumed": "assumed",
        "missing": "missing",
        "needs_review": "extracted",
        "rejected": "rejected",
    }
    return mapping.get(normalized, default)


MISSING_VALUE_TOKENS = {
    "",
    "—",
    "-",
    "–",
    "n/a",
    "na",
    "none",
    "null",
    "missing",
    "tbd",
    "unknown",
    "not available",
    "not provided",
}

STRING_ASSERTION_MARKERS = (
    " is ",
    " are ",
    " was ",
    " were ",
    " will be ",
    " should be ",
    " equals ",
    " set to ",
    " assumed",
    " baseline",
    " target",
    " rate",
    " cost",
    " price",
    " supplier",
    " provider",
    " operator",
    " located",
)


def normalize_missing_value(value: Any) -> Any:
    if value is None:
        return None
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    lowered = stripped.lower()
    if lowered in MISSING_VALUE_TOKENS or lowered.startswith("unknown "):
        return None
    return stripped


def _value_is_missing(value: Any) -> bool:
    return normalize_missing_value(value) is None


def _passes_extraction_quality_gate(
    raw: dict[str, Any],
    *,
    value_type: str | None = None,
    definition: AssumptionDefinition | None = None,
) -> bool:
    quote = str(raw.get("source_quote") or "").strip()
    if not quote:
        return False

    value = normalize_missing_value(raw.get("value"))
    if value is None:
        return False

    resolved_type = value_type or (definition.value_type if definition else infer_assumption_value_type(value))

    # For numeric/currency/percent assumptions, insist on explicit quantitative
    # evidence in the source quote to avoid entity/theme leakage.
    if resolved_type in {"number", "percent", "currency"}:
        if not re.search(r"-?\d", quote):
            return False

    # For string assumptions, require assertion language in the quote
    # (e.g., "supplier is X"), not bare entity mentions.
    if isinstance(value, str):
        lowered_quote = f" {quote.lower()} "
        if not any(marker in lowered_quote for marker in STRING_ASSERTION_MARKERS):
            return False

    return True


SOURCE_TRUST: dict[str, int] = {
    "user_input": 4,
    "chat_approval": 4,
    "assessment_approval": 3,
    "assessment": 3,
    "promotion": 2,
    "extraction": 1,
    "model_candidate": 1,
    "default": 0,
    "missing_placeholder": 0,
}


def _source_trust(source_type: str | None) -> int:
    return SOURCE_TRUST.get(str(source_type or ""), 1)


EXTRACTION_FEEDBACK_SOURCES = {
    "extraction",
    "model_candidate",
    "assessment_approval",
    "promotion",
}


def _stamp_outcome(source_reference: dict | None, outcome: str) -> dict:
    ref = dict(source_reference or {})
    ref["outcome"] = outcome
    ref["outcome_at"] = datetime.now(timezone.utc).isoformat()
    return ref


def infer_assumption_value_type(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if value is None:
        return "string"
    if isinstance(value, (dict, list)):
        return "text"
    return "string"


async def list_assumptions(
    db: AsyncSession,
    project_id: UUID,
    *,
    status: str | None = None,
    source_type: str | None = None,
    assessment: str | None = None,
) -> list[Assumption]:
    normalized_status_filter = normalize_assumption_status(status, default="")
    stmt = select(Assumption).where(
        Assumption.project_id == project_id,
        Assumption.status != "rejected",
    )
    if normalized_status_filter:
        if normalized_status_filter == "extracted":
            stmt = stmt.where(Assumption.status.in_(["extracted", "inferred", "needs_review"]))
        else:
            stmt = stmt.where(Assumption.status == normalized_status_filter)
    if source_type:
        stmt = stmt.where(Assumption.source_type == source_type)
    stmt = stmt.order_by(Assumption.updated_at.desc(), Assumption.created_at.desc())
    result = await db.execute(stmt)
    rows = list(result.scalars().all())
    for row in rows:
        row.status = normalize_assumption_status(row.status, default="assumed")
    if assessment:
        rows = [row for row in rows if assessment in (row.used_in_assessments or [])]
    return rows


async def get_assumption(db: AsyncSession, assumption_id: UUID) -> Assumption | None:
    assumption = await db.get(Assumption, assumption_id)
    if assumption is None or normalize_assumption_status(assumption.status) == "rejected":
        return None
    assumption.status = normalize_assumption_status(assumption.status, default="assumed")
    return assumption


async def list_assumption_comments(
    db: AsyncSession,
    assumption_id: UUID,
) -> list[AssumptionComment]:
    result = await db.execute(
        select(AssumptionComment)
        .where(AssumptionComment.assumption_id == assumption_id)
        .order_by(AssumptionComment.created_at.asc())
    )
    return list(result.scalars().all())


async def create_assumption_comment(
    db: AsyncSession,
    assumption: Assumption,
    *,
    body: str,
    actor: AssumptionActor,
) -> AssumptionComment:
    comment = AssumptionComment(
        assumption_id=assumption.id,
        project_id=assumption.project_id,
        body=body.strip(),
        created_by_user_id=actor.user_id,
        created_by_email=actor.email,
    )
    db.add(comment)
    assumption.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return comment


async def upsert_assumption(
    db: AsyncSession,
    *,
    project_id: UUID,
    key: str,
    value: Any = None,
    label: str | None = None,
    unit: str | None = None,
    value_type: str | None = None,
    source_type: str,
    source_reference: dict[str, Any] | None = None,
    status: str = "assumed",
    used_in_assessments: list[str] | None = None,
    actor: AssumptionActor | None = None,
    notes: str | None = None,
    replace_validated: bool = False,
    allow_create: bool = True,
) -> tuple[Assumption | None, bool]:
    from app.services.assumption_dedup import merge_alias_list, resolve_canonical_assumption

    normalized_key = normalize_assumption_key(key)
    definition = _definition_for_key(normalized_key)
    resolved_label = label or (definition.label if definition else normalized_key.replace("_", " ").title())

    existing = await resolve_canonical_assumption(
        db,
        project_id,
        key=normalized_key,
        label=resolved_label,
    )

    assessments = _coerce_assessments(used_in_assessments, definition)
    normalized_value = normalize_missing_value(value)
    normalized_status = normalize_assumption_status(status)
    if normalized_value is None and normalized_status != "missing":
        normalized_status = "missing"
    now = datetime.now(timezone.utc)

    # Fresh extraction proposals start with outcome=pending for later human feedback.
    if source_type in EXTRACTION_FEEDBACK_SOURCES and isinstance(source_reference, dict):
        source_reference = {
            **source_reference,
            "outcome": source_reference.get("outcome") or "pending",
        }

    if existing is None and not allow_create:
        return None, False

    if existing:
        # Prefer under-merge: fold surface forms into aliases even when value is kept.
        existing.aliases = merge_alias_list(
            existing.aliases,
            resolved_label,
            key,
            normalized_key.replace("_", " "),
        )

        incoming_trust = _source_trust(source_type)
        existing_trust = _source_trust(existing.source_type)
        protected = (
            existing.status == "validated"
            and not replace_validated
            and source_type in {"extraction", "model_candidate"}
        ) or (
            not replace_validated
            and incoming_trust < existing_trust
            and existing.status in {"validated", "extracted", "assumed"}
            and not _value_is_missing(existing.value)
        )
        if protected:
            existing.used_in_assessments = sorted(set(existing.used_in_assessments or []) | set(assessments))
            existing.updated_at = now
            return existing, False

        existing.label = resolved_label or existing.label
        # Never rewrite the canonical key on a fuzzy/alias merge.
        existing.value = normalized_value
        existing.unit = unit if unit is not None else (existing.unit or (definition.unit if definition else None))
        existing.value_type = value_type or existing.value_type or (definition.value_type if definition else infer_assumption_value_type(normalized_value))
        existing.source_type = source_type
        existing.source_reference = source_reference
        existing.status = normalized_status
        existing.used_in_assessments = sorted(set(existing.used_in_assessments or []) | set(assessments))
        existing.notes = notes if notes is not None else existing.notes
        existing.last_updated_by_user_id = _actor_user_id(actor)
        existing.last_updated_by_email = _actor_email(actor)
        existing.updated_at = now
        return existing, False

    assumption = Assumption(
        project_id=project_id,
        key=definition.key if definition else normalized_key,
        label=resolved_label,
        value=normalized_value,
        unit=unit if unit is not None else (definition.unit if definition else None),
        value_type=value_type or (definition.value_type if definition else infer_assumption_value_type(normalized_value)),
        source_type=source_type,
        source_reference=source_reference,
        aliases=merge_alias_list(None, resolved_label, key),
        status=normalized_status,
        used_in_assessments=assessments,
        created_by_user_id=_actor_user_id(actor),
        created_by_email=_actor_email(actor),
        last_updated_by_user_id=_actor_user_id(actor),
        last_updated_by_email=_actor_email(actor),
        notes=notes,
    )
    db.add(assumption)
    await db.flush()
    return assumption, True


async def update_assumption(
    db: AsyncSession,
    assumption: Assumption,
    updates: dict[str, Any],
    *,
    actor: AssumptionActor,
) -> Assumption:
    if "value" in updates:
        updates["value"] = normalize_missing_value(updates.get("value"))
    if "status" in updates:
        updates["status"] = normalize_assumption_status(updates.get("status"))
    if "value" in updates or "status" in updates:
        effective_value = updates.get("value", assumption.value)
        if _value_is_missing(effective_value):
            updates["value"] = None
            if "status" not in updates or updates.get("status") != "missing":
                updates["status"] = "missing"

    value_changed = "value" in updates and updates.get("value") != assumption.value
    status_changed = "status" in updates and updates.get("status") != assumption.status
    if (
        (value_changed or status_changed)
        and assumption.source_type in EXTRACTION_FEEDBACK_SOURCES
    ):
        updates["source_reference"] = _stamp_outcome(
            updates.get("source_reference", assumption.source_reference),
            "edited",
        )

    for field in (
        "label",
        "value",
        "unit",
        "value_type",
        "source_type",
        "source_reference",
        "status",
        "used_in_assessments",
        "notes",
        "aliases",
    ):
        if field in updates:
            setattr(assumption, field, updates[field])
    assumption.last_updated_by_user_id = actor.user_id
    assumption.last_updated_by_email = actor.email
    assumption.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return assumption


async def delete_assumption(
    db: AsyncSession,
    assumption: Assumption,
) -> None:
    # Light feedback: stamp before hard delete so logs still see the last state if needed.
    if assumption.source_type in EXTRACTION_FEEDBACK_SOURCES:
        assumption.source_reference = _stamp_outcome(assumption.source_reference, "deleted")
        await db.flush()
    await db.delete(assumption)
    await db.flush()


async def ensure_expected_assumptions(
    db: AsyncSession,
    initiative: Project,
    *,
    assessment_ids: list[str] | None = None,
    actor: AssumptionActor | None = None,
) -> tuple[int, list[Assumption]]:
    # Config is guidance for extraction/prompting only. We intentionally do not
    # enforce static missing placeholders from config "required" fields.
    _ = (db, initiative, assessment_ids, actor)
    return 0, []


def apply_assumptions_to_items(
    items: list[dict[str, Any]],
    assumptions: list[dict[str, Any]],
    *,
    assessment_id: str,
) -> list[dict[str, Any]]:
    by_key = {
        normalize_assumption_key(a.get("key", "")): a
        for a in assumptions
        if normalize_assumption_status(a.get("status")) in {"validated", "extracted", "assumed"}
    }
    for assumption in assumptions:
        if normalize_assumption_status(assumption.get("status")) not in {"validated", "extracted", "assumed"}:
            continue
        definition = _definition_for_key(str(assumption.get("key") or ""))
        if definition is None:
            continue
        for alias in definition.assessment_field_keys.get(assessment_id, []):
            by_key[normalize_assumption_key(alias)] = assumption
    for item in items:
        content = item.get("content") if isinstance(item, dict) else None
        if not isinstance(content, dict):
            continue
        field_name = normalize_assumption_key(
            str(content.get("field_name") or content.get("name") or content.get("variable") or "")
        )
        assumption = by_key.get(field_name)
        if assumption is None:
            continue
        if assessment_id not in (assumption.get("used_in_assessments") or []):
            definition = _definition_for_assessment_field(field_name, assessment_id)
            if definition is None or assessment_id not in definition.used_in_assessments:
                continue
        content["value"] = assumption.get("value")
        if assumption.get("unit") and not content.get("unit"):
            content["unit"] = assumption.get("unit")
        normalized_status = normalize_assumption_status(assumption.get("status"))
        content["status"] = normalized_status if normalized_status in {"validated", "extracted", "assumed"} else "assumed"
        content["source"] = "assumption"
        content["assumption_id"] = assumption.get("id")
        content["source_reference"] = assumption.get("source_reference")
        content["rationale"] = f"Prefilled from project variable: {assumption.get('label')}"
    return items


def _base_assessment_name(assessment_id: str) -> str:
    definition = get_assessment_registry().get_assessment(assessment_id)
    if definition is not None:
        return definition.definition.name
    return assessment_id.replace("_", " ").strip() or "Assessment"


def _assessment_display_name_from_instance(assessment_instance: Any, assessment_id: str) -> str:
    """Human-readable, instance-specific label for an assessment-sourced assumption.

    Mirrors the "<Assessment name> #<instance_number>" convention used elsewhere
    (see `_resolve_assessment_name` / `_serialize_assessment_instance` in
    `app/api/projects.py`) so the Variables source column can point at the exact
    assessment run rather than the generic word "assessment".
    """
    base_name = _base_assessment_name(assessment_id)
    title = getattr(assessment_instance, "title", None)
    custom_title = title.strip() if isinstance(title, str) and title.strip() else None
    instance_number = getattr(assessment_instance, "instance_number", None)
    if custom_title:
        return custom_title
    if instance_number:
        return f"{base_name} #{instance_number}"
    return base_name


async def _resolve_assessment_display_name(
    db: AsyncSession,
    assessment_id: str,
    assessment_instance_id: UUID | None,
) -> str:
    base_name = _base_assessment_name(assessment_id)
    if assessment_instance_id is None:
        return base_name
    inst = await db.get(AssessmentInstance, assessment_instance_id)
    if inst is None:
        return base_name
    return _assessment_display_name_from_instance(inst, assessment_id)


async def sync_stage_assumptions(
    db: AsyncSession,
    *,
    project_id: UUID,
    assessment_id: str,
    assessment_instance_id: UUID | None = None,
    stage_id: str,
    stage_data: dict[str, Any] | None,
    actor: AssumptionActor,
    status: str = "assumed",
) -> tuple[list[Assumption], dict[str, str]]:
    if not stage_data:
        return [], {}
    items = stage_data.get("items") if isinstance(stage_data, dict) else None
    if not isinstance(items, list):
        return [], {}
    touched: list[Assumption] = []
    item_assumption_map: dict[str, str] = {}
    assessment_name: str | None = None
    for item in items:
        content = item.get("content") if isinstance(item, dict) else None
        if not isinstance(content, dict):
            continue
        # Only sync explicit assumption inputs. Free-form list rows (e.g. landscape
        # entities with just "name"/"category") should not become assumptions.
        raw_field_name = str(content.get("field_name") or "").strip()
        if not raw_field_name:
            continue
        field_key = normalize_assumption_key(raw_field_name)
        if not field_key:
            continue
        definition = _definition_for_assessment_field(field_key, assessment_id)
        # Keep assessment-driven assumption sync scoped to configured variables
        # that are actually mapped for this assessment.
        if definition is None:
            continue
        value = normalize_missing_value(content.get("value"))
        value_is_missing = value is None
        effective_status = normalize_assumption_status(
            content.get("status"),
            default=("missing" if value_is_missing else status),
        )
        label = definition.label
        key = definition.key
        value_type = definition.value_type
        if assessment_name is None:
            assessment_name = await _resolve_assessment_display_name(db, assessment_id, assessment_instance_id)
        assumption, _created = await upsert_assumption(
            db,
            project_id=project_id,
            key=key,
            value=value,
            label=label,
            unit=content.get("unit") or definition.unit,
            value_type=value_type,
            source_type="assessment",
            source_reference={
                "assessment_id": assessment_id,
                "assessment_name": assessment_name,
                "stage_id": stage_id,
                "field_name": field_key,
                "variable": content.get("variable"),
            },
            status=effective_status,
            used_in_assessments=[assessment_id],
            actor=actor,
            replace_validated=True,
            allow_create=False,
        )
        if assumption is None:
            continue
        binding = await upsert_assumption_binding(
            db,
            project_id=project_id,
            assumption_id=assumption.id,
            assessment_id=assessment_id,
            assessment_instance_id=assessment_instance_id,
            stage_id=stage_id,
            field_name=field_key,
            field_label=label,
            unit=content.get("unit") or definition.unit,
            value_type=value_type,
            metadata={"variable": content.get("variable")},
        )
        content["assumption_id"] = str(assumption.id)
        item_id = str(item.get("id") or "")
        if item_id:
            item_assumption_map[item_id] = str(binding.assumption_id)
        touched.append(assumption)
    return touched, item_assumption_map


async def sync_widget_assumptions(
    db: AsyncSession,
    *,
    project_id: UUID,
    assessment_id: str,
    assessment_instance_id: UUID | None = None,
    widget_data: dict[str, Any],
    actor: AssumptionActor,
) -> tuple[list[Assumption], dict[str, str]]:
    inputs = widget_data.get("inputs") if isinstance(widget_data, dict) else None
    if not isinstance(inputs, dict):
        return []
    stage_data = {"items": []}
    for key, raw in inputs.items():
        if isinstance(raw, dict):
            value = raw.get("value")
            unit = raw.get("unit")
            variable = raw.get("label") or key
            item_status = raw.get("status")
        else:
            value = raw
            unit = None
            variable = key
            item_status = None
        stage_data["items"].append(
            {
                "content": {
                    "field_name": key,
                    "variable": variable,
                    "value": value,
                    "unit": unit,
                    "status": item_status,
                }
            }
        )
    return await sync_stage_assumptions(
        db,
        project_id=project_id,
        assessment_id=assessment_id,
        assessment_instance_id=assessment_instance_id,
        stage_id="widget_state",
        stage_data=stage_data,
        actor=actor,
        status="validated",
    )


async def upsert_assumption_binding(
    db: AsyncSession,
    *,
    project_id: UUID,
    assumption_id: UUID,
    assessment_id: str,
    assessment_instance_id: UUID | None,
    stage_id: str | None,
    field_name: str,
    field_label: str | None = None,
    unit: str | None = None,
    value_type: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> AssumptionBinding:
    stmt = select(AssumptionBinding).where(
        AssumptionBinding.project_id == project_id,
        AssumptionBinding.assessment_id == assessment_id,
        AssumptionBinding.field_name == normalize_assumption_key(field_name),
        AssumptionBinding.stage_id == stage_id,
        AssumptionBinding.assessment_instance_id == assessment_instance_id,
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()
    now = datetime.now(timezone.utc)

    if existing:
        existing.assumption_id = assumption_id
        existing.field_label = field_label
        existing.unit = unit
        existing.value_type = value_type
        existing.binding_metadata = metadata
        existing.updated_at = now
        return existing

    binding = AssumptionBinding(
        project_id=project_id,
        assumption_id=assumption_id,
        assessment_id=assessment_id,
        assessment_instance_id=assessment_instance_id,
        stage_id=stage_id,
        field_name=normalize_assumption_key(field_name),
        field_label=field_label,
        unit=unit,
        value_type=value_type,
        binding_metadata=metadata,
    )
    db.add(binding)
    await db.flush()
    return binding


async def resolve_assumption_for_assessment_field(
    db: AsyncSession,
    *,
    project_id: UUID,
    assessment_id: str,
    field_name: str,
    assessment_instance_id: UUID | None = None,
) -> Assumption | None:
    normalized_field = normalize_assumption_key(field_name)
    if not normalized_field:
        return None

    binding_stmt = (
        select(AssumptionBinding)
        .where(
            AssumptionBinding.project_id == project_id,
            AssumptionBinding.assessment_id == assessment_id,
            AssumptionBinding.field_name == normalized_field,
        )
        .order_by(AssumptionBinding.updated_at.desc(), AssumptionBinding.created_at.desc())
    )
    bindings = list((await db.execute(binding_stmt)).scalars().all())
    if assessment_instance_id:
        preferred = next(
            (binding for binding in bindings if binding.assessment_instance_id == assessment_instance_id),
            None,
        )
        if preferred is not None:
            assumption = await get_assumption(db, preferred.assumption_id)
            if assumption and assumption.project_id == project_id:
                return assumption
    if bindings:
        assumption = await get_assumption(db, bindings[0].assumption_id)
        if assumption and assumption.project_id == project_id:
            return assumption

    definition = _definition_for_assessment_field(normalized_field, assessment_id)
    assumption_key = definition.key if definition else normalized_field
    stmt = (
        select(Assumption)
        .where(
            Assumption.project_id == project_id,
            Assumption.key == assumption_key,
            Assumption.status != "rejected",
        )
        .order_by(Assumption.updated_at.desc())
        .limit(1)
    )
    assumption = (await db.execute(stmt)).scalar_one_or_none()
    if assumption is not None:
        assumption.status = normalize_assumption_status(assumption.status, default="assumed")
    return assumption


async def build_summary(db: AsyncSession, project_id: UUID) -> dict[str, Any]:
    rows = await list_assumptions(db, project_id)
    active_rows = [row for row in rows if normalize_assumption_status(row.status) in ACTIVE_STATUSES]
    status_counts = {"validated": 0, "extracted": 0, "assumed": 0, "missing": 0}
    for row in active_rows:
        normalized = normalize_assumption_status(row.status, default="assumed")
        if normalized in status_counts:
            status_counts[normalized] += 1
    top_attention = [
        row
        for row in active_rows
        if normalize_assumption_status(row.status) in ATTENTION_STATUSES
    ][:5]
    return {
        "total": len(active_rows),
        "validated": status_counts["validated"],
        "extracted": status_counts["extracted"],
        "assumed": status_counts["assumed"],
        "missing": status_counts["missing"],
        "top_attention": [
            {
                "id": row.id,
                "key": row.key,
                "label": row.label,
                "status": normalize_assumption_status(row.status, default="assumed"),
                "used_in_assessments": row.used_in_assessments or [],
            }
            for row in top_attention
        ],
    }


def format_assumptions_for_prompt(assumptions: list[Assumption]) -> str:
    active = [row for row in assumptions if normalize_assumption_status(row.status) in ACTIVE_STATUSES]
    if not active:
        return ""
    buckets: dict[str, list[str]] = {"validated": [], "extracted": [], "assumed": [], "missing": []}
    for row in active[:MAX_PROMPT_ASSUMPTIONS]:
        normalized_status = normalize_assumption_status(row.status, default="assumed")
        value = "missing" if normalized_status == "missing" else row.value
        unit = f" {row.unit}" if row.unit else ""
        assessments = f" ({', '.join(row.used_in_assessments or [])})" if row.used_in_assessments else ""
        buckets[normalized_status].append(f"- {row.label}: {value}{unit}{assessments}")
    parts = ["Project variables:"]
    for status, lines in buckets.items():
        if lines:
            parts.append(f"{status.replace('_', ' ').title()}:\n" + "\n".join(lines))
    return "\n".join(parts)


async def format_assumptions_for_initiative_prompt(db: AsyncSession, project_id: UUID) -> str:
    rows = await list_assumptions(db, project_id)
    return format_assumptions_for_prompt(rows)


async def assumptions_as_context(db: AsyncSession, project_id: UUID) -> list[dict[str, Any]]:
    rows = await list_assumptions(db, project_id)
    return [
        {
            "id": str(row.id),
            "key": row.key,
            "label": row.label,
            "value": row.value,
            "unit": row.unit,
            "value_type": row.value_type,
            "source_type": row.source_type,
            "source_reference": row.source_reference,
            "status": normalize_assumption_status(row.status, default="assumed"),
            "used_in_assessments": row.used_in_assessments or [],
        }
        for row in rows
        if normalize_assumption_status(row.status) in ACTIVE_STATUSES
    ]


async def _load_extraction_text(db: AsyncSession, project_id: UUID) -> tuple[str, list[dict[str, Any]]]:
    """Load project text for extraction, preferring relevance when embeddings are available."""
    source_refs: list[dict[str, Any]] = []
    chunks: list[str] = []

    # Prefer RAG over evidence when possible; fall back to recency dump.
    try:
        from app.services.rag import RAGService

        rag = RAGService(db)
        retrieved = await rag.retrieve(
            query=(
                "project assumptions inputs parameters CAPEX OPEX capacity discount rate "
                "system size location costs financials"
            ),
            project_id=project_id,
            sources=["evidence"],
            evidence_top_k=12,
        )
        for item in retrieved:
            source_refs.append(
                {
                    "source_type": "evidence",
                    "id": str(item.source_doc_id),
                    "chunk_id": str(item.chunk_id),
                    "title": item.source_title,
                    "similarity": item.similarity,
                }
            )
            chunks.append(
                f"[evidence:{item.source_doc_id}:{item.chunk_index}]\n{(item.content or '')[:1200]}"
            )
    except Exception as exc:  # noqa: BLE001
        logger.info("Assumption extraction RAG unavailable, using recency fallback: %s", exc)

    if not chunks:
        evidence_result = await db.execute(
            select(EvidenceDoc)
            .where(EvidenceDoc.project_id == project_id, EvidenceDoc.storage_path.isnot(None))
            .order_by(EvidenceDoc.created_at.desc())
            .limit(6)
        )
        evidence_docs = evidence_result.scalars().all()
        evidence_ids = [doc.id for doc in evidence_docs]
        if evidence_ids:
            chunk_result = await db.execute(
                select(EvidenceChunk)
                .where(EvidenceChunk.evidence_doc_id.in_(evidence_ids))
                .order_by(EvidenceChunk.evidence_doc_id, EvidenceChunk.chunk_index)
                .limit(18)
            )
            for chunk in chunk_result.scalars().all():
                source_refs.append(
                    {"source_type": "evidence", "id": str(chunk.evidence_doc_id), "chunk_id": str(chunk.id)}
                )
                chunks.append(f"[evidence:{chunk.evidence_doc_id}:{chunk.chunk_index}]\n{chunk.content[:1200]}")

    material_result = await db.execute(
        select(ProjectMaterial)
        .where(ProjectMaterial.project_id == project_id)
        .order_by(ProjectMaterial.created_at.desc())
        .limit(8)
    )
    for material in material_result.scalars().all():
        if not material.content_text:
            continue
        source_refs.append({"source_type": "material", "id": str(material.id), "title": material.filename})
        chunks.append(f"[material:{material.id}] {material.filename}\n{material.content_text[:2200]}")

    return "\n\n".join(chunks)[:MAX_EXTRACTION_CHARS], source_refs


async def extract_assumptions_from_sources(
    db: AsyncSession,
    initiative: Project,
    *,
    actor: AssumptionActor,
    assessment_ids: list[str] | None = None,
) -> tuple[int, int, list[Assumption]]:
    """Open-vocabulary extraction from project materials/evidence with quote grounding."""
    assessments = assessment_ids or _assessment_ids_from_initiative(initiative)
    # Config is hints for the model + calculator binding seeds — not an allowlist.
    definitions = expected_assumptions_for_assessments(assessments)
    text, source_refs = await _load_extraction_text(db, initiative.id)
    touched: list[Assumption] = []
    created_count = 0
    updated_count = 0
    if not text.strip():
        return created_count, updated_count, touched

    schema_lines = [
        {
            "key": d.key,
            "label": d.label,
            "value_type": d.value_type,
            "unit": d.unit,
            "aliases": d.aliases,
            "examples": d.examples,
        }
        for d in definitions
    ]
    system_prompt = (
        "Extract reusable project variables from project materials. "
        "Be conservative but open-vocabulary: you may extract parameters that are NOT in the "
        "known-keys list when the text states a concrete project value "
        "(for example a comparable-project NPV, custom metric, or bespoke cost).\n\n"
        "Include an assumption only when the source quote states a concrete value. "
        "Do NOT extract mere entities, organizations, policies, technologies, headings, themes, or concept lists.\n\n"
        "Return JSON with an 'assumptions' array. Each item must include:\n"
        "- key (snake_case)\n"
        "- label (human-readable)\n"
        "- value\n"
        "- optional unit\n"
        "- optional value_type (number|percent|currency|string|boolean|text)\n"
        "- source_quote (verbatim evidence for that value)\n"
        "- status ('validated' for direct explicit statements, otherwise 'extracted')."
    )
    user_prompt = (
        "Known assumption keys (prefer these keys when they match; you may also invent new keys):\n"
        f"{json.dumps(schema_lines, indent=2)}\n\n"
        "Project materials:\n"
        f"{text}"
    )
    try:
        response = await acompletion(
            actor.user_id,
            db,
            role=ModelRole.GENERATION,
            complexity=Complexity.STANDARD,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0,
        )
        payload = json.loads(response.choices[0].message.content or "{}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Assumption extraction failed: %s", exc, exc_info=True)
        payload = {}

    for raw in payload.get("assumptions", []):
        if not isinstance(raw, dict):
            continue
        key = normalize_assumption_key(str(raw.get("key") or raw.get("label") or ""))
        if not key:
            continue
        definition = _definition_for_key(key)
        value = raw.get("value")
        if value in (None, ""):
            continue
        value_type = raw.get("value_type") or (definition.value_type if definition else infer_assumption_value_type(value))
        if not _passes_extraction_quality_gate(raw, value_type=value_type, definition=definition):
            continue
        # Require the quote to actually appear in retrieved text (grounding).
        quote = str(raw.get("source_quote") or "").strip()
        if quote and quote not in text and quote[:80] not in text:
            # Soft check: allow minor whitespace differences
            collapsed_quote = re.sub(r"\s+", " ", quote).lower()
            collapsed_text = re.sub(r"\s+", " ", text).lower()
            if collapsed_quote not in collapsed_text and collapsed_quote[:60] not in collapsed_text:
                continue
        assumption, created = await upsert_assumption(
            db,
            project_id=initiative.id,
            key=definition.key if definition else key,
            value=value,
            label=str(raw.get("label") or (definition.label if definition else key.replace("_", " ").title())),
            unit=raw.get("unit") or (definition.unit if definition else None),
            value_type=value_type,
            source_type="extraction",
            source_reference={
                "sources": source_refs[:8],
                "quote": raw.get("source_quote"),
                "extracted_at": datetime.now(timezone.utc).isoformat(),
                "outcome": "pending",
            },
            status="extracted",
            used_in_assessments=definition.used_in_assessments if definition else [],
            actor=actor if actor.email else AssumptionActor.system(),
            allow_create=True,
        )
        if assumption is None:
            continue
        touched.append(assumption)
        if created:
            created_count += 1
        else:
            updated_count += 1
    return created_count, updated_count, touched


async def extract_assumptions_from_assessment(
    db: AsyncSession,
    project: Project,
    *,
    assessment_instance,
    actor: AssumptionActor,
) -> list[Assumption]:
    """Promote confirmed assessment inputs into the shared assumption pool on final approval."""
    if assessment_instance is None or not hasattr(assessment_instance, "workflow_state"):
        return []

    state = assessment_instance.workflow_state if isinstance(assessment_instance.workflow_state, dict) else {}
    stages = state.get("stages") if isinstance(state.get("stages"), dict) else {}
    approved_at = datetime.now(timezone.utc).isoformat()
    touched: list[Assumption] = []
    assessment_id = getattr(assessment_instance, "assessment_id", None) or ""
    assessment_name = _assessment_display_name_from_instance(assessment_instance, assessment_id)

    for stage_id, stage_data in stages.items():
        if not isinstance(stage_data, dict):
            continue
        items = stage_data.get("items")
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            content = item.get("content") if isinstance(item.get("content"), dict) else None
            if not isinstance(content, dict):
                continue
            # Same gate as sync_stage_assumptions: only explicit field_name rows.
            field_name = str(content.get("field_name") or "").strip()
            value = content.get("value")
            if not field_name or value in (None, ""):
                continue
            definition = _definition_for_assessment_field(field_name, assessment_id)
            key = definition.key if definition else normalize_assumption_key(field_name)
            label = str(content.get("variable") or content.get("label") or field_name)
            assumption, _ = await upsert_assumption(
                db,
                project_id=project.id,
                key=key,
                value=value,
                label=label,
                unit=content.get("unit") or (definition.unit if definition else None),
                value_type=definition.value_type if definition else infer_assumption_value_type(value),
                source_type="assessment_approval",
                source_reference={
                    "assessment_instance_id": str(assessment_instance.id),
                    "assessment_id": assessment_id,
                    "assessment_name": assessment_name,
                    "stage_id": stage_id,
                    "field_name": field_name,
                    "quote": str(content.get("rationale") or "")[:500] or None,
                    "approved_at": approved_at,
                    "outcome": "pending",
                },
                status="validated",
                used_in_assessments=definition.used_in_assessments if definition else [assessment_id],
                actor=actor,
                allow_create=True,
                replace_validated=True,
            )
            if assumption is not None:
                touched.append(assumption)

    # Calculator assessments persist under workflow_state.widget_state.inputs.
    top_widget = state.get("widget_state")
    if isinstance(top_widget, dict):
        inputs = top_widget.get("inputs")
        if not isinstance(inputs, dict):
            nested = top_widget.get("widget_data")
            inputs = nested.get("inputs") if isinstance(nested, dict) else None
        if isinstance(inputs, dict):
            for field_name, raw_value in inputs.items():
                if isinstance(raw_value, dict) and "value" in raw_value:
                    value = raw_value.get("value")
                    unit = raw_value.get("unit")
                    label = raw_value.get("label") or raw_value.get("variable") or field_name
                else:
                    value = raw_value
                    unit = None
                    label = field_name
                if value in (None, "", [], {}) or not isinstance(value, (str, int, float, bool)):
                    continue
                definition = _definition_for_assessment_field(str(field_name), assessment_id)
                key = definition.key if definition else normalize_assumption_key(str(field_name))
                assumption, _ = await upsert_assumption(
                    db,
                    project_id=project.id,
                    key=key,
                    value=value,
                    label=str(label),
                    unit=unit or (definition.unit if definition else None),
                    value_type=definition.value_type if definition else infer_assumption_value_type(value),
                    source_type="assessment_approval",
                    source_reference={
                        "assessment_instance_id": str(assessment_instance.id),
                        "assessment_id": assessment_id,
                        "assessment_name": assessment_name,
                        "field_name": field_name,
                        "approved_at": approved_at,
                        "outcome": "pending",
                    },
                    status="validated",
                    used_in_assessments=definition.used_in_assessments if definition else [assessment_id],
                    actor=actor,
                    allow_create=True,
                    replace_validated=True,
                )
                if assumption is not None:
                    touched.append(assumption)

    return touched


async def promote_chat_value_to_assumption(
    db: AsyncSession,
    project: Project,
    *,
    key: str,
    value: Any,
    label: str | None = None,
    unit: str | None = None,
    value_type: str | None = None,
    chat_id: UUID | None = None,
    chat_message_id: UUID | None = None,
    quote: str | None = None,
    actor: AssumptionActor,
) -> Assumption | None:
    """Scaffold: promote a user-approved chat value into the shared assumption pool."""
    normalized_key = normalize_assumption_key(key)
    if not normalized_key:
        return None
    definition = _definition_for_key(normalized_key)
    assumption, _ = await upsert_assumption(
        db,
        project_id=project.id,
        key=definition.key if definition else normalized_key,
        value=value,
        label=label or (definition.label if definition else normalized_key.replace("_", " ").title()),
        unit=unit if unit is not None else (definition.unit if definition else None),
        value_type=value_type or (definition.value_type if definition else infer_assumption_value_type(value)),
        source_type="chat_approval",
        source_reference={
            "chat_id": str(chat_id) if chat_id else None,
            "chat_message_id": str(chat_message_id) if chat_message_id else None,
            "quote": quote,
            "approved_at": datetime.now(timezone.utc).isoformat(),
            "outcome": "pending",
        },
        status="validated",
        used_in_assessments=definition.used_in_assessments if definition else [],
        actor=actor,
        allow_create=True,
        replace_validated=True,
    )
    return assumption
