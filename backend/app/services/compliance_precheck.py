"""Compliance pre-check service.

Performs framework routing, gap analysis, and findings generation
against the project workspace for the supported compliance frameworks.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine
from uuid import UUID

from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.config import get_settings
from app.models.evidence import EvidenceChunk, EvidenceDoc
from app.models.project_material import ProjectMaterial
from app.services.compliance_frameworks import (
    FRAMEWORK_FAMILIES,
    FRAMEWORK_SCOPE_FACTS,
    ROUTING_SIGNALS,
    SCOPE_FACTS,
    FAMILY_LABELS,
    get_requirements_for_framework,
)
from app.services.rag import RAGService

settings = get_settings()
logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str], Coroutine[Any, Any, None]] | None

# ── LLM function-calling schemas ─────────────────────────────────────

ROUTE_FRAMEWORK_SCHEMA = {
    "type": "function",
    "function": {
        "name": "recommend_framework",
        "description": "Recommend the most relevant compliance framework for this project.",
        "parameters": {
            "type": "object",
            "required": ["framework_id", "rationale", "signals", "possibly_relevant", "not_activated", "scope_facts"],
            "properties": {
                "framework_id": {
                    "type": "string",
                    "enum": list(FRAMEWORK_FAMILIES.keys()),
                    "description": "ID of the recommended framework.",
                },
                "rationale": {
                    "type": "string",
                    "description": "2-3 sentence explanation of why this framework is recommended.",
                },
                "signals": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Project signals that drove this recommendation (e.g. 'geography: Ghana', 'financing: DFI').",
                },
                "possibly_relevant": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "reason": {"type": "string"},
                        },
                        "required": ["id", "reason"],
                    },
                    "description": (
                        "Frameworks that are contextually plausible but whose activation depends on project intent "
                        "not yet confirmed. For example, solar or renewable energy projects often pursue carbon credits "
                        "even when not explicitly stated — Verra VCS and Gold Standard would be possibly_relevant here. "
                        "Include frameworks where relevance is plausible but uncertain, NOT frameworks that are "
                        "foundationally inapplicable (those go in not_activated)."
                    ),
                },
                "not_activated": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "reason": {"type": "string"},
                        },
                        "required": ["id", "reason"],
                    },
                    "description": (
                        "Frameworks that are foundationally NOT applicable to this project type — e.g. ASTM Phase I "
                        "for a non-US project, carbon standards for a pure infrastructure project with no carbon intent, "
                        "or World Bank ESF for a private-sector non-sovereign project. These are hidden by default."
                    ),
                },
                "scope_facts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "label": {"type": "string"},
                            "value": {"type": "string"},
                            "source": {
                                "type": "string",
                                "enum": ["auto", "needs_confirmation"],
                            },
                            "source_quote": {
                                "type": "string",
                                "description": (
                                    "If source is 'auto', provide the EXACT quote from project documents that supports "
                                    "this value. Must be a verbatim passage, not a paraphrase. If you cannot provide "
                                    "a verbatim quote, set source to 'needs_confirmation' instead."
                                ),
                            },
                        },
                        "required": ["id", "label", "value", "source"],
                    },
                    "description": (
                        "Key facts about the project. Mark as 'auto' ONLY if you can point to a specific passage "
                        "in the project documents that directly supports the value. If the value is inferred from "
                        "general context or project type rather than documented evidence, mark as 'needs_confirmation'."
                    ),
                },
            },
        },
    },
}

EVALUATE_REQUIREMENT_SCHEMA = {
    "type": "function",
    "function": {
        "name": "evaluate_requirements",
        "description": "Evaluate a batch of requirements against project evidence.",
        "parameters": {
            "type": "object",
            "required": ["findings"],
            "properties": {
                "findings": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["requirement_id", "status", "rationale"],
                        "properties": {
                            "requirement_id": {"type": "string"},
                            "status": {
                                "type": "string",
                                "enum": [
                                    "supported",
                                    "partially_supported",
                                    "missing",
                                    "ambiguous",
                                    "not_enough_info",
                                    "human_review",
                                ],
                            },
                            "rationale": {
                                "type": "string",
                                "description": "Brief explanation of the status determination.",
                            },
                            "evidence_quotes": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "source_title": {"type": "string"},
                                        "quote": {"type": "string"},
                                    },
                                    "required": ["source_title", "quote"],
                                },
                                "description": "Relevant quotes from project evidence.",
                            },
                            "missing_support": {
                                "type": "string",
                                "description": "What evidence or information is missing or weak.",
                            },
                            "human_review_needed": {"type": "boolean"},
                            "human_review_reason": {
                                "type": "string",
                                "description": "Why human review is needed, if applicable.",
                            },
                        },
                    },
                },
            },
        },
    },
}

ACTIVATION_SCHEMA = {
    "type": "function",
    "function": {
        "name": "determine_active_requirements",
        "description": "Determine which conditional requirements are triggered by the project context.",
        "parameters": {
            "type": "object",
            "required": ["activated_conditions"],
            "properties": {
                "activated_conditions": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of condition IDs that are triggered (e.g. 'land_acquisition', 'biodiversity').",
                },
            },
        },
    },
}


# ── Service ──────────────────────────────────────────────────────────


class CompliancePrecheckService:
    """Performs compliance pre-check analysis against the project workspace."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.model = settings.openai_orchestration_model
        self.rag = RAGService(db)

    # ── Framework routing ────────────────────────────────────────────

    async def route_framework(self, initiative, framework_id: str | None = None) -> dict:
        """Analyze the project workspace and recommend/route a framework.

        If framework_id is provided, returns scope facts for that specific framework.
        Otherwise recommends the most relevant one.
        Returns a dict with: framework, scope_facts.
        """
        evidence_text = await self._gather_evidence_text(initiative.id)
        materials_text = await self._gather_materials_text(initiative.id)

        desc = initiative.project_description or "(No description provided.)"
        project_type = initiative.project_type or "unclassified"
        geography = initiative.geography or "unspecified"
        title = initiative.title or "Untitled Project"

        frameworks_desc = "\n".join(
            f"- **{fm.name}** (`{fm.id}`): {fm.description} [Family: {FAMILY_LABELS.get(fm.family, fm.family)}]"
            for fm in FRAMEWORK_FAMILIES.values()
        )

        signals_desc = "\n".join(
            f"- `{fid}`: {', '.join(sigs)}" for fid, sigs in ROUTING_SIGNALS.items()
        )

        # Use per-framework scope facts when routing for a specific framework
        if framework_id and framework_id in FRAMEWORK_SCOPE_FACTS:
            fw_facts = FRAMEWORK_SCOPE_FACTS[framework_id]
            scope_facts_desc = "\n".join(
                f"- `{f['id']}`: {f['label']} (type: {f.get('type', 'text')}"
                + (f", options: {f['options']}" if 'options' in f else "")
                + ")"
                for f in fw_facts
            )
        else:
            scope_facts_desc = "\n".join(
                f"- `{f['id']}`: {f['label']} (relevant for: {', '.join(f['frameworks'])})"
                for f in SCOPE_FACTS
            )

        system_prompt = f"""You are a compliance routing specialist. Given project details and workspace documents, recommend the single most relevant compliance framework and classify all others into two buckets.

## Supported Frameworks
{frameworks_desc}

## Routing Signals by Framework
{signals_desc}

## Scope Facts to Evaluate
For each of these facts, determine a value from the project context.
{scope_facts_desc}

### GROUNDING RULE (critical)
- Mark a fact as "auto" ONLY if the project documents contain a specific passage that directly states or implies the value. You MUST provide the exact quote in source_quote.
- If there are NO project documents, or the documents do not mention the fact, mark it as "needs_confirmation" — even if you can guess from the project type.
- General inferences (e.g. "solar projects usually pursue carbon credits") are NOT grounds for "auto". That belongs in "needs_confirmation".
- "(No documents uploaded yet.)" or "(No project materials uploaded.)" means there is NO evidence — mark ALL facts as "needs_confirmation".

## THREE-BUCKET CLASSIFICATION (critical)

You must classify every non-recommended framework into exactly one of two buckets:

### possibly_relevant
Frameworks that are CONTEXTUALLY PLAUSIBLE but depend on project intent not yet confirmed.
Examples:
- A solar/wind/renewable energy project → Verra VCS and Gold Standard are possibly_relevant (many pursue carbon credits even when not stated)
- Any infrastructure project with construction → Equator Principles may be possibly_relevant if the financing source is ambiguous
- A mixed-use development with habitat near the site → IFC PS6 / biodiversity requirements possibly relevant

### not_activated
Frameworks that are FOUNDATIONALLY INAPPLICABLE to this project type:
- ASTM Phase I for any non-US project
- Carbon standards (Verra VCS, Gold Standard) for a pure government or social service project with no plausible emission reductions
- World Bank ESF for a private-sector project with no sovereign/government borrower

The key distinction: possibly_relevant = "might matter once we know intent", not_activated = "would not apply regardless of intent."

## Rules
- Recommend the SINGLE most relevant framework.
- Base the recommendation on concrete project signals (geography, financing, project type, document content).
- NEVER put a framework in not_activated just because the project didn't explicitly mention it.
- For emerging-market infrastructure projects with DFI/bank financing, prefer IFC PS or World Bank ESF.
- reason in possibly_relevant should explain WHY it might be relevant (what would trigger it).
- reason in not_activated should explain WHY it's foundationally inapplicable."""

        user_content = f"""PROJECT: {title}
TYPE: {project_type}
GEOGRAPHY: {geography}

DESCRIPTION:
{desc}

UPLOADED DOCUMENTS:
{evidence_text}

PROJECT MATERIALS:
{materials_text}"""

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            tools=[ROUTE_FRAMEWORK_SCHEMA],
            tool_choice={"type": "function", "function": {"name": "recommend_framework"}},
            temperature=0.3,
        )

        tool_call = response.choices[0].message.tool_calls[0]
        result = json.loads(tool_call.function.arguments)

        framework_id = result["framework_id"]
        meta = FRAMEWORK_FAMILIES[framework_id]

        # RAG-verify auto-detected scope facts
        scope_facts = result.get("scope_facts", [])
        scope_facts = await self._verify_scope_facts(initiative.id, scope_facts)

        return {
            "framework": {
                "id": framework_id,
                "family": meta.family,
                "name": meta.name,
                "rationale": result.get("rationale", ""),
                "signals": result.get("signals", []),
                "possibly_relevant": result.get("possibly_relevant", []),
                "not_activated": result.get("not_activated", []),
            },
            "scope_facts": scope_facts,
        }

    # ── Run pre-check ────────────────────────────────────────────────

    async def run_precheck(
        self,
        initiative,
        framework_id: str,
        confirmed_facts: list[dict],
        on_progress: ProgressCallback = None,
    ) -> dict:
        """Run the full compliance pre-check for a given framework.

        Returns the complete precheck result dict stored in initiative.compliance_prechecks[framework_id].
        """
        if framework_id not in FRAMEWORK_FAMILIES:
            raise ValueError(f"Unsupported framework: {framework_id}")

        meta = FRAMEWORK_FAMILIES[framework_id]

        if on_progress:
            await on_progress("Determining applicable requirements...")

        requirements = get_requirements_for_framework(framework_id)

        # Step 1: Determine which conditional requirements are active
        active_conditions = await self._determine_active_conditions(
            initiative, confirmed_facts
        )

        active_reqs = [
            r for r in requirements
            if r.is_always_active or any(c in active_conditions for c in r.conditional_on)
        ]

        if on_progress:
            await on_progress(f"Evaluating {len(active_reqs)} requirements against project evidence...")

        # Step 2: Gather evidence for RAG queries
        evidence_text = await self._gather_evidence_text(initiative.id)
        materials_text = await self._gather_materials_text(initiative.id)

        # Step 3: For each active requirement, retrieve relevant evidence via RAG
        req_evidence: dict[str, list[dict]] = {}
        rag_tasks = []
        for req in active_reqs:
            for query in req.evidence_queries:
                rag_tasks.append((req.id, query))

        # Run RAG queries in batches of 5
        for i in range(0, len(rag_tasks), 5):
            batch = rag_tasks[i : i + 5]
            results = await asyncio.gather(
                *(
                    self.rag.retrieve(
                        query=query,
                        initiative_id=initiative.id,
                        sources=["evidence"],
                        evidence_top_k=3,
                        corpus_top_k=0,
                    )
                    for _, query in batch
                ),
                return_exceptions=True,
            )
            for (req_id, _), result in zip(batch, results):
                if isinstance(result, Exception):
                    logger.warning("RAG query failed for %s: %s", req_id, result)
                    continue
                if req_id not in req_evidence:
                    req_evidence[req_id] = []
                for chunk in result:
                    req_evidence[req_id].append({
                        "source_title": chunk.source_title,
                        "content": chunk.content[:500],
                        "similarity": chunk.similarity,
                    })

        if on_progress:
            await on_progress("Analyzing evidence against requirements...")

        # Step 4: Evaluate requirements in batches using LLM
        findings = await self._evaluate_requirements_batch(
            active_reqs, req_evidence, evidence_text, materials_text, initiative
        )

        # Step 5: Build review queue
        review_queue = self._build_review_queue(findings)

        # Step 6: Compute summary
        summary = self._compute_summary(findings)

        if on_progress:
            await on_progress("Finalizing pre-check report...")

        precheck_result = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "version": 1,
            "framework": {
                "id": framework_id,
                "family": meta.family,
                "name": meta.name,
                "rationale": "",
                "signals": [],
                "not_activated": [],
            },
            "scope_confirmation": {
                "facts": confirmed_facts,
            },
            "findings": findings,
            "review_queue": review_queue,
            "summary": summary,
        }

        # Persist into keyed dict
        prechecks = dict(initiative.compliance_prechecks or {})
        prechecks[framework_id] = precheck_result
        initiative.compliance_prechecks = prechecks
        flag_modified(initiative, "compliance_prechecks")
        initiative.touch()
        await self.db.commit()

        return precheck_result

    # ── Rerun ────────────────────────────────────────────────────────

    async def rerun_precheck(
        self,
        initiative,
        framework_id: str,
        updated_facts: list[dict],
        additional_answers: dict[str, str] | None = None,
        on_progress: ProgressCallback = None,
    ) -> dict:
        """Rerun the pre-check with updated facts and/or additional answers.

        Bumps the version and includes delta information.
        """
        prechecks = initiative.compliance_prechecks or {}
        existing = prechecks.get(framework_id)
        if not existing:
            raise ValueError(f"No existing pre-check for {framework_id}. Run the initial pre-check first.")

        prev_version = existing.get("version", 1)

        result = await self.run_precheck(
            initiative=initiative,
            framework_id=framework_id,
            confirmed_facts=updated_facts,
            on_progress=on_progress,
        )

        # Update version and carry forward framework context from original routing
        result["version"] = prev_version + 1
        result["framework"] = existing["framework"]

        # Compute delta
        prev_findings = {f["requirement_id"]: f["status"] for f in existing.get("findings", [])}
        delta = {
            "newly_supported": [],
            "unresolved_blockers": [],
            "new_ambiguities": [],
            "changed": [],
        }
        for finding in result["findings"]:
            req_id = finding["requirement_id"]
            prev_status = prev_findings.get(req_id)
            curr_status = finding["status"]
            if prev_status and prev_status != curr_status:
                delta["changed"].append({
                    "requirement_id": req_id,
                    "previous_status": prev_status,
                    "current_status": curr_status,
                })
                if curr_status == "supported" and prev_status != "supported":
                    delta["newly_supported"].append(req_id)
                elif curr_status in ("missing", "not_enough_info"):
                    delta["unresolved_blockers"].append(req_id)
                elif curr_status == "ambiguous" and prev_status != "ambiguous":
                    delta["new_ambiguities"].append(req_id)

        result["delta"] = delta

        prechecks = dict(initiative.compliance_prechecks or {})
        prechecks[framework_id] = result
        initiative.compliance_prechecks = prechecks
        flag_modified(initiative, "compliance_prechecks")
        initiative.touch()
        await self.db.commit()

        return result

    # ── Scope fact verification ────────────────────────────────────────

    async def _verify_scope_facts(
        self, initiative_id: UUID, scope_facts: list[dict]
    ) -> list[dict]:
        """RAG-verify auto-detected scope facts against project evidence.

        For each fact marked 'auto', query RAG to find supporting evidence.
        If no evidence is found above the similarity threshold, downgrade
        to 'needs_confirmation' and clear the value. Attach source citations
        to grounded facts.
        """
        MIN_SIMILARITY = 0.35
        verified: list[dict] = []

        for fact in scope_facts:
            if fact.get("source") != "auto" or not fact.get("value"):
                fact["sources"] = []
                verified.append(fact)
                continue

            query = f"{fact.get('label', '')} {fact.get('value', '')}"
            try:
                chunks = await self.rag.retrieve(
                    query=query,
                    initiative_id=initiative_id,
                    sources=["evidence"],
                    evidence_top_k=3,
                    corpus_top_k=0,
                )
            except Exception:
                logger.warning("RAG verification failed for scope fact %s", fact.get("id"))
                chunks = []

            matching = [
                c for c in chunks
                if c.similarity >= MIN_SIMILARITY
            ]

            if matching:
                fact["sources"] = [
                    {
                        "source_title": c.source_title,
                        "content": c.content[:400],
                        "similarity": round(c.similarity, 3),
                        "evidence_doc_id": c.source_doc_id,
                        "chunk_id": c.chunk_id,
                    }
                    for c in matching[:3]
                ]
                verified.append(fact)
            else:
                fact["source"] = "needs_confirmation"
                fact["value"] = ""
                fact["sources"] = []
                fact.pop("source_quote", None)
                verified.append(fact)

        return verified

    # ── Internal helpers ─────────────────────────────────────────────

    async def _determine_active_conditions(
        self, initiative, confirmed_facts: list[dict]
    ) -> list[str]:
        """Use the LLM to determine which conditional requirement branches are active."""
        evidence_text = await self._gather_evidence_text(initiative.id)
        desc = initiative.project_description or "(No description provided.)"
        geography = initiative.geography or "unspecified"

        facts_text = "\n".join(
            f"- {f.get('label', f.get('id', ''))}: {f.get('value', 'unknown')}"
            for f in confirmed_facts
        )

        all_conditions = set()
        for reqs in [get_requirements_for_framework(fid) for fid in FRAMEWORK_FAMILIES]:
            for r in reqs:
                all_conditions.update(r.conditional_on)

        system_prompt = """You are an environmental compliance analyst. Based on the project context, determine which conditional topics are relevant to this project.

Only activate conditions where there is clear evidence or strong indication from the project description, documents, or confirmed facts."""

        user_content = f"""PROJECT DESCRIPTION:
{desc}

GEOGRAPHY: {geography}

CONFIRMED FACTS:
{facts_text}

UPLOADED DOCUMENTS (excerpt):
{evidence_text[:8000]}

POSSIBLE CONDITIONS:
{', '.join(sorted(all_conditions))}

Determine which of these conditions are triggered by this project."""

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            tools=[ACTIVATION_SCHEMA],
            tool_choice={"type": "function", "function": {"name": "determine_active_requirements"}},
            temperature=0.2,
        )

        tool_call = response.choices[0].message.tool_calls[0]
        result = json.loads(tool_call.function.arguments)
        return result.get("activated_conditions", [])

    async def _evaluate_requirements_batch(
        self,
        requirements,
        req_evidence: dict[str, list[dict]],
        evidence_text: str,
        materials_text: str,
        initiative,
    ) -> list[dict]:
        """Evaluate all active requirements in a single LLM call with batched context."""
        reqs_desc = []
        for req in requirements:
            ev = req_evidence.get(req.id, [])
            ev_text = ""
            if ev:
                # Deduplicate by source_title
                seen = set()
                unique_ev = []
                for e in ev:
                    key = (e["source_title"], e["content"][:100])
                    if key not in seen:
                        seen.add(key)
                        unique_ev.append(e)
                ev_text = "\n".join(
                    f"  - [{e['source_title']}]: {e['content'][:300]}"
                    for e in unique_ev[:5]
                )
            reqs_desc.append(
                f"### {req.id}: {req.name}\n"
                f"Section: {req.section}\n"
                f"Description: {req.description}\n"
                f"Retrieved Evidence:\n{ev_text or '  (No matching evidence found)'}\n"
            )

        reqs_block = "\n".join(reqs_desc)
        desc = initiative.project_description or "(No description)"
        title = initiative.title or "Untitled Project"
        geography = initiative.geography or "unspecified"

        system_prompt = """You are an environmental compliance pre-check analyst. Evaluate each requirement against the project evidence provided.

## Status Definitions
- **supported**: Adequate evidence exists in the project workspace to demonstrate this requirement is addressed.
- **partially_supported**: Some evidence exists but it is incomplete, outdated, or does not fully cover the requirement.
- **missing**: No evidence found in the project workspace for this requirement.
- **ambiguous**: Evidence exists but is contradictory, unclear, or could be interpreted multiple ways.
- **not_enough_info**: Cannot evaluate because critical project information is missing.
- **human_review**: The requirement involves judgment calls, legal interpretations, or risk assessments that should not be automated.

## Rules
- Be specific in rationales — cite actual document names and content.
- If evidence partially addresses a requirement, use "partially_supported" not "supported".
- Flag items for human review when they involve legal determinations, risk thresholds, or stakeholder judgments.
- For "missing" items, clearly state what document or information would be needed.
- Never claim compliance or non-compliance — this is a pre-check, not a legal determination."""

        user_content = f"""PROJECT: {title}
GEOGRAPHY: {geography}

DESCRIPTION:
{desc}

PROJECT DOCUMENTS (full text excerpts):
{evidence_text[:12000]}

PROJECT MATERIALS:
{materials_text[:6000]}

## REQUIREMENTS TO EVALUATE

{reqs_block}

Evaluate each requirement listed above."""

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            tools=[EVALUATE_REQUIREMENT_SCHEMA],
            tool_choice={"type": "function", "function": {"name": "evaluate_requirements"}},
            temperature=0.2,
        )

        tool_call = response.choices[0].message.tool_calls[0]
        result = json.loads(tool_call.function.arguments)
        raw_findings = result.get("findings", [])

        # Build a lookup for requirement metadata
        req_map = {r.id: r for r in requirements}

        findings = []
        for i, f in enumerate(raw_findings):
            req_id = f.get("requirement_id", "")
            req = req_map.get(req_id)
            evidence_items = [
                {
                    "source_type": "evidence",
                    "source_title": eq.get("source_title", ""),
                    "quote": eq.get("quote", ""),
                }
                for eq in f.get("evidence_quotes", [])
            ]
            findings.append({
                "id": f"f{i + 1}",
                "requirement_id": req_id,
                "section": req.section if req else "",
                "requirement_name": req.name if req else req_id,
                "status": f.get("status", "not_enough_info"),
                "rationale": f.get("rationale", ""),
                "evidence": evidence_items,
                "missing_support": f.get("missing_support", ""),
                "human_review_needed": f.get("human_review_needed", False),
                "human_review_reason": f.get("human_review_reason", ""),
            })

        return findings

    @staticmethod
    def _build_review_queue(findings: list[dict]) -> list[dict]:
        """Build the human review queue from findings that need attention."""
        queue = []
        for f in findings:
            needs_review = (
                f.get("human_review_needed")
                or f.get("status") in ("human_review", "ambiguous")
            )
            if not needs_review:
                continue

            suggested_step = "Review with project team"
            status = f.get("status", "")
            if "lender" in f.get("section", "").lower() or "finance" in f.get("section", "").lower():
                suggested_step = "Confirm with lender or DFI team"
            elif "indigenous" in f.get("requirement_name", "").lower():
                suggested_step = "Confirm with environmental consultant"
            elif "heritage" in f.get("requirement_name", "").lower():
                suggested_step = "Confirm with environmental consultant"
            elif status == "ambiguous":
                suggested_step = "Clarify with project team or legal counsel"

            queue.append({
                "id": f"r{len(queue) + 1}",
                "finding_id": f["id"],
                "summary": f.get("rationale", ""),
                "framework_location": f.get("section", ""),
                "why_unresolved": f.get("human_review_reason", "") or f.get("missing_support", ""),
                "missing_fact": f.get("missing_support", ""),
                "suggested_next_step": suggested_step,
            })

        return queue

    @staticmethod
    def _compute_summary(findings: list[dict]) -> dict:
        """Compute status counts from findings."""
        counts = {
            "supported": 0,
            "partially_supported": 0,
            "missing": 0,
            "ambiguous": 0,
            "not_enough_info": 0,
            "human_review": 0,
        }
        for f in findings:
            status = f.get("status", "not_enough_info")
            if status in counts:
                counts[status] += 1
        counts["total"] = len(findings)
        return counts

    async def _gather_evidence_text(self, initiative_id: UUID) -> str:
        """Collect text from uploaded evidence documents."""
        MAX_CHARS_PER_DOC = 6000
        MAX_TOTAL_CHARS = 30000

        result = await self.db.execute(
            select(EvidenceDoc)
            .where(EvidenceDoc.initiative_id == initiative_id)
            .order_by(EvidenceDoc.created_at)
        )
        docs = result.scalars().all()

        if not docs:
            return "(No documents uploaded yet.)"

        parts: list[str] = []
        total = 0

        for doc in docs:
            chunk_result = await self.db.execute(
                select(EvidenceChunk.content)
                .where(EvidenceChunk.evidence_doc_id == doc.id)
                .order_by(EvidenceChunk.chunk_index)
            )
            chunks = chunk_result.scalars().all()
            doc_text = " ".join(chunks)

            if len(doc_text) > MAX_CHARS_PER_DOC:
                doc_text = doc_text[:MAX_CHARS_PER_DOC] + " [truncated]"

            header = f"\n--- Document: {doc.filename or 'Untitled'} ({doc.file_type or 'unknown'}) ---\n"
            entry = header + doc_text
            if total + len(entry) > MAX_TOTAL_CHARS:
                parts.append(header + doc_text[: MAX_TOTAL_CHARS - total] + " [truncated]")
                break
            parts.append(entry)
            total += len(entry)

        return "\n".join(parts)

    async def _gather_materials_text(self, initiative_id: UUID) -> str:
        """Collect text from project materials."""
        MAX_CHARS = 15000

        result = await self.db.execute(
            select(ProjectMaterial)
            .where(ProjectMaterial.initiative_id == initiative_id)
            .order_by(ProjectMaterial.created_at)
        )
        materials = result.scalars().all()

        if not materials:
            return "(No project materials uploaded.)"

        parts: list[str] = []
        total = 0

        for mat in materials:
            text = mat.content_text or ""
            if not text:
                continue
            header = f"\n--- Material: {mat.filename or 'Untitled'} ---\n"
            excerpt = text[:4000]
            if len(text) > 4000:
                excerpt += " [truncated]"
            entry = header + excerpt
            if total + len(entry) > MAX_CHARS:
                break
            parts.append(entry)
            total += len(entry)

        return "\n".join(parts) if parts else "(No project materials with text content.)"
