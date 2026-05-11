from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assessments.utils import llm_json
from app.domain.registry import get_project_health_definition
from app.models.assumption import Assumption
from app.models.evidence import EvidenceDoc, EvidenceDocStatus
from app.models.initiative import Initiative
from app.models.project_health import ProjectHealthOverride, ProjectHealthResult
from app.models.project_material import ProjectMaterial
from app.services.tiered_retrieval import RetrievedFact, TieredRetrievalService

VALID_STATUSES = {"green", "yellow", "red", "unknown"}
VALID_CONFIDENCE = {"high", "medium", "low", "unknown"}
STATUS_ORDER = {"unknown": 0, "red": 1, "yellow": 2, "green": 3}
STALE_ANALYSIS_WINDOW = timedelta(days=21)
MAX_RETRIEVED_CONTEXT_ITEMS = 6


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


def _payload_excerpt(payload: Any, *, max_chars: int = 360) -> str | None:
    """Extract a compact human-readable excerpt from arbitrary assessment output."""

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


def _fact_to_health_source(fact: RetrievedFact) -> dict[str, Any]:
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


async def _retrieve_dimension_context(
    db: AsyncSession,
    initiative: Initiative,
    dimension: Any,
    *,
    user_id: str | None = None,
) -> dict[str, Any]:
    retriever = TieredRetrievalService(db, user_id=user_id)
    queries = list(dimension.retrieval_queries or ())
    if not queries:
        queries = [
            " ".join(
                [
                    dimension.label,
                    dimension.description,
                    " ".join(dimension.llm_prompt_guidance or ()),
                ]
            )
        ]

    facts: list[RetrievedFact] = []
    for query in queries[:2]:
        facts.extend(
            await retriever.search_corpus(
                query,
                initiative.id,
                corpus_top_k=2,
                evidence_top_k=4,
            )
        )
        facts.extend(await retriever.search_project_materials(query, initiative.id, max_results=2))

    if len(facts) < 3 and initiative.workspace_id:
        facts.extend(
            await retriever.search_workspace_context(
                queries[0],
                initiative.workspace_id,
                workspace_top_k=2,
                knowledge_top_k=2,
            )
        )

    top_facts = _dedupe_facts(facts)
    existing_titles = {fact.source_title.strip().lower() for fact in top_facts if fact.source_title}
    material_rows = await db.execute(
        select(ProjectMaterial.filename, ProjectMaterial.content_text)
        .where(ProjectMaterial.initiative_id == initiative.id)
        .order_by(ProjectMaterial.created_at.desc())
        .limit(4)
    )
    material_facts: list[dict[str, Any]] = []
    for filename, content_text in material_rows.all():
        title = str(filename or "").strip()
        if not title or title.lower() in existing_titles:
            continue
        excerpt = _clip_text(content_text, max_chars=280) or "Project material uploaded for this initiative."
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

    # Project materials are first-class context for health judgments, so keep
    # a small guaranteed presence before appending retrieved chunk evidence.
    combined_sources = material_facts + [_fact_to_health_source(fact) for fact in top_facts]
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

    serialized_facts = deduped_sources
    return {
        "queries": queries[:2],
        "facts": serialized_facts,
        "retrieved_count": len(serialized_facts),
    }


def _specific_signal_summary(context: dict[str, Any], dimension_label: str) -> str:
    assessment = context.get("assessment", {})
    assumptions = context.get("assumptions", {})
    evidence = context.get("evidence", {})
    risk = context.get("risk", {})
    project_plan = context.get("project_plan", {})
    fields = context.get("initiative_fields", {})
    missing_profile_fields = [k for k, v in fields.items() if not v]
    profile_present = sum(1 for v in fields.values() if v)
    profile_total = len(fields)
    pieces = [
        f"{evidence.get('materials', 0)} source materials are uploaded",
        f"{evidence.get('indexed', 0)} evidence files are indexed",
        f"{assumptions.get('validated', 0)} assumptions are validated and {assumptions.get('missing', 0)} are marked missing",
        f"{profile_present} of {profile_total} core project profile fields are present",
        f"{project_plan.get('items_complete', 0)} of {project_plan.get('items_total', 0)} plan items are complete",
        f"{risk.get('unresolved_high_or_critical', 0)} high-severity risks are unresolved",
    ]
    if assessment.get("total", 0) > 0:
        pieces.append(
            f"{assessment.get('completed', 0)} completed analysis modules are available as supporting evidence"
        )
    if missing_profile_fields:
        pieces.append(f"key profile fields still missing: {', '.join(missing_profile_fields[:3])}")
    return f"For {dimension_label.lower()}, current project signals show " + "; ".join(pieces) + "."


def _sanitize_rationale_text(value: str) -> str:
    if not value:
        return value
    text = value.replace("guardrails", "project checks").replace("Guardrails", "Project checks")
    text = text.replace("capped at yellow", "currently held at yellow")
    return text


def _extract_risk_counts(payload: Any) -> tuple[int, int]:
    """Return (high_or_critical_count, unresolved_count) from arbitrary payload."""

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


async def _collect_health_signal_context(db: AsyncSession, initiative: Initiative) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    stale_before = now - STALE_ANALYSIS_WINDOW

    assessment_instances = [i for i in (initiative.assessment_instances or []) if not getattr(i, "archived", False)]
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

    assumptions_result = await db.execute(
        select(
            func.count(Assumption.id),
            func.sum(case((Assumption.status == "validated", 1), else_=0)),
            func.sum(case((Assumption.status == "extracted", 1), else_=0)),
            func.sum(case((Assumption.status == "assumed", 1), else_=0)),
            func.sum(case((Assumption.status == "missing", 1), else_=0)),
        ).where(Assumption.initiative_id == initiative.id)
    )
    assumption_counts = assumptions_result.one()
    assumptions_total = int(assumption_counts[0] or 0)
    assumptions_validated = int(assumption_counts[1] or 0)
    assumptions_extracted = int(assumption_counts[2] or 0)
    assumptions_assumed = int(assumption_counts[3] or 0)
    assumptions_missing = int(assumption_counts[4] or 0)

    assumptions_rows = await db.execute(
        select(Assumption.label, Assumption.status, Assumption.value, Assumption.notes)
        .where(Assumption.initiative_id == initiative.id)
        .order_by(Assumption.updated_at.desc())
        .limit(14)
    )
    assumption_examples = [
        {
            "label": label,
            "status": status,
            "value": _clip_text(value, max_chars=120),
            "notes": _clip_text(notes, max_chars=120),
        }
        for label, status, value, notes in assumptions_rows.all()
    ]

    evidence_result = await db.execute(
        select(
            func.count(EvidenceDoc.id),
            func.sum(case((EvidenceDoc.processing_status == EvidenceDocStatus.INDEXED.value, 1), else_=0)),
            func.sum(case((EvidenceDoc.processing_status == EvidenceDocStatus.FAILED.value, 1), else_=0)),
        ).where(EvidenceDoc.initiative_id == initiative.id)
    )
    evidence_counts = evidence_result.one()
    evidence_total = int(evidence_counts[0] or 0)
    evidence_indexed = int(evidence_counts[1] or 0)
    evidence_failed = int(evidence_counts[2] or 0)

    evidence_rows = await db.execute(
        select(EvidenceDoc.filename, EvidenceDoc.processing_status, EvidenceDoc.preview_text)
        .where(EvidenceDoc.initiative_id == initiative.id)
        .order_by(EvidenceDoc.created_at.desc())
        .limit(8)
    )
    evidence_examples = [
        {
            "filename": filename,
            "status": status,
            "preview": _clip_text(preview, max_chars=220),
        }
        for filename, status, preview in evidence_rows.all()
    ]

    materials_result = await db.execute(
        select(func.count(ProjectMaterial.id)).where(ProjectMaterial.initiative_id == initiative.id)
    )
    materials_total = int(materials_result.scalar_one() or 0)

    material_rows = await db.execute(
        select(ProjectMaterial.filename, ProjectMaterial.file_type, ProjectMaterial.content_text)
        .where(ProjectMaterial.initiative_id == initiative.id)
        .order_by(ProjectMaterial.created_at.desc())
        .limit(6)
    )
    material_examples = [
        {
            "filename": filename,
            "file_type": file_type,
            "excerpt": _clip_text(content_text, max_chars=260),
        }
        for filename, file_type, content_text in material_rows.all()
    ]

    fields_present = {
        "title": bool(initiative.title),
        "geography": bool(initiative.geography),
        "project_type": bool(initiative.project_type),
        "goal": bool(initiative.goal),
        "timeline": bool(initiative.timeline),
        "budget_range": bool(initiative.budget_range),
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

    plan_payload = initiative.project_plan or {}
    plan_items_total = 0
    plan_items_complete = 0
    for pillar in plan_payload.get("pillars", []):
        for item in pillar.get("items", []):
            plan_items_total += 1
            if item.get("status") == "complete":
                plan_items_complete += 1

    context = {
        "stage": initiative.stage,
        "project_profile": {
            "title": initiative.title,
            "geography": initiative.geography,
            "project_type": initiative.project_type,
            "goal": _clip_text(initiative.goal, max_chars=260),
            "timeline": initiative.timeline,
            "budget_range": initiative.budget_range,
            "description": _clip_text(initiative.project_description, max_chars=420),
            "overview": _clip_text(initiative.overview_description, max_chars=420),
        },
        "assessment": {
            "total": len(assessment_instances),
            "completed": len(completed_instances),
            "errors": len(error_instances),
            "stale_completed": len(stale_instances),
            "by_assessment_id": assessment_by_id,
            "completed_output_excerpts": completed_output_excerpts,
        },
        "assumptions": {
            "total": assumptions_total,
            "validated": assumptions_validated,
            "extracted": assumptions_extracted,
            "assumed": assumptions_assumed,
            "missing": assumptions_missing,
            "examples": assumption_examples,
        },
        "evidence": {
            "total": evidence_total,
            "indexed": evidence_indexed,
            "failed": evidence_failed,
            "materials": materials_total,
            "documents": evidence_examples,
            "materials_examples": material_examples,
        },
        "initiative_fields": fields_present,
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


def _guardrails_for_dimension(context: dict[str, Any], dimension: Any) -> dict[str, Any]:
    assessment_ctx = context["assessment"]
    assumptions = context["assumptions"]
    evidence = context["evidence"]
    risk = context["risk"]
    relevant_ids = set(dimension.relevant_assessment_ids or ())

    by_assessment_id = assessment_ctx.get("by_assessment_id") or {}
    matching_errors = assessment_ctx["errors"]
    if relevant_ids:
        matching_errors = sum(int((by_assessment_id.get(a) or {}).get("errors") or 0) for a in relevant_ids)

    blocker_flags: list[str] = []
    red_flags: list[str] = []
    if assumptions["missing"] > 0:
        blocker_flags.append("required_assumptions_missing")
    if evidence["indexed"] == 0 and evidence["materials"] == 0 and evidence["total"] == 0:
        blocker_flags.append("core_claims_unsupported")
    if matching_errors > 0:
        red_flags.append("failed_or_invalid_module_output")
    if risk["unresolved_high_or_critical"] > 0:
        red_flags.append("severe_unresolved_risk")
    if evidence["failed"] > 0 and evidence["indexed"] == 0:
        red_flags.append("required_document_processing_failed")

    has_signal = any(
        [
            assessment_ctx["total"] > 0,
            assumptions["total"] > 0,
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
        "relevant_modules": sorted(relevant_ids),
    }


def _fallback_dimension_result(dimension: Any, guardrails: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    status = guardrails["forced_status"] or guardrails["max_status"]
    if not guardrails["has_signal"]:
        rationale = (
            f"Not enough project evidence is available yet to judge {dimension.label.lower()}."
        )
    elif status == "red":
        rationale = f"Material unresolved blockers currently weaken {dimension.label.lower()}."
    elif status == "yellow":
        rationale = f"The project appears plausible, but unresolved assumptions or planning gaps limit {dimension.label.lower()}."
    else:
        rationale = f"The available project evidence appears coherent enough to support {dimension.label.lower()} at this stage."
    return {
        "status": status,
        "confidence": "medium" if status != "unknown" else "unknown",
        "rationale": rationale,
        "positive_drivers": [],
        "negative_drivers": [],
        "blockers": guardrails["red_flags"] + guardrails["blocker_flags"],
        "missing_items": [],
        "relevant_modules": guardrails["relevant_modules"],
        "improvement_actions": [],
        "uncertainties": [],
        "supporting_signals": {},
    }


async def _llm_dimension_result(
    context: dict[str, Any],
    domain_definition: Any,
    dimension: Any,
    guardrails: dict[str, Any],
    retrieved_context: dict[str, Any],
) -> dict[str, Any]:
    user_msg = json.dumps(
        {
            "domain": domain_definition.domain,
            "stage": context["stage"],
            "stage_expectation": domain_definition.stage_expectations.get(context["stage"], ""),
            "dimension": {
                "id": dimension.id,
                "label": dimension.label,
                "description": dimension.description,
                "green_blockers": list(dimension.green_blockers),
                "red_triggers": list(dimension.red_triggers),
                "yellow_defaults": list(dimension.yellow_defaults),
                "llm_prompt_guidance": list(dimension.llm_prompt_guidance),
                "relevant_assessment_ids": list(dimension.relevant_assessment_ids),
                "retrieval_queries": list(dimension.retrieval_queries or ()),
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
                "supporting_evidence": ["strongest retrieved evidence or module outputs"],
                "suggested_improvement": "best next improvement",
                "positive_drivers": ["optional supporting drivers"],
                "negative_drivers": ["optional weakening drivers"],
                "blockers": ["string"],
                "missing_items": ["string"],
                "relevant_modules": ["string"],
                "improvement_actions": ["string"],
                "uncertainties": ["string"],
            },
        }
    )
    system = (
        "You are assessing one project health dimension using retrieved project context and secondary structured signals. "
        "Never return markdown. Return strict JSON only. "
        "Do not assign green when status_constraints.max_status is yellow or when status_constraints.forced_status is set. "
        "Your job is to produce a critical, decision-relevant assessment, not a summary of counts. "
        "Do not repeat the same generic project inventory across dimensions. "
        "Focus only on the signals that matter for this dimension. "
        "Base your judgment primarily on retrieved project content. Use structured counts only when they materially affect the assessment. "
        "Assign status and confidence using your judgment. "
        "Green means the retrieved record affirmatively supports this dimension for the project's current stage. "
        "Yellow means the dimension is plausible but incomplete, weakly supported, or meaningfully uncertain. "
        "Red means there is a material blocker, contradiction, severe unresolved issue, or insufficient basis for credible progress. "
        "Unknown means the retrieved record is too thin to assess. "
        "Confidence means confidence in your assessment, not confidence that the project will succeed. "
        "Do not mark Evidence Strength green unless retrieved context shows material claims are actually supported. "
        "Do not mark Risk Profile green merely because no risks are recorded. "
        "Do not mark Financial Viability green unless there is affirmative support for coherent costs, funding need, and economic logic. "
        "Do not use high confidence when the retrieved project context is thin or contradictory. "
        "Do not treat indexed files as evidence unless they connect to claims, assumptions, calculations, or module outputs. "
        "Critical insight should answer: what is the main judgment, why does it matter, and what would most improve this dimension. "
        "Keep critical_insight and rationale to one sentence each, ideally 16-30 words. "
        "Make the language project-specific, but keep explicit source titles and citation-style references out of the core summary text. "
        "Source attribution belongs in retrieved source metadata, not in-line in the insight sentence. "
        "Do not mention status constraints, internal checks, or policy terms explicitly in rationale text. "
        "Do not overstate certainty."
    )
    llm_result = await llm_json(system=system, user_msg=user_msg)
    if not llm_result:
        generated = _fallback_dimension_result(dimension, guardrails, context)
        generated["supporting_signals"] = {
            "structured_state": context,
            "retrieved_context": retrieved_context,
            "critical_assessment": {
                "critical_insight": generated["rationale"],
                "suggested_improvement": generated["improvement_actions"][0] if generated["improvement_actions"] else "",
            },
        }
        return generated
    status = _clamp_status(str(llm_result.get("status", "unknown")).lower())
    confidence = _clamp_confidence(str(llm_result.get("confidence", "unknown")).lower())
    if guardrails["forced_status"] is not None:
        status = guardrails["forced_status"]
    else:
        status = _status_not_higher(status, guardrails["max_status"])
    fallback = _fallback_dimension_result(dimension, guardrails, context)
    critical_insight = _sanitize_rationale_text(str(llm_result.get("critical_insight") or "").strip())
    llm_rationale = _sanitize_rationale_text(str(llm_result.get("rationale") or "").strip())
    suggested_improvement = _sanitize_rationale_text(str(llm_result.get("suggested_improvement") or "").strip())
    supporting_evidence = _truncate_list(llm_result.get("supporting_evidence"), max_items=4)
    missing_items = _truncate_list(llm_result.get("missing_items"))
    improvement_actions = _truncate_list(llm_result.get("improvement_actions"))
    if suggested_improvement and suggested_improvement not in improvement_actions:
        improvement_actions = [suggested_improvement, *improvement_actions][:6]
    return {
        "status": status,
        "confidence": confidence,
        "rationale": llm_rationale or fallback["rationale"],
        "positive_drivers": supporting_evidence or _truncate_list(llm_result.get("positive_drivers")),
        "negative_drivers": _truncate_list(llm_result.get("negative_drivers")),
        "blockers": _truncate_list(llm_result.get("blockers")) or (guardrails["red_flags"] + guardrails["blocker_flags"]),
        "missing_items": missing_items,
        "relevant_modules": _truncate_list(llm_result.get("relevant_modules")) or guardrails["relevant_modules"],
        "improvement_actions": improvement_actions,
        "uncertainties": _truncate_list(llm_result.get("uncertainties")),
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


async def refresh_project_health(
    db: AsyncSession,
    initiative: Initiative,
    *,
    source: str = "manual_refresh",
    user_id: str | None = None,
) -> list[ProjectHealthResult]:
    """Recompute and persist system-generated project health rows for one initiative."""
    definition = get_project_health_definition()
    collected = await _collect_health_signal_context(db, initiative)
    context = collected["context"]
    fingerprint = collected["fingerprint"]

    existing_result_rows = await db.execute(
        select(ProjectHealthResult).where(ProjectHealthResult.initiative_id == initiative.id)
    )
    by_dimension = {row.dimension_id: row for row in existing_result_rows.scalars().all()}

    refreshed_rows: list[ProjectHealthResult] = []
    now = datetime.now(timezone.utc)
    for dimension in definition.dimensions:
        guardrails = _guardrails_for_dimension(context, dimension)
        retrieved_context = await _retrieve_dimension_context(db, initiative, dimension, user_id=user_id)
        generated = await _llm_dimension_result(context, definition, dimension, guardrails, retrieved_context)
        row = by_dimension.get(dimension.id)
        if row is None:
            row = ProjectHealthResult(
                initiative_id=initiative.id,
                domain=definition.domain,
                dimension_id=dimension.id,
                dimension_label=dimension.label,
            )
            db.add(row)
        row.status = generated["status"]
        row.confidence = generated["confidence"]
        row.rationale = generated["rationale"]
        row.positive_drivers = generated["positive_drivers"]
        row.negative_drivers = generated["negative_drivers"]
        row.blockers = generated["blockers"]
        row.missing_items = generated["missing_items"]
        row.relevant_modules = generated["relevant_modules"]
        row.improvement_actions = generated["improvement_actions"]
        row.uncertainties = generated["uncertainties"]
        row.supporting_signals = generated["supporting_signals"]
        row.update_source = source
        row.source_fingerprint = fingerprint
        row.is_stale = False
        row.last_updated_at = now
        refreshed_rows.append(row)

    await db.flush()
    refreshed_rows.sort(key=lambda row: row.dimension_label)
    return refreshed_rows


async def list_project_health(
    db: AsyncSession,
    initiative: Initiative,
) -> tuple[list[ProjectHealthResult], dict[str, list[ProjectHealthOverride]], str]:
    """Fetch persisted health rows and override history grouped by dimension."""
    definition = get_project_health_definition()
    rows_result = await db.execute(
        select(ProjectHealthResult).where(ProjectHealthResult.initiative_id == initiative.id)
    )
    rows = rows_result.scalars().all()
    if not rows:
        return [], {}, definition.domain

    collected = await _collect_health_signal_context(db, initiative)
    fingerprint = collected["fingerprint"]
    for row in rows:
        row.is_stale = row.source_fingerprint != fingerprint

    override_result = await db.execute(
        select(ProjectHealthOverride)
        .where(ProjectHealthOverride.initiative_id == initiative.id)
        .order_by(ProjectHealthOverride.created_at.desc())
    )
    overrides_by_dimension: dict[str, list[ProjectHealthOverride]] = {}
    for override in override_result.scalars().all():
        overrides_by_dimension.setdefault(override.dimension_id, []).append(override)

    return rows, overrides_by_dimension, definition.domain


async def apply_project_health_override(
    db: AsyncSession,
    initiative: Initiative,
    *,
    dimension_id: str,
    override_status: str,
    explanation: str | None,
    user_id: str,
    user_email: str | None,
) -> ProjectHealthOverride:
    """Persist an override event for one project-health dimension."""
    row_result = await db.execute(
        select(ProjectHealthResult).where(
            ProjectHealthResult.initiative_id == initiative.id,
            ProjectHealthResult.dimension_id == dimension_id,
        )
    )
    row = row_result.scalar_one_or_none()
    prior_status = row.status if row else None

    override = ProjectHealthOverride(
        initiative_id=initiative.id,
        dimension_id=dimension_id,
        prior_system_status=_clamp_status(prior_status, fallback="unknown") if prior_status else None,
        override_status=_clamp_status(override_status),
        explanation=explanation.strip() if isinstance(explanation, str) and explanation.strip() else None,
        overridden_by_user_id=user_id,
        overridden_by_email=user_email,
    )
    db.add(override)
    await db.flush()
    return override
