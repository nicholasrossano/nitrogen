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
    expected_assumptions_for_modules,
)
from app.config import get_settings
from app.core.llm_client import get_openai_client, record_usage_from_response
from app.models.assumption import Assumption, AssumptionComment
from app.models.evidence import EvidenceChunk, EvidenceDoc
from app.models.initiative import Initiative
from app.models.project_material import ProjectMaterial

logger = logging.getLogger(__name__)
settings = get_settings()

ATTENTION_STATUSES = {"missing", "needs_review"}
ACTIVE_STATUSES = {"confirmed", "needs_review", "missing"}
SYSTEM_ACTOR = "system"
MAX_PROMPT_ASSUMPTIONS = 12
MAX_EXTRACTION_CHARS = 14000


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


def _definition_for_module_field(field_key: str, module_id: str) -> AssumptionDefinition | None:
    normalized = normalize_assumption_key(field_key)
    exact = _definition_for_key(normalized)
    if exact and module_id in exact.used_in_modules:
        return exact
    for definition in ASSUMPTION_BY_KEY.values():
        aliases = {
            normalize_assumption_key(alias)
            for alias in definition.module_field_keys.get(module_id, [])
        }
        if normalized in aliases:
            return definition
    return None


def _module_ids_from_initiative(initiative: Initiative) -> list[str]:
    modules: set[str] = set(initiative.selected_tools or [])
    for inst in initiative.module_instances or []:
        if not getattr(inst, "archived", False):
            modules.add(inst.module_id)
    return sorted(modules)


def _coerce_modules(modules: list[str] | None, definition: AssumptionDefinition | None) -> list[str]:
    values = set(modules or [])
    if definition:
        values.update(definition.used_in_modules)
    return sorted(values)


def _actor_email(actor: AssumptionActor | None) -> str | None:
    return actor.email if actor and actor.email else None


def _actor_user_id(actor: AssumptionActor | None) -> str | None:
    return actor.user_id if actor and actor.user_id else None


async def list_assumptions(
    db: AsyncSession,
    initiative_id: UUID,
    *,
    status: str | None = None,
    source_type: str | None = None,
    module: str | None = None,
) -> list[Assumption]:
    stmt = select(Assumption).where(Assumption.initiative_id == initiative_id)
    if status:
        stmt = stmt.where(Assumption.status == status)
    if source_type:
        stmt = stmt.where(Assumption.source_type == source_type)
    stmt = stmt.order_by(Assumption.updated_at.desc(), Assumption.created_at.desc())
    result = await db.execute(stmt)
    rows = list(result.scalars().all())
    if module:
        rows = [row for row in rows if module in (row.used_in_modules or [])]
    return rows


async def get_assumption(db: AsyncSession, assumption_id: UUID) -> Assumption | None:
    return await db.get(Assumption, assumption_id)


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
    status: str = "needs_review",
    used_in_modules: list[str] | None = None,
    actor: AssumptionActor | None = None,
    notes: str | None = None,
    replace_confirmed: bool = False,
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
    modules = _coerce_modules(used_in_modules, definition)
    now = datetime.now(timezone.utc)

    if existing:
        if existing.status == "confirmed" and not replace_confirmed and source_type in {"extraction", "model_candidate"}:
            existing.used_in_modules = sorted(set(existing.used_in_modules or []) | set(modules))
            existing.updated_at = now
            return existing, False
        existing.label = label or existing.label or (definition.label if definition else normalized_key.replace("_", " ").title())
        existing.value = value
        existing.unit = unit if unit is not None else (existing.unit or (definition.unit if definition else None))
        existing.value_type = value_type or existing.value_type or (definition.value_type if definition else "string")
        existing.source_type = source_type
        existing.source_reference = source_reference
        existing.status = status
        existing.used_in_modules = sorted(set(existing.used_in_modules or []) | set(modules))
        existing.notes = notes if notes is not None else existing.notes
        existing.last_updated_by_user_id = _actor_user_id(actor)
        existing.last_updated_by_email = _actor_email(actor)
        existing.updated_at = now
        return existing, False

    assumption = Assumption(
        initiative_id=initiative_id,
        key=normalized_key,
        label=label or (definition.label if definition else normalized_key.replace("_", " ").title()),
        value=value,
        unit=unit if unit is not None else (definition.unit if definition else None),
        value_type=value_type or (definition.value_type if definition else "string"),
        source_type=source_type,
        source_reference=source_reference,
        status=status,
        used_in_modules=modules,
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
    for field in (
        "label",
        "value",
        "unit",
        "value_type",
        "source_type",
        "source_reference",
        "status",
        "used_in_modules",
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
    module_ids: list[str] | None = None,
    actor: AssumptionActor | None = None,
) -> tuple[int, list[Assumption]]:
    modules = module_ids or _module_ids_from_initiative(initiative)
    definitions = expected_assumptions_for_modules(modules)
    touched: list[Assumption] = []
    created_count = 0
    for definition in definitions:
        required = bool(set(modules).intersection(definition.required_for_modules))
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
            source_reference={"required_for_modules": sorted(set(definition.required_for_modules).intersection(modules))},
            status="missing",
            used_in_modules=definition.used_in_modules,
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
    module_id: str,
) -> list[dict[str, Any]]:
    by_key = {
        normalize_assumption_key(a.get("key", "")): a
        for a in assumptions
        if a.get("status") in {"confirmed", "needs_review"}
    }
    for assumption in assumptions:
        if assumption.get("status") not in {"confirmed", "needs_review"}:
            continue
        definition = _definition_for_key(str(assumption.get("key") or ""))
        if definition is None:
            continue
        for alias in definition.module_field_keys.get(module_id, []):
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
        if module_id not in (assumption.get("used_in_modules") or []):
            definition = _definition_for_module_field(field_name, module_id)
            if definition is None or module_id not in definition.used_in_modules:
                continue
        content["value"] = assumption.get("value")
        if assumption.get("unit") and not content.get("unit"):
            content["unit"] = assumption.get("unit")
        content["status"] = "confirmed" if assumption.get("status") == "confirmed" else "needs_review"
        content["source"] = "assumption"
        content["assumption_id"] = assumption.get("id")
        content["source_reference"] = assumption.get("source_reference")
        content["rationale"] = f"Prefilled from project assumption: {assumption.get('label')}"
    return items


async def sync_stage_assumptions(
    db: AsyncSession,
    *,
    initiative_id: UUID,
    module_id: str,
    stage_id: str,
    stage_data: dict[str, Any] | None,
    actor: AssumptionActor,
    status: str = "confirmed",
) -> list[Assumption]:
    if not stage_data:
        return []
    items = stage_data.get("items") if isinstance(stage_data, dict) else None
    if not isinstance(items, list):
        return []
    touched: list[Assumption] = []
    for item in items:
        content = item.get("content") if isinstance(item, dict) else None
        if not isinstance(content, dict):
            continue
        field_key = normalize_assumption_key(str(content.get("field_name") or ""))
        definition = _definition_for_module_field(field_key, module_id)
        if definition is None or module_id not in definition.used_in_modules:
            continue
        value = content.get("value")
        if value in (None, ""):
            continue
        assumption, _created = await upsert_assumption(
            db,
            initiative_id=initiative_id,
            key=definition.key,
            value=value,
            label=definition.label,
            unit=content.get("unit") or definition.unit,
            value_type=definition.value_type,
            source_type="module",
            source_reference={
                "module_id": module_id,
                "stage_id": stage_id,
                "field_name": field_key,
                "variable": content.get("variable"),
            },
            status=status,
            used_in_modules=[module_id],
            actor=actor,
            replace_confirmed=True,
        )
        touched.append(assumption)
    return touched


async def sync_widget_assumptions(
    db: AsyncSession,
    *,
    initiative_id: UUID,
    module_id: str,
    widget_data: dict[str, Any],
    actor: AssumptionActor,
) -> list[Assumption]:
    inputs = widget_data.get("inputs") if isinstance(widget_data, dict) else None
    if not isinstance(inputs, dict):
        return []
    stage_data = {"items": []}
    for key, raw in inputs.items():
        if isinstance(raw, dict):
            value = raw.get("value")
            unit = raw.get("unit")
            variable = raw.get("label") or key
        else:
            value = raw
            unit = None
            variable = key
        stage_data["items"].append(
            {"content": {"field_name": key, "variable": variable, "value": value, "unit": unit}}
        )
    return await sync_stage_assumptions(
        db,
        initiative_id=initiative_id,
        module_id=module_id,
        stage_id="widget_state",
        stage_data=stage_data,
        actor=actor,
        status="confirmed",
    )


async def build_summary(db: AsyncSession, initiative_id: UUID) -> dict[str, Any]:
    rows = await list_assumptions(db, initiative_id)
    active_rows = [row for row in rows if row.status != "rejected"]
    top_attention = [
        row
        for row in active_rows
        if row.status in ATTENTION_STATUSES
    ][:5]
    return {
        "total": len(active_rows),
        "confirmed": sum(1 for row in active_rows if row.status == "confirmed"),
        "needs_review": sum(1 for row in active_rows if row.status == "needs_review"),
        "missing": sum(1 for row in active_rows if row.status == "missing"),
        "top_attention": [
            {
                "id": row.id,
                "key": row.key,
                "label": row.label,
                "status": row.status,
                "used_in_modules": row.used_in_modules or [],
            }
            for row in top_attention
        ],
    }


def format_assumptions_for_prompt(assumptions: list[Assumption]) -> str:
    active = [row for row in assumptions if row.status in ACTIVE_STATUSES]
    if not active:
        return ""
    buckets: dict[str, list[str]] = {"confirmed": [], "needs_review": [], "missing": []}
    for row in active[:MAX_PROMPT_ASSUMPTIONS]:
        value = "missing" if row.status == "missing" else row.value
        unit = f" {row.unit}" if row.unit else ""
        modules = f" ({', '.join(row.used_in_modules or [])})" if row.used_in_modules else ""
        buckets[row.status].append(f"- {row.label}: {value}{unit}{modules}")
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
            "status": row.status,
            "used_in_modules": row.used_in_modules or [],
        }
        for row in rows
        if row.status != "rejected"
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
    module_ids: list[str] | None = None,
) -> tuple[int, int, list[Assumption]]:
    modules = module_ids or _module_ids_from_initiative(initiative)
    definitions = expected_assumptions_for_modules(modules)
    text, source_refs = await _load_extraction_text(db, initiative.id)
    touched: list[Assumption] = []
    created_count, placeholders = await ensure_expected_assumptions(
        db,
        initiative,
        module_ids=modules,
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
        "Use status 'needs_review' unless the text is unquestionably direct."
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
            status="needs_review",
            used_in_modules=definition.used_in_modules,
            actor=actor if actor.email else AssumptionActor.system(),
        )
        touched.append(assumption)
        if created:
            created_count += 1
        else:
            updated_count += 1
    return created_count, updated_count, touched
