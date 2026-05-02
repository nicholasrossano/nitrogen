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

from app.assumptions.config import (
    ASSUMPTION_BY_KEY,
    AssumptionDefinition,
    expected_assumptions_for_assessments,
)
from app.config import get_settings
from app.core.llm_client import get_openai_client, record_usage_from_response
from app.models.assumption import Assumption, AssumptionBinding, AssumptionComment
from app.models.evidence import EvidenceChunk, EvidenceDoc
from app.models.initiative import Initiative
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


def _assessment_ids_from_initiative(initiative: Initiative) -> list[str]:
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
    initiative_id: UUID,
    *,
    status: str | None = None,
    source_type: str | None = None,
    assessment: str | None = None,
) -> list[Assumption]:
    normalized_status_filter = normalize_assumption_status(status, default="")
    stmt = select(Assumption).where(
        Assumption.initiative_id == initiative_id,
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
        initiative_id=assumption.initiative_id,
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
    initiative_id: UUID,
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
) -> tuple[Assumption, bool]:
    normalized_key = normalize_assumption_key(key)
    definition = _definition_for_key(normalized_key)
    result = await db.execute(
        select(Assumption)
        .where(
            Assumption.initiative_id == initiative_id,
            Assumption.key == normalized_key,
            Assumption.status != "rejected",
        )
        .order_by(Assumption.updated_at.desc())
        .limit(1)
    )
    existing = result.scalar_one_or_none()
    assessments = _coerce_assessments(used_in_assessments, definition)
    normalized_value = normalize_missing_value(value)
    normalized_status = normalize_assumption_status(status)
    if normalized_value is None and normalized_status != "missing":
        normalized_status = "missing"
    now = datetime.now(timezone.utc)

    if existing:
        if existing.status == "validated" and not replace_validated and source_type in {"extraction", "model_candidate"}:
            existing.used_in_assessments = sorted(set(existing.used_in_assessments or []) | set(assessments))
            existing.updated_at = now
            return existing, False
        existing.label = label or existing.label or (definition.label if definition else normalized_key.replace("_", " ").title())
        existing.value = normalized_value
        existing.unit = unit if unit is not None else (existing.unit or (definition.unit if definition else None))
        existing.value_type = value_type or existing.value_type or (definition.value_type if definition else "string")
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
        initiative_id=initiative_id,
        key=normalized_key,
        label=label or (definition.label if definition else normalized_key.replace("_", " ").title()),
        value=normalized_value,
        unit=unit if unit is not None else (definition.unit if definition else None),
        value_type=value_type or (definition.value_type if definition else "string"),
        source_type=source_type,
        source_reference=source_reference,
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
    ):
        if field in updates:
            setattr(assumption, field, updates[field])
    assumption.last_updated_by_user_id = actor.user_id
    assumption.last_updated_by_email = actor.email
    assumption.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return assumption


async def ensure_expected_assumptions(
    db: AsyncSession,
    initiative: Initiative,
    *,
    assessment_ids: list[str] | None = None,
    actor: AssumptionActor | None = None,
) -> tuple[int, list[Assumption]]:
    assessments = assessment_ids or _assessment_ids_from_initiative(initiative)
    definitions = expected_assumptions_for_assessments(assessments)
    touched: list[Assumption] = []
    created_count = 0
    for definition in definitions:
        required = bool(set(assessments).intersection(definition.required_for_assessments))
        if not required:
            continue
        assumption, created = await upsert_assumption(
            db,
            initiative_id=initiative.id,
            key=definition.key,
            value=None,
            label=definition.label,
            unit=definition.unit,
            value_type=definition.value_type,
            source_type="missing_placeholder",
            source_reference={"required_for_assessments": sorted(set(definition.required_for_assessments).intersection(assessments))},
            status="missing",
            used_in_assessments=definition.used_in_assessments,
            actor=actor or AssumptionActor.system(),
        )
        touched.append(assumption)
        if created:
            created_count += 1
    return created_count, touched


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
        content["rationale"] = f"Prefilled from project assumption: {assumption.get('label')}"
    return items


async def sync_stage_assumptions(
    db: AsyncSession,
    *,
    initiative_id: UUID,
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
    for item in items:
        content = item.get("content") if isinstance(item, dict) else None
        if not isinstance(content, dict):
            continue
        field_key = normalize_assumption_key(str(content.get("field_name") or content.get("name") or ""))
        if not field_key:
            continue
        definition = _definition_for_assessment_field(field_key, assessment_id)
        value = normalize_missing_value(content.get("value"))
        value_is_missing = value is None
        effective_status = normalize_assumption_status(
            content.get("status"),
            default=("missing" if value_is_missing else status),
        )
        label = (
            definition.label
            if definition is not None
            else str(content.get("variable") or content.get("label") or content.get("name") or field_key.replace("_", " ").title())
        )
        key = definition.key if definition is not None else field_key
        value_type = definition.value_type if definition is not None else infer_assumption_value_type(value)
        assumption, _created = await upsert_assumption(
            db,
            initiative_id=initiative_id,
            key=key,
            value=value,
            label=label,
            unit=content.get("unit") or (definition.unit if definition else None),
            value_type=value_type,
            source_type="assessment",
            source_reference={
                "assessment_id": assessment_id,
                "stage_id": stage_id,
                "field_name": field_key,
                "variable": content.get("variable"),
            },
            status=effective_status,
            used_in_assessments=[assessment_id],
            actor=actor,
            replace_validated=True,
        )
        binding = await upsert_assumption_binding(
            db,
            initiative_id=initiative_id,
            assumption_id=assumption.id,
            assessment_id=assessment_id,
            assessment_instance_id=assessment_instance_id,
            stage_id=stage_id,
            field_name=field_key,
            field_label=label,
            unit=content.get("unit") or (definition.unit if definition else None),
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
    initiative_id: UUID,
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
        initiative_id=initiative_id,
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
    initiative_id: UUID,
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
        AssumptionBinding.initiative_id == initiative_id,
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
        initiative_id=initiative_id,
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
    initiative_id: UUID,
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
            AssumptionBinding.initiative_id == initiative_id,
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
            if assumption and assumption.initiative_id == initiative_id:
                return assumption
    if bindings:
        assumption = await get_assumption(db, bindings[0].assumption_id)
        if assumption and assumption.initiative_id == initiative_id:
            return assumption

    definition = _definition_for_assessment_field(normalized_field, assessment_id)
    assumption_key = definition.key if definition else normalized_field
    stmt = (
        select(Assumption)
        .where(
            Assumption.initiative_id == initiative_id,
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


async def build_summary(db: AsyncSession, initiative_id: UUID) -> dict[str, Any]:
    rows = await list_assumptions(db, initiative_id)
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
    parts = ["Project assumptions:"]
    for status, lines in buckets.items():
        if lines:
            parts.append(f"{status.replace('_', ' ').title()}:\n" + "\n".join(lines))
    return "\n".join(parts)


async def format_assumptions_for_initiative_prompt(db: AsyncSession, initiative_id: UUID) -> str:
    rows = await list_assumptions(db, initiative_id)
    return format_assumptions_for_prompt(rows)


async def assumptions_as_context(db: AsyncSession, initiative_id: UUID) -> list[dict[str, Any]]:
    rows = await list_assumptions(db, initiative_id)
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


async def _load_extraction_text(db: AsyncSession, initiative_id: UUID) -> tuple[str, list[dict[str, Any]]]:
    source_refs: list[dict[str, Any]] = []
    chunks: list[str] = []
    material_result = await db.execute(
        select(ProjectMaterial)
        .where(ProjectMaterial.initiative_id == initiative_id)
        .order_by(ProjectMaterial.created_at.desc())
        .limit(8)
    )
    for material in material_result.scalars().all():
        if not material.content_text:
            continue
        source_refs.append({"source_type": "material", "id": str(material.id), "title": material.filename})
        chunks.append(f"[material:{material.id}] {material.filename}\n{material.content_text[:2200]}")

    evidence_result = await db.execute(
        select(EvidenceDoc)
        .where(EvidenceDoc.initiative_id == initiative_id, EvidenceDoc.storage_path.isnot(None))
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
            source_refs.append({"source_type": "evidence", "id": str(chunk.evidence_doc_id), "chunk_id": str(chunk.id)})
            chunks.append(f"[evidence:{chunk.evidence_doc_id}:{chunk.chunk_index}]\n{chunk.content[:1200]}")
    return "\n\n".join(chunks)[:MAX_EXTRACTION_CHARS], source_refs


async def extract_assumptions_from_sources(
    db: AsyncSession,
    initiative: Initiative,
    *,
    actor: AssumptionActor,
    assessment_ids: list[str] | None = None,
) -> tuple[int, int, list[Assumption]]:
    assessments = assessment_ids or _assessment_ids_from_initiative(initiative)
    definitions = expected_assumptions_for_assessments(assessments)
    text, source_refs = await _load_extraction_text(db, initiative.id)
    touched: list[Assumption] = []
    created_count, placeholders = await ensure_expected_assumptions(
        db,
        initiative,
        assessment_ids=assessments,
        actor=AssumptionActor.system(),
    )
    touched.extend(placeholders)
    updated_count = 0
    if not text.strip() or not definitions:
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
        "Extract only explicit reusable project assumptions from project materials. "
        "Be conservative. Return JSON with an 'assumptions' array. "
        "Each item must have key, value, optional unit, source_quote, and status. "
        "Use status 'extracted' unless the text is unquestionably direct."
    )
    user_prompt = (
        "Expected assumption config:\n"
        f"{json.dumps(schema_lines, indent=2)}\n\n"
        "Project materials:\n"
        f"{text}"
    )
    try:
        client, is_byok = await get_openai_client(actor.user_id, db)
        response = await client.chat.completions.create(
            model=settings.openai_generation_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0,
        )
        await record_usage_from_response(
            actor.user_id or "",
            settings.openai_generation_model,
            response,
            db,
            is_byok=is_byok,
        )
        payload = json.loads(response.choices[0].message.content or "{}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Assumption extraction failed: %s", exc, exc_info=True)
        payload = {}

    for raw in payload.get("assumptions", []):
        if not isinstance(raw, dict):
            continue
        key = normalize_assumption_key(str(raw.get("key") or ""))
        definition = _definition_for_key(key)
        if definition is None:
            continue
        value = raw.get("value")
        if value in (None, ""):
            continue
        assumption, created = await upsert_assumption(
            db,
            initiative_id=initiative.id,
            key=key,
            value=value,
            label=definition.label,
            unit=raw.get("unit") or definition.unit,
            value_type=definition.value_type,
            source_type="extraction",
            source_reference={
                "sources": source_refs[:8],
                "quote": raw.get("source_quote"),
                "extracted_at": datetime.now(timezone.utc).isoformat(),
            },
            status="extracted",
            used_in_assessments=definition.used_in_assessments,
            actor=actor if actor.email else AssumptionActor.system(),
        )
        touched.append(assumption)
        if created:
            created_count += 1
        else:
            updated_count += 1
    return created_count, updated_count, touched
