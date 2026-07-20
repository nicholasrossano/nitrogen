from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.assessments.utils import llm_json
from app.core.database import AsyncSessionLocal
from app.domain.registry import get_default_status_categories
from app.models.variable import Variable
from app.models.evidence import EvidenceDoc, EvidenceDocStatus
from app.models.project import Project
from app.models.project_material import ProjectMaterial
from app.models.project_status import (
    ProjectStatusAssessmentHistory,
    ProjectStatusCategory,
    ProjectStatusOverride,
    ProjectStatusResult,
)
from app.services.tiered_retrieval import RetrievedFact, TieredRetrievalService

logger = logging.getLogger(__name__)

# Coalesce bursty uploads/indexing/approvals into one LLM status pass per project.
_STATUS_REFRESH_DEBOUNCE_SECONDS = 4.0
_pending_status_refresh_handles: dict[str, asyncio.TimerHandle] = {}
_pending_status_refresh_meta: dict[str, dict[str, str | None]] = {}

VALID_STATUSES = {"green", "yellow", "red", "unknown"}
VALID_CONFIDENCE = {"high", "medium", "low", "unknown"}
STATUS_ORDER = {"unknown": 0, "red": 1, "yellow": 2, "green": 3}
STALE_ANALYSIS_WINDOW = timedelta(days=21)
# Status assessment should see enough project material to credit what exists —
# thin retrieval biases the LLM toward "not found" / absence findings.
MAX_RETRIEVED_CONTEXT_ITEMS = 16
# Cap inventory rows so a huge library stays prompt-safe while still listing every filename.
MAX_FILE_INVENTORY_ITEMS = 120


@dataclass(frozen=True)
class StatusCategoryConfig:
    category_key: str
    label: str
    definition_text: str
    criteria: dict[str, Any] | None = None


def _clamp_status(value: str, fallback: str = "unknown") -> str:
    return value if value in VALID_STATUSES else fallback


def _clamp_confidence(value: str, fallback: str = "unknown") -> str:
    return value if value in VALID_CONFIDENCE else fallback


def _status_not_higher(status: str, max_status: str) -> str:
    return status if STATUS_ORDER[status] <= STATUS_ORDER[max_status] else max_status


def _truncate_list(values: Any, *, max_items: int = 6) -> list[str]:
    if not isinstance(values, list):
        return []
    normalized: list[str] = []
    for value in values:
        if isinstance(value, str) and value.strip():
            normalized.append(value.strip())
    return normalized[:max_items]


def _clip_text(value: Any, *, max_chars: int = 360) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"


def _slugify_category_key(label: str, *, fallback: str = "category") -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    return (slug[:100] or fallback)


def _category_from_row(row: ProjectStatusCategory) -> StatusCategoryConfig:
    return StatusCategoryConfig(
        category_key=row.category_key,
        label=row.label,
        definition_text=row.definition_text or "",
        criteria=row.criteria if isinstance(row.criteria, dict) else None,
    )


def _payload_excerpt(payload: Any, *, max_chars: int = 360) -> str | None:
    preferred_keys = (
        "summary",
        "executive_summary",
        "conclusion",
        "recommendation",
        "assessment",
        "analysis",
        "risk_summary",
        "implementation_summary",
    )
    if isinstance(payload, dict):
        for key in preferred_keys:
            excerpt = _clip_text(payload.get(key), max_chars=max_chars)
            if excerpt:
                return excerpt
        collected: list[str] = []
        for key, value in payload.items():
            if key.startswith("_"):
                continue
            if isinstance(value, str):
                clipped = _clip_text(value, max_chars=140)
                if clipped:
                    collected.append(f"{key}: {clipped}")
            if len(collected) >= 3:
                break
        return _clip_text("; ".join(collected), max_chars=max_chars)
    if isinstance(payload, list):
        collected = [_clip_text(item, max_chars=120) for item in payload[:3]]
        return _clip_text("; ".join(item for item in collected if item), max_chars=max_chars)
    return _clip_text(payload, max_chars=max_chars)


def _humanize_assessment_id(assessment_id: str) -> str:
    cleaned = assessment_id.replace("_", " ").strip()
    return " ".join(part.capitalize() for part in cleaned.split())


def _fact_to_status_source(fact: RetrievedFact) -> dict[str, Any]:
    return {
        "content": _clip_text(fact.content, max_chars=650),
        "source_type": fact.source_type.value,
        "source_title": fact.source_title,
        "source_url": fact.source_url,
        "chunk_id": fact.chunk_id,
        "confidence": fact.confidence,
        "publisher": fact.publisher,
        "evidence_doc_id": fact.evidence_doc_id,
        "chunk_index": fact.chunk_index,
        "citation": fact.to_citation_string(),
    }


def _dedupe_facts(facts: list[RetrievedFact]) -> list[RetrievedFact]:
    seen: set[tuple[str | None, str, str]] = set()
    deduped: list[RetrievedFact] = []
    for fact in sorted(facts, key=lambda item: item.confidence, reverse=True):
        key = (fact.chunk_id, fact.source_title, fact.content[:160])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(fact)
    return deduped


def _retrieval_queries_for_category(category: StatusCategoryConfig) -> list[str]:
    if category.criteria and isinstance(category.criteria.get("retrieval_focus"), list):
        focus = [str(item).strip() for item in category.criteria["retrieval_focus"] if str(item).strip()]
        if focus:
            return [" ".join(focus[:6]), f"{category.label} {' '.join(focus[:4])}"]
    summary = ""
    if category.criteria and isinstance(category.criteria.get("summary"), str):
        summary = category.criteria["summary"].strip()
    base = " ".join(part for part in [category.label, category.definition_text, summary] if part).strip()
    return [base[:500] or category.label]


async def _retrieve_category_context(
    db: AsyncSession,
    project: Project,
    category: StatusCategoryConfig,
    *,
    user_id: str | None = None,
) -> dict[str, Any]:
    retriever = TieredRetrievalService(db, user_id=user_id)
    queries = _retrieval_queries_for_category(category)

    # Real embedding/vector search over indexed EvidenceDoc chunks — the same pipeline
    # used for chat citations — is the primary source, since interactively uploaded files
    # are indexed there, not in ProjectMaterial (which is mostly legacy/report-export text).
    facts: list[RetrievedFact] = []
    for query in queries[:2]:
        facts.extend(await retriever.search_evidence(query, project.id, evidence_top_k=5))

    # Keyword fallback over ProjectMaterial content_text (legacy uploads, published
    # assessment report exports) only when vector search comes up thin.
    if len(facts) < 4:
        for query in queries[:2]:
            facts.extend(await retriever.search_project_materials(query, project.id, max_results=3))

    if len(facts) < 4 and project.workspace_id:
        facts.extend(
            await retriever.search_workspace_context(
                queries[0],
                project.workspace_id,
                user_id=user_id,
                workspace_top_k=3,
                knowledge_top_k=3,
            )
        )

    top_facts = _dedupe_facts(facts)
    existing_titles = {fact.source_title.strip().lower() for fact in top_facts if fact.source_title}
    material_rows = await db.execute(
        select(ProjectMaterial.filename, ProjectMaterial.content_text)
        .where(ProjectMaterial.project_id == project.id)
        .order_by(ProjectMaterial.created_at.desc())
        .limit(4)
    )
    material_facts: list[dict[str, Any]] = []
    for filename, content_text in material_rows.all():
        title = str(filename or "").strip()
        if not title or title.lower() in existing_titles:
            continue
        excerpt = _clip_text(content_text, max_chars=280) or "Project material uploaded for this project."
        material_facts.append(
            {
                "content": excerpt,
                "source_type": "project_material",
                "source_title": title,
                "source_url": None,
                "chunk_id": None,
                "confidence": 0.35,
                "publisher": None,
                "evidence_doc_id": None,
                "chunk_index": None,
                "citation": f"[Project Material: {title}]",
            }
        )
        if len(material_facts) >= 2:
            break

    # Prefer relevance-ranked retrieval over unranked recent-material padding.
    combined_sources = [_fact_to_status_source(fact) for fact in top_facts] + material_facts
    deduped_sources: list[dict[str, Any]] = []
    seen_source_keys: set[tuple[str, str, str]] = set()
    for source in combined_sources:
        key = (
            str(source.get("source_type") or "").strip().lower(),
            str(source.get("source_title") or "").strip().lower(),
            str(source.get("content") or "")[:120].strip().lower(),
        )
        if key in seen_source_keys:
            continue
        seen_source_keys.add(key)
        deduped_sources.append(source)
        if len(deduped_sources) >= MAX_RETRIEVED_CONTEXT_ITEMS:
            break

    return {"queries": queries[:2], "facts": deduped_sources, "retrieved_count": len(deduped_sources)}


def _sanitize_rationale_text(value: str) -> str:
    """Strip internal prompt/schema jargon from user-facing status prose."""
    if not value:
        return value
    text = value
    replacements = (
        ("secondary_structured_state", "project signals"),
        ("Secondary_structured_state", "Project signals"),
        ("retrieved_project_context", "retrieved project materials"),
        ("Retrieved_project_context", "Retrieved project materials"),
        ("status_constraints", "project checks"),
        ("Status_constraints", "Project checks"),
        ("file_inventory", "project file list"),
        ("File_inventory", "Project file list"),
        ("inventory_truncated", "additional files"),
        ("forced_status", "required status"),
        ("max_status", "status ceiling"),
        ("blocker_flags", "project checks"),
        ("red_flags", "risk flags"),
        ("guardrails", "project checks"),
        ("Guardrails", "Project checks"),
        ("capped at yellow", "currently held at yellow"),
    )
    for old, new in replacements:
        text = text.replace(old, new)
    return text


def _sanitize_finding_list(values: Any, *, max_items: int = 6) -> list[str]:
    return _truncate_list(
        [_sanitize_rationale_text(item) for item in (values if isinstance(values, list) else [])],
        max_items=max_items,
    )


def _extract_risk_counts(payload: Any) -> tuple[int, int]:
    high_severity = 0
    unresolved = 0

    def _walk(node: Any) -> None:
        nonlocal high_severity, unresolved
        if isinstance(node, dict):
            severity = str(node.get("severity") or node.get("risk_level") or "").lower()
            status = str(node.get("status") or "").lower()
            mitigated = node.get("mitigated")
            resolved = node.get("resolved")
            if severity in {"high", "critical", "severe"}:
                high_severity += 1
                if status not in {"resolved", "closed", "mitigated"} and not bool(mitigated) and not bool(resolved):
                    unresolved += 1
            for value in node.values():
                _walk(value)
            return
        if isinstance(node, list):
            for item in node:
                _walk(item)

    _walk(payload)
    return high_severity, unresolved


async def _collect_status_signal_context(db: AsyncSession, project: Project) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    stale_before = now - STALE_ANALYSIS_WINDOW

    assessment_instances = [i for i in (project.assessment_instances or []) if not getattr(i, "archived", False)]
    completed_instances = [i for i in assessment_instances if i.is_plan_complete]
    error_instances = [i for i in assessment_instances if str(i.status).lower() in {"error", "failed"}]
    stale_instances = [i for i in completed_instances if i.updated_at and i.updated_at < stale_before]
    assessment_by_id: dict[str, dict[str, int]] = {}
    completed_output_excerpts: list[dict[str, str]] = []
    for instance in assessment_instances:
        assessment_id = str(instance.assessment_id or "").strip()
        if not assessment_id:
            continue
        bucket = assessment_by_id.setdefault(
            assessment_id,
            {"total": 0, "completed": 0, "errors": 0, "stale_completed": 0},
        )
        bucket["total"] += 1
        if instance.is_plan_complete:
            bucket["completed"] += 1
            if instance.updated_at and instance.updated_at < stale_before:
                bucket["stale_completed"] += 1
        if str(instance.status).lower() in {"error", "failed"}:
            bucket["errors"] += 1
        if instance.is_plan_complete and len(completed_output_excerpts) < 8:
            excerpt = _payload_excerpt(instance.deliverable)
            if excerpt:
                display_name = (
                    instance.title.strip()
                    if isinstance(instance.title, str) and instance.title.strip()
                    else f"{_humanize_assessment_id(assessment_id)} #{instance.instance_number}"
                )
                completed_output_excerpts.append(
                    {
                        "instance_id": str(instance.id),
                        "assessment_id": assessment_id,
                        "display_name": display_name,
                        "title": instance.title or assessment_id.replace("_", " "),
                        "excerpt": excerpt,
                    }
                )

    variables_result = await db.execute(
        select(
            func.count(Variable.id),
            func.sum(case((Variable.status == "validated", 1), else_=0)),
            func.sum(case((Variable.status == "extracted", 1), else_=0)),
            func.sum(case((Variable.status == "assumed", 1), else_=0)),
            func.sum(case((Variable.status == "missing", 1), else_=0)),
        ).where(Variable.project_id == project.id)
    )
    variable_counts = variables_result.one()
    variables_total = int(variable_counts[0] or 0)
    variables_validated = int(variable_counts[1] or 0)
    variables_extracted = int(variable_counts[2] or 0)
    variables_assumed = int(variable_counts[3] or 0)
    variables_missing = int(variable_counts[4] or 0)

    variables_rows = await db.execute(
        select(Variable.label, Variable.status, Variable.value, Variable.notes)
        .where(Variable.project_id == project.id)
        .order_by(Variable.updated_at.desc())
        .limit(14)
    )
    variable_examples = [
        {
            "label": label,
            "status": status,
            "value": _clip_text(value, max_chars=120),
            "notes": _clip_text(notes, max_chars=120),
        }
        for label, status, value, notes in variables_rows.all()
    ]

    evidence_result = await db.execute(
        select(
            func.count(EvidenceDoc.id),
            func.sum(case((EvidenceDoc.processing_status == EvidenceDocStatus.INDEXED.value, 1), else_=0)),
            func.sum(case((EvidenceDoc.processing_status == EvidenceDocStatus.FAILED.value, 1), else_=0)),
        ).where(EvidenceDoc.project_id == project.id)
    )
    evidence_counts = evidence_result.one()
    evidence_total = int(evidence_counts[0] or 0)
    evidence_indexed = int(evidence_counts[1] or 0)
    evidence_failed = int(evidence_counts[2] or 0)

    evidence_rows = await db.execute(
        select(
            EvidenceDoc.filename,
            EvidenceDoc.file_type,
            EvidenceDoc.processing_status,
            EvidenceDoc.preview_text,
        )
        .where(EvidenceDoc.project_id == project.id)
        .order_by(EvidenceDoc.filename.asc())
        .limit(MAX_FILE_INVENTORY_ITEMS)
    )
    # Holistic awareness: full filename inventory (not just recent samples). Short previews
    # only for the first few so the prompt stays lean; ranked RAG supplies depth.
    file_inventory: list[dict[str, Any]] = []
    evidence_examples: list[dict[str, Any]] = []
    for index, (filename, file_type, status, preview) in enumerate(evidence_rows.all()):
        title = str(filename or "").strip()
        if not title:
            continue
        entry = {
            "filename": title,
            "file_type": file_type,
            "status": status,
            "source": "evidence",
        }
        file_inventory.append(entry)
        if index < 8:
            evidence_examples.append(
                {
                    "filename": title,
                    "status": status,
                    "preview": _clip_text(preview, max_chars=180),
                }
            )

    materials_result = await db.execute(
        select(func.count(ProjectMaterial.id)).where(ProjectMaterial.project_id == project.id)
    )
    materials_total = int(materials_result.scalar_one() or 0)

    material_rows = await db.execute(
        select(ProjectMaterial.filename, ProjectMaterial.file_type, ProjectMaterial.content_text)
        .where(ProjectMaterial.project_id == project.id)
        .order_by(ProjectMaterial.filename.asc())
        .limit(MAX_FILE_INVENTORY_ITEMS)
    )
    material_examples: list[dict[str, Any]] = []
    existing_inventory_names = {item["filename"].lower() for item in file_inventory}
    for index, (filename, file_type, content_text) in enumerate(material_rows.all()):
        title = str(filename or "").strip()
        if not title:
            continue
        if title.lower() not in existing_inventory_names:
            file_inventory.append(
                {
                    "filename": title,
                    "file_type": file_type,
                    "status": "available",
                    "source": "material",
                }
            )
            existing_inventory_names.add(title.lower())
        if index < 6:
            material_examples.append(
                {
                    "filename": title,
                    "file_type": file_type,
                    "excerpt": _clip_text(content_text, max_chars=200),
                }
            )

    fields_present = {
        "title": bool(project.title),
        "geography": bool(project.geography),
        "project_type": bool(project.project_type),
        "goal": bool(project.goal),
        "timeline": bool(project.timeline),
        "budget_range": bool(project.budget_range),
    }

    high_risk_total = 0
    unresolved_high_risk_total = 0
    for instance in assessment_instances:
        if instance.assessment_id != "risk_assessment":
            continue
        deliverable = instance.deliverable or {}
        high_count, unresolved_count = _extract_risk_counts(deliverable)
        high_risk_total += high_count
        unresolved_high_risk_total += unresolved_count

    plan_payload = project.project_plan or {}
    plan_items_total = 0
    plan_items_complete = 0
    for pillar in plan_payload.get("pillars", []):
        for item in pillar.get("items", []):
            plan_items_total += 1
            if item.get("status") == "complete":
                plan_items_complete += 1

    context = {
        "stage": project.stage,
        "project_profile": {
            "title": project.title,
            "geography": project.geography,
            "project_type": project.project_type,
            "goal": _clip_text(project.goal, max_chars=260),
            "timeline": project.timeline,
            "budget_range": project.budget_range,
            "description": _clip_text(project.project_description, max_chars=420),
            "overview": _clip_text(project.overview_description, max_chars=420),
        },
        "assessment": {
            "total": len(assessment_instances),
            "completed": len(completed_instances),
            "errors": len(error_instances),
            "stale_completed": len(stale_instances),
            "by_assessment_id": assessment_by_id,
            "completed_output_excerpts": completed_output_excerpts,
        },
        "variables": {
            "total": variables_total,
            "validated": variables_validated,
            "extracted": variables_extracted,
            "assumed": variables_assumed,
            "missing": variables_missing,
            "examples": variable_examples,
        },
        "evidence": {
            "total": evidence_total,
            "indexed": evidence_indexed,
            "failed": evidence_failed,
            "materials": materials_total,
            # Full project file list (filenames) so the model knows what exists holistically.
            "file_inventory": file_inventory,
            "inventory_count": len(file_inventory),
            "inventory_truncated": (evidence_total + materials_total) > len(file_inventory),
            "documents": evidence_examples,
            "materials_examples": material_examples,
        },
        "project_fields": fields_present,
        "risk": {
            "high_or_critical": high_risk_total,
            "unresolved_high_or_critical": unresolved_high_risk_total,
        },
        "project_plan": {
            "items_total": plan_items_total,
            "items_complete": plan_items_complete,
        },
    }

    fingerprint = hashlib.sha256(json.dumps(context, sort_keys=True).encode("utf-8")).hexdigest()
    return {"context": context, "fingerprint": fingerprint}


def _guardrails_for_category(context: dict[str, Any]) -> dict[str, Any]:
    assessment_ctx = context["assessment"]
    evidence = context["evidence"]
    risk = context["risk"]

    # Keep guardrails narrow. Do NOT globally cap green for ordinary diligence gaps
    # (e.g. a few missing variables) — that made every category "yellow / medium"
    # even on well-documented projects.
    blocker_flags: list[str] = []
    red_flags: list[str] = []
    if evidence["indexed"] == 0 and evidence["materials"] == 0 and evidence["total"] == 0:
        blocker_flags.append("core_claims_unsupported")
    if assessment_ctx["errors"] > 0:
        red_flags.append("failed_or_invalid_module_output")
    if risk["unresolved_high_or_critical"] > 0:
        red_flags.append("severe_unresolved_risk")
    if evidence["failed"] > 0 and evidence["indexed"] == 0:
        red_flags.append("required_document_processing_failed")

    has_signal = any(
        [
            assessment_ctx["total"] > 0,
            context["variables"]["total"] > 0,
            evidence["total"] > 0,
            evidence["materials"] > 0,
        ]
    )

    max_status = "green"
    forced_status: str | None = None
    if not has_signal:
        forced_status = "unknown"
    elif red_flags:
        forced_status = "red"
    elif blocker_flags:
        max_status = "yellow"

    return {
        "has_signal": has_signal,
        "blocker_flags": blocker_flags,
        "red_flags": red_flags,
        "max_status": max_status,
        "forced_status": forced_status,
    }


def _fallback_category_result(
    category: StatusCategoryConfig,
    guardrails: dict[str, Any],
) -> dict[str, Any]:
    status = guardrails["forced_status"] or guardrails["max_status"]
    if not guardrails["has_signal"]:
        rationale = f"Not enough project evidence is available yet to assess {category.label.lower()}."
    elif status == "red":
        rationale = f"Material unresolved blockers currently weaken {category.label.lower()}."
    elif status == "yellow":
        rationale = (
            f"The project appears plausible, but unresolved variables or planning gaps limit "
            f"{category.label.lower()}."
        )
    else:
        rationale = (
            f"The available project evidence appears coherent enough to support "
            f"{category.label.lower()} at this stage."
        )
    flag_labels = {
        "core_claims_unsupported": "Core claims are not yet backed by uploaded materials",
        "failed_or_invalid_module_output": "One or more assessment modules failed and need re-running",
        "severe_unresolved_risk": "High-severity risks remain unresolved",
        "required_document_processing_failed": "Some uploaded documents failed processing and need re-upload",
    }
    blockers = [flag_labels.get(flag, flag) for flag in guardrails["red_flags"]]
    missing_items = [flag_labels.get(flag, flag) for flag in guardrails["blocker_flags"]]
    return {
        "status": status,
        "confidence": "medium" if status != "unknown" else "unknown",
        "rationale": rationale,
        "positive_drivers": [],
        "negative_drivers": [],
        "blockers": blockers,
        "missing_items": missing_items,
        "relevant_modules": [],
        "improvement_actions": [],
        "uncertainties": [],
        "supporting_signals": {},
    }


def _project_context_for_generation(project: Project) -> dict[str, Any]:
    return {
        "title": project.title,
        "geography": project.geography,
        "project_type": project.project_type,
        "goal": _clip_text(project.goal, max_chars=260),
        "stage": project.stage,
        "description": _clip_text(project.project_description, max_chars=420),
    }


async def generate_status_category_criteria(
    *,
    label: str,
    definition_text: str,
    project_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Derive the backend evaluation lens from a category definition (not user-edited)."""
    user_msg = json.dumps(
        {
            "label": label,
            "definition_text": definition_text,
            "project_context": project_context or {},
            "required_response_schema": {
                "summary": (
                    "short tooltip blurb (max ~120 characters) of what this category checks; "
                    "plain language; do not copy the full definition"
                ),
                "criteria": [
                    {
                        "id": "c1",
                        "text": "criterion text",
                        "type": "qualitative|indicator|metric",
                        "metric_hint": "optional, only when user supplied numbers",
                    }
                ],
                "retrieval_focus": ["themes to search project materials for"],
                "parse_warnings": ["optional warnings when definition is thin"],
            },
        }
    )
    system = (
        "You generate an internal evaluation lens for one project status category. Return strict JSON only. "
        "summary must be a short info-tooltip line (about 8–18 words, under 120 characters) that captures "
        "what this category is checking — not a restatement of the full definition and not criteria text. "
        "If the definition is vague, use interpretive license to flesh out a credible, project-appropriate "
        "lens for this category — generative themes, not literal extraction only. "
        "If the definition is detailed, preserve the user's specifics as a skeleton; organize lightly; "
        "do not pad with extra invented requirements. "
        "Enrich qualitative meaning freely, but do NOT fabricate specific numeric thresholds, ROI, IRR, "
        "or financial targets unless the user supplied actual numbers. "
        "Default criterion type to qualitative; use indicator for directional checks the user implied; "
        "use metric only when the user supplied numbers. "
        "Always produce at least two criteria when possible. "
        "Criteria are a reasoning scaffold for backend assessment, not a pass/fail checklist."
    )
    result = await llm_json(system=system, user_msg=user_msg)
    if not isinstance(result, dict):
        return {
            "summary": _short_definition_summary(definition_text, label),
            "criteria": [{"id": "c1", "text": definition_text or label, "type": "qualitative"}],
            "retrieval_focus": [label],
            "parse_warnings": ["Criteria generation fallback used."],
        }
    criteria_items = result.get("criteria") if isinstance(result.get("criteria"), list) else []
    normalized_criteria: list[dict[str, str]] = []
    for index, item in enumerate(criteria_items[:8], start=1):
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        criterion_type = str(item.get("type") or "qualitative").lower()
        if criterion_type not in {"qualitative", "indicator", "metric"}:
            criterion_type = "qualitative"
        normalized: dict[str, str] = {
            "id": str(item.get("id") or f"c{index}"),
            "text": text,
            "type": criterion_type,
        }
        metric_hint = item.get("metric_hint")
        if isinstance(metric_hint, str) and metric_hint.strip():
            normalized["metric_hint"] = metric_hint.strip()
        normalized_criteria.append(normalized)
    if not normalized_criteria:
        normalized_criteria = [{"id": "c1", "text": definition_text or label, "type": "qualitative"}]
    summary = str(result.get("summary") or "").strip()
    if not summary:
        summary = _short_definition_summary(definition_text, label)
    else:
        summary = _clip_text(summary, max_chars=140) or summary
    return {
        "summary": summary,
        "criteria": normalized_criteria,
        "retrieval_focus": _truncate_list(result.get("retrieval_focus"), max_items=8) or [label],
        "parse_warnings": _truncate_list(result.get("parse_warnings"), max_items=4),
    }


def _short_definition_summary(definition_text: str, label: str) -> str:
    clipped = _clip_text(definition_text, max_chars=120)
    return clipped or label


def _category_needs_evaluation_lens(row: ProjectStatusCategory) -> bool:
    """True when the backend lens (incl. short info summary) is missing or too long."""
    if not isinstance(row.criteria, dict) or not row.criteria:
        return True
    summary = str(row.criteria.get("summary") or "").strip()
    if not summary:
        return True
    if len(summary) > 160:
        return True
    definition = (row.definition_text or "").strip()
    if definition and summary == definition:
        return True
    if definition and len(definition) > 80 and len(summary) >= int(0.85 * len(definition)):
        return True
    return False


async def ensure_category_criteria(
    db: AsyncSession,
    project: Project,
    categories: list[ProjectStatusCategory],
) -> bool:
    """Ensure each category has a backend evaluation lens. Returns True if any were generated."""
    project_context = _project_context_for_generation(project)
    generated_any = False
    for row in categories:
        if not _category_needs_evaluation_lens(row):
            continue
        row.criteria = await generate_status_category_criteria(
            label=row.label,
            definition_text=row.definition_text,
            project_context=project_context,
        )
        generated_any = True
    if generated_any:
        await db.flush()
    return generated_any


async def _llm_category_result(
    context: dict[str, Any],
    defaults: Any,
    category: StatusCategoryConfig,
    guardrails: dict[str, Any],
    retrieved_context: dict[str, Any],
) -> dict[str, Any]:
    success_definition: dict[str, Any] = {"definition_text": category.definition_text}
    if category.criteria:
        success_definition["criteria"] = category.criteria
    user_msg = json.dumps(
        {
            "domain": defaults.domain,
            "stage": context["stage"],
            "stage_expectation": defaults.stage_expectations.get(context["stage"], ""),
            "category": {
                "category_key": category.category_key,
                "label": category.label,
                "success_definition": success_definition,
            },
            "retrieved_project_context": retrieved_context,
            "secondary_structured_state": context,
            "status_constraints": {
                "max_status": guardrails["max_status"],
                "forced_status": guardrails["forced_status"],
                "blocker_flags": guardrails["blocker_flags"],
                "red_flags": guardrails["red_flags"],
            },
            "required_response_schema": {
                "status": "green|yellow|red|unknown",
                "confidence": "high|medium|low|unknown",
                "critical_insight": "one concise decision-relevant judgment sentence",
                "rationale": "one concise sentence explaining why the judgment matters",
                "supporting_evidence": [
                    "short prose finding that affirms this category, e.g. 'Quarterly progress reports document ongoing field operations'"
                ],
                "suggested_improvement": "best next improvement",
                "positive_drivers": [
                    "short prose finding for what is going well, e.g. 'Budget and expense reports provide usable cost history'"
                ],
                "negative_drivers": [
                    "short prose finding for a real weakness (not mere absence), e.g. 'Reported costs and offtake assumptions conflict'"
                ],
                "blockers": [
                    "ONLY true material blockers that stop progress, e.g. 'Permit denial blocks construction start'"
                ],
                "missing_items": [
                    "short prose finding for a diligence gap, e.g. 'Detailed stove-design specs are not yet in the materials'"
                ],
                "relevant_modules": ["string"],
                "improvement_actions": ["string"],
                "uncertainties": [
                    "short prose finding for an open question, e.g. 'Long-run unit economics are still incompletely modeled'"
                ],
            },
        }
    )
    system = (
        "You are a constructive diligence reviewer assessing one project status category. "
        "Return strict JSON only. Be lightly kind and balanced — credit what the materials "
        "actually support before noting gaps. Do not hunt for the harshest reading. "
        "Use the criteria as a reasoning lens, NOT a strict checklist. "
        "Synthesize one section-level status — do not score criteria individually or roll up mechanically. "
        "Retrieved context facts are a relevance-ranked SAMPLE for depth — not the full corpus. "
        "The project file catalog (filenames/types/index status) is provided so you know what "
        "materials EXIST. If a relevant file appears there, credit it as available support even "
        "when the retrieved sample did not quote it, and put residual detail gaps in missing_items "
        "or uncertainties — do NOT invent blockers from incomplete retrieval. "
        "If the catalog notes truncation, even more files exist beyond the listed names. "
        "Structured project signals (risk counts, variables, assessments) are supporting context — "
        "paraphrase them in plain language (e.g. 'no unresolved high-severity risks are recorded'). "
        "Always include positive_drivers when the inventory or retrieved sample contains anything "
        "relevant to this category. "
        "STATUS MUST DIFFERENTIATE — do not default everything to yellow. "
        "Green is the correct call when materials substantially support this category for the "
        "project's current stage, even if some nice-to-have details are still missing. "
        "Residual diligence gaps alone do NOT force yellow if the core story for this category holds. "
        "Yellow only when support is materially incomplete, weakly evidenced, or meaningfully uncertain "
        "on a core theme for this category. "
        "Prefer yellow over red when evidence is incomplete but directionally supportive. "
        "Missing evidence for a theme should usually lower confidence and/or go into missing_items, "
        "not auto-force yellow/red merely because a metric or plan document is absent from the sample. "
        "Reserve blockers for severe, confirmed obstacles that halt progress; "
        "do not put ordinary diligence gaps or 'not retrieved' items in blockers or negative_drivers. "
        "Respect status_constraints when present, but never name them or any other internal schema "
        "keys in user-facing text. "
        "Base judgment primarily on retrieved project content and the file inventory. "
        "Green means available evidence affirmatively supports this category for the project's current stage. "
        "Yellow means core support for this category is incomplete or meaningfully uncertain. "
        "Red means a material blocker, contradiction, or severe unresolved issue — not 'documents are thin'. "
        "Unknown means the record is too thin to assess. "
        "Confidence is confidence in your assessment, not confidence the project will succeed. "
        "Use high confidence when inventory + retrieved content give solid coverage for this category; "
        "medium when coverage is mixed; low when coverage is thin. Do not default to medium. "
        "Do not project financial outcomes unless explicitly supported by retrieved documents. "
        "Frame output as an assessment/recommendation based on available materials — never 'this project is ready'. "
        "Keep critical_insight and rationale to one sentence each. "
        "Write positive_drivers, negative_drivers, blockers, missing_items, and uncertainties as short "
        "prose findings (one clause or sentence each) that make the direction clear. "
        "Do NOT return bare noun phrases or labels "
        "(bad: 'Binding PPA'; good: 'No binding PPA has been signed yet'). "
        "Avoid stacking every bullet as 'No X…' — mix credited evidence with remaining gaps. "
        "NEVER mention internal field or schema names in any output text "
        "(including secondary_structured_state, status_constraints, file_inventory, "
        "retrieved_project_context, guardrails, max_status, forced_status, blocker_flags, red_flags). "
        "Do not overstate certainty."
    )
    llm_result = await llm_json(system=system, user_msg=user_msg)
    if not llm_result:
        generated = _fallback_category_result(category, guardrails)
        generated["supporting_signals"] = {
            "structured_state": context,
            "retrieved_context": retrieved_context,
            "critical_assessment": {
                "critical_insight": generated["rationale"],
                "suggested_improvement": "",
            },
        }
        return generated

    status = _clamp_status(str(llm_result.get("status", "unknown")).lower())
    confidence = _clamp_confidence(str(llm_result.get("confidence", "unknown")).lower())
    if guardrails["forced_status"] is not None:
        status = guardrails["forced_status"]
    else:
        status = _status_not_higher(status, guardrails["max_status"])

    fallback = _fallback_category_result(category, guardrails)
    critical_insight = _sanitize_rationale_text(str(llm_result.get("critical_insight") or "").strip())
    llm_rationale = _sanitize_rationale_text(str(llm_result.get("rationale") or "").strip())
    suggested_improvement = _sanitize_rationale_text(str(llm_result.get("suggested_improvement") or "").strip())
    supporting_evidence = _sanitize_finding_list(llm_result.get("supporting_evidence"), max_items=4)
    missing_items = _sanitize_finding_list(llm_result.get("missing_items"))
    improvement_actions = _sanitize_finding_list(llm_result.get("improvement_actions"))
    if suggested_improvement and suggested_improvement not in improvement_actions:
        improvement_actions = [suggested_improvement, *improvement_actions][:6]

    return {
        "status": status,
        "confidence": confidence,
        "rationale": llm_rationale or fallback["rationale"],
        "positive_drivers": supporting_evidence or _sanitize_finding_list(llm_result.get("positive_drivers")),
        "negative_drivers": _sanitize_finding_list(llm_result.get("negative_drivers")),
        # Do not fall back to internal guardrail flag slugs — those are not user-facing findings.
        "blockers": _sanitize_finding_list(llm_result.get("blockers")),
        "missing_items": missing_items,
        "relevant_modules": _truncate_list(llm_result.get("relevant_modules")),
        "improvement_actions": improvement_actions,
        "uncertainties": _sanitize_finding_list(llm_result.get("uncertainties")),
        "supporting_signals": {
            "structured_state": context,
            "retrieved_context": retrieved_context,
            "critical_assessment": {
                "critical_insight": critical_insight or llm_rationale or fallback["rationale"],
                "suggested_improvement": suggested_improvement,
                "supporting_evidence": supporting_evidence,
            },
        },
    }


async def _list_active_status_categories(
    db: AsyncSession,
    project: Project,
) -> list[ProjectStatusCategory]:
    result = await db.execute(
        select(ProjectStatusCategory)
        .where(
            ProjectStatusCategory.project_id == project.id,
            ProjectStatusCategory.is_active.is_(True),
        )
        .order_by(ProjectStatusCategory.created_at.asc())
    )
    return list(result.scalars().all())


async def get_or_seed_status_categories(
    db: AsyncSession,
    project: Project,
) -> list[ProjectStatusCategory]:
    rows = await _list_active_status_categories(db, project)
    if rows:
        return rows

    # If the project already has categories (even soft-deleted), do not reseed —
    # the user may have intentionally removed every active category.
    existing = await db.execute(
        select(ProjectStatusCategory.id).where(ProjectStatusCategory.project_id == project.id).limit(1)
    )
    if existing.scalar_one_or_none() is not None:
        return []

    # Overview loads status + category configs in parallel; both used to seed and
    # race into uq_project_status_categories_project_key. Seed inside a savepoint
    # so a concurrent winner just causes a re-fetch instead of a 500.
    defaults = get_default_status_categories()
    try:
        async with db.begin_nested():
            for item in defaults.categories:
                db.add(
                    ProjectStatusCategory(
                        project_id=project.id,
                        category_key=item.category_key,
                        label=item.label,
                        definition_text=item.definition_text,
                        criteria=None,
                        is_active=True,
                    )
                )
            await db.flush()
    except IntegrityError:
        pass

    return await _list_active_status_categories(db, project)


async def refresh_project_status(
    db: AsyncSession,
    project: Project,
    *,
    source: str = "manual_refresh",
    user_id: str | None = None,
) -> list[ProjectStatusResult]:
    defaults = get_default_status_categories()
    categories = await get_or_seed_status_categories(db, project)
    await ensure_category_criteria(db, project, categories)

    collected = await _collect_status_signal_context(db, project)
    context = collected["context"]
    fingerprint = collected["fingerprint"]

    existing_result_rows = await db.execute(
        select(ProjectStatusResult).where(ProjectStatusResult.project_id == project.id)
    )
    by_category = {row.category_key: row for row in existing_result_rows.scalars().all()}

    refreshed_rows: list[ProjectStatusResult] = []
    now = datetime.now(timezone.utc)
    active_keys = {row.category_key for row in categories}

    for row in categories:
        category = _category_from_row(row)
        guardrails = _guardrails_for_category(context)
        retrieved_context = await _retrieve_category_context(db, project, category, user_id=user_id)
        generated = await _llm_category_result(context, defaults, category, guardrails, retrieved_context)

        result_row = by_category.get(row.category_key)
        if result_row is None:
            result_row = ProjectStatusResult(
                project_id=project.id,
                domain=defaults.domain,
                category_key=row.category_key,
                category_label=row.label,
            )
            db.add(result_row)

        critical = (generated.get("supporting_signals") or {}).get("critical_assessment") or {}
        result_row.category_label = row.label
        result_row.status = generated["status"]
        result_row.confidence = generated["confidence"]
        result_row.rationale = generated["rationale"]
        result_row.positive_drivers = generated["positive_drivers"]
        result_row.negative_drivers = generated["negative_drivers"]
        result_row.blockers = generated["blockers"]
        result_row.missing_items = generated["missing_items"]
        result_row.relevant_modules = generated["relevant_modules"]
        result_row.improvement_actions = generated["improvement_actions"]
        result_row.uncertainties = generated["uncertainties"]
        result_row.supporting_signals = generated["supporting_signals"]
        result_row.update_source = source
        result_row.source_fingerprint = fingerprint
        result_row.is_stale = False
        result_row.last_updated_at = now
        refreshed_rows.append(result_row)

        db.add(
            ProjectStatusAssessmentHistory(
                project_id=project.id,
                category_key=row.category_key,
                status=generated["status"],
                confidence=generated["confidence"],
                critical_insight=str(critical.get("critical_insight") or generated["rationale"]),
                source_fingerprint=fingerprint,
                assessed_at=now,
            )
        )

    for orphan_key, orphan_row in by_category.items():
        if orphan_key not in active_keys:
            await db.delete(orphan_row)

    await db.flush()
    refreshed_rows.sort(key=lambda item: item.category_label)
    return refreshed_rows


async def list_project_status(
    db: AsyncSession,
    project: Project,
) -> tuple[list[ProjectStatusCategory], list[ProjectStatusResult], dict[str, list[ProjectStatusOverride]], str]:
    defaults = get_default_status_categories()
    categories = await get_or_seed_status_categories(db, project)

    rows_result = await db.execute(
        select(ProjectStatusResult).where(ProjectStatusResult.project_id == project.id)
    )
    results = {row.category_key: row for row in rows_result.scalars().all()}

    collected = await _collect_status_signal_context(db, project)
    fingerprint = collected["fingerprint"]
    for row in results.values():
        row.is_stale = row.source_fingerprint != fingerprint

    override_result = await db.execute(
        select(ProjectStatusOverride)
        .where(ProjectStatusOverride.project_id == project.id)
        .order_by(ProjectStatusOverride.created_at.desc())
    )
    overrides_by_category: dict[str, list[ProjectStatusOverride]] = {}
    for override in override_result.scalars().all():
        overrides_by_category.setdefault(override.category_key, []).append(override)

    return categories, list(results.values()), overrides_by_category, defaults.domain


async def list_status_category_configs(
    db: AsyncSession,
    project: Project,
) -> list[ProjectStatusCategory]:
    # Do not seed here — GET /project-status owns first-time seeding so parallel
    # overview fetches cannot both insert default categories.
    return await _list_active_status_categories(db, project)


async def create_status_category(
    db: AsyncSession,
    project: Project,
    *,
    label: str,
    definition_text: str,
    category_key: str | None = None,
    defined_by_email: str | None = None,
) -> ProjectStatusCategory:
    key = (category_key or _slugify_category_key(label)).strip().lower()
    if not key:
        raise ValueError("Category key is required")

    existing = await db.execute(
        select(ProjectStatusCategory).where(
            ProjectStatusCategory.project_id == project.id,
            ProjectStatusCategory.category_key == key,
        )
    )
    existing_row = existing.scalar_one_or_none()
    if existing_row is not None:
        if existing_row.is_active:
            raise ValueError("A category with this key already exists")
        # Reuse a previously deleted category key instead of colliding on uniqueness.
        existing_row.label = label.strip()
        existing_row.definition_text = definition_text.strip()
        existing_row.criteria = None
        existing_row.defined_by_email = (defined_by_email or "").strip() or None
        existing_row.is_active = True
        await db.flush()
        return existing_row

    row = ProjectStatusCategory(
        project_id=project.id,
        category_key=key,
        label=label.strip(),
        definition_text=definition_text.strip(),
        criteria=None,
        defined_by_email=(defined_by_email or "").strip() or None,
        is_active=True,
    )
    db.add(row)
    await db.flush()
    return row


async def update_status_category(
    db: AsyncSession,
    project: Project,
    *,
    category_key: str,
    label: str | None = None,
    definition_text: str | None = None,
    criteria: dict[str, Any] | None = None,
    is_active: bool | None = None,
    defined_by_email: str | None = None,
) -> ProjectStatusCategory:
    result = await db.execute(
        select(ProjectStatusCategory).where(
            ProjectStatusCategory.project_id == project.id,
            ProjectStatusCategory.category_key == category_key,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise LookupError("Category not found")
    if label is not None:
        row.label = label.strip()
    if definition_text is not None:
        next_definition = definition_text.strip()
        # Criteria are a backend evaluation lens derived from the definition —
        # clear them so the next refresh regenerates against the new text.
        if next_definition != (row.definition_text or ""):
            row.criteria = None
            if defined_by_email is not None:
                row.defined_by_email = defined_by_email.strip() or None
        row.definition_text = next_definition
    if criteria is not None:
        row.criteria = criteria
    if is_active is not None:
        row.is_active = is_active
    await db.flush()
    return row


async def delete_status_category(
    db: AsyncSession,
    project: Project,
    *,
    category_key: str,
) -> None:
    result = await db.execute(
        select(ProjectStatusCategory).where(
            ProjectStatusCategory.project_id == project.id,
            ProjectStatusCategory.category_key == category_key,
        )
    )
    row = result.scalar_one_or_none()
    if row is None or not row.is_active:
        raise LookupError("Category not found")

    # Soft-delete so shared projects stay consistent and related history rows
    # cannot block removal. Inactive categories are omitted from status views.
    row.is_active = False

    result_rows = await db.execute(
        select(ProjectStatusResult).where(
            ProjectStatusResult.project_id == project.id,
            ProjectStatusResult.category_key == category_key,
        )
    )
    for result_row in result_rows.scalars().all():
        await db.delete(result_row)

    override_rows = await db.execute(
        select(ProjectStatusOverride).where(
            ProjectStatusOverride.project_id == project.id,
            ProjectStatusOverride.category_key == category_key,
        )
    )
    for override_row in override_rows.scalars().all():
        await db.delete(override_row)

    await db.flush()


async def generate_category_criteria_for_row(
    db: AsyncSession,
    project: Project,
    *,
    category_key: str,
    persist: bool = True,
) -> dict[str, Any]:
    result = await db.execute(
        select(ProjectStatusCategory).where(
            ProjectStatusCategory.project_id == project.id,
            ProjectStatusCategory.category_key == category_key,
            ProjectStatusCategory.is_active.is_(True),
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise LookupError("Category not found")

    generated = await generate_status_category_criteria(
        label=row.label,
        definition_text=row.definition_text,
        project_context=_project_context_for_generation(project),
    )
    if persist:
        row.criteria = generated
        await db.flush()
    return generated


async def apply_project_status_override(
    db: AsyncSession,
    project: Project,
    *,
    category_key: str,
    override_status: str,
    explanation: str | None,
    user_id: str,
    user_email: str | None,
) -> ProjectStatusOverride:
    category_result = await db.execute(
        select(ProjectStatusCategory).where(
            ProjectStatusCategory.project_id == project.id,
            ProjectStatusCategory.category_key == category_key,
            ProjectStatusCategory.is_active.is_(True),
        )
    )
    if category_result.scalar_one_or_none() is None:
        raise LookupError("Category not found")

    row_result = await db.execute(
        select(ProjectStatusResult).where(
            ProjectStatusResult.project_id == project.id,
            ProjectStatusResult.category_key == category_key,
        )
    )
    row = row_result.scalar_one_or_none()
    prior_status = row.status if row else None

    override = ProjectStatusOverride(
        project_id=project.id,
        category_key=category_key,
        prior_system_status=_clamp_status(prior_status, fallback="unknown") if prior_status else None,
        override_status=_clamp_status(override_status),
        explanation=explanation.strip() if isinstance(explanation, str) and explanation.strip() else None,
        overridden_by_user_id=user_id,
        overridden_by_email=user_email,
    )
    db.add(override)
    await db.flush()
    return override


async def _run_scheduled_project_status_refresh(
    project_id: str,
    *,
    source: str,
    user_id: str | None,
) -> None:
    try:
        async with AsyncSessionLocal() as db:
            project = await db.get(Project, UUID(str(project_id)))
            if project is None:
                return
            await refresh_project_status(
                db,
                project,
                source=source,
                user_id=user_id,
            )
            await db.commit()
    except Exception:
        logger.exception(
            "Scheduled project status refresh failed for project %s (source=%s)",
            project_id,
            source,
        )


def schedule_project_status_refresh(
    project_id: UUID | str,
    *,
    source: str = "signal_change",
    user_id: str | None = None,
) -> None:
    """Debounced fire-and-forget status refresh after materials/assessments change.

    Safe to call from request handlers: uses its own DB session and coalesces
    rapid signal bursts (multi-file upload, index + variable extract, etc.).
    """
    key = str(project_id)
    _pending_status_refresh_meta[key] = {"source": source, "user_id": user_id}

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning(
            "No running event loop; skipping scheduled status refresh for %s",
            key,
        )
        return

    existing = _pending_status_refresh_handles.get(key)
    if existing is not None:
        existing.cancel()

    def _fire() -> None:
        _pending_status_refresh_handles.pop(key, None)
        meta = _pending_status_refresh_meta.pop(
            key,
            {"source": source, "user_id": user_id},
        )
        asyncio.create_task(
            _run_scheduled_project_status_refresh(
                key,
                source=str(meta.get("source") or source),
                user_id=meta.get("user_id"),
            )
        )

    _pending_status_refresh_handles[key] = loop.call_later(
        _STATUS_REFRESH_DEBOUNCE_SECONDS,
        _fire,
    )
