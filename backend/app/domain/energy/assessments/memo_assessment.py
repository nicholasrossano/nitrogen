"""Memo Assessment.

A cited risk summary memo — NOT an investment recommendation. It synthesizes
approved sibling assessments, variables, status, and evidence into a written
diligence memo that surfaces risks, evidence, and open questions for the
reader's own decision-making. It never outputs a proceed/hold/reject call.

Stage workflow:
  1. Sections  (list / categorized_list) — confirmable outline
  2. Drafts    (list / categorized_workspace) — cited section bodies

Export: DOCX write-up assembled from confirmed drafts + synthesis context.
Soft-consumes approved/confirmed sibling assessments, variables, status, and docs.
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

from app.assessments.base import (
    BaseAssessment,
    DecisionLogAttribution,
    FieldDef,
    AssessmentDefinition,
    AssessmentManifest,
    PopulationStep,
    StageDef,
)
from app.assessments.project_synthesis import build_project_synthesis_context
from app.assessments.retrieval import retrieve_evidence
from app.assessments.utils import llm_json
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

DEFAULT_MEMO_SECTIONS: list[dict[str, Any]] = [
    {
        "section_key": "executive_summary",
        "label": "Executive Summary",
        "description": "2-3 paragraph overview of the project and its overall risk profile",
        "key_points": (
            "Project overview and context; What is being asked/proposed; "
            "Overall risk posture in one or two sentences"
        ),
    },
    {
        "section_key": "risk_summary",
        "label": "Risk Summary",
        "description": "Consolidated summary of key risks and critical assumptions to validate",
        "key_points": (
            "Technical risks; Financial/market risks; Operational risks; "
            "Key assumptions to validate; Severity and likelihood where evidence supports it"
        ),
    },
    {
        "section_key": "evidence_summary",
        "label": "Evidence Summary",
        "description": "Summary of supporting evidence and comparable case studies",
        "key_points": (
            "Key findings from submitted materials; Relevant case study insights; "
            "Data quality and gaps"
        ),
    },
    {
        "section_key": "open_questions",
        "label": "Open Questions",
        "description": "Outstanding questions that need to be addressed",
        "key_points": (
            "Information gaps; Diligence items; Clarifications needed; "
            "Missing assessments or variables"
        ),
    },
]

MEMO_SYSTEM_RULES = (
    "You are an expert risk analyst writing diligence memos for development initiatives "
    "(clean cooking, energy access, and related climate/development finance).\n\n"
    "PURPOSE: This memo summarizes risk and evidence for the reader's own diligence process. "
    "It is NOT an investment recommendation. Never output or imply a proceed/hold/reject "
    "decision, a buy/sell/hold call, or any directive telling the reader what to do with "
    "their money. Present risks, evidence, and open questions; let the reader draw their own "
    "conclusion.\n\n"
    "CITATION RULES:\n"
    "- Ground factual claims in provided synthesis context and retrieved sources.\n"
    "- Cite retrieved sources inline as [1], [2], etc.\n"
    "- When citing confirmed assessments, name them explicitly "
    "(e.g. 'per the approved Risk Assessment').\n"
    "- If evidence is limited, acknowledge uncertainty; do not invent facts.\n\n"
    "TONE: Professional, balanced, thorough, and neutral — analytical rather than prescriptive."
)


class MemoAssessment(BaseAssessment):
    """Memo — outline confirmation then cited, project-consistent risk-summary writeup."""

    @property
    def definition(self) -> AssessmentDefinition:
        return AssessmentDefinition(
            id="memo",
            name="Memo",
            description=(
                "Structured risk-summary memo with confirmed outline "
                "and evidence-backed citations — not an investment recommendation"
            ),
            icon="FileText",
            output_type="assessment_document",
            category="assessment",
            keywords=[
                "memo",
                "risk summary",
                "diligence memo",
                "funding",
                "grant",
                "write-up",
            ],
            export_format="docx",
        )

    @property
    def manifest(self) -> AssessmentManifest:
        return AssessmentManifest(
            **self.definition.__dict__,
            goal=(
                "Produce a risk-summary memo consistent with approved project assessments, "
                "core variables, status, and cited evidence. Not an investment recommendation."
            ),
            primary_ui_object="categorized_workspace",
            export_artifact_types=["docx"],
            adapter_bindings={"research_source": "retrieval"},
            input_dependencies=[
                "risk_assessment",
                "stakeholder_assessment",
                "landscape_mapping",
                "implementation_plan",
                "lcoe_model",
                "carbon_model",
                "solar_estimate",
            ],
            produced_outputs=["memo", "memo_citations"],
            downstream_dependencies=[],
            variables_behavior="tracks",
            evidence_behavior="rag_grounded",
            decision_log_attribution=DecisionLogAttribution(
                adapter_labels={
                    "research_source": "Project materials and research retrieval",
                },
                widget_detail_labels={
                    "sections": "Memo Outline",
                    "drafts": "Memo Drafts",
                },
            ),
        )

    @property
    def stage_defs(self) -> list[StageDef]:
        return [
            StageDef(
                id="sections",
                title="Outline",
                component="list",
                widget="categorized_list",
                allow_add_rows=True,
                fields=[
                    FieldDef("label", "text", required=True, label="Section"),
                    FieldDef("section_key", "text", label="Section Key"),
                    FieldDef("description", "long_text", label="Description"),
                    FieldDef("key_points", "long_text", label="Key Points"),
                ],
                population=[
                    PopulationStep("seed_from_template"),
                    PopulationStep(
                        "adapt_with_ai_from_project_materials",
                        {"require_citation": True},
                    ),
                    PopulationStep("await_user_confirmation"),
                ],
            ),
            StageDef(
                id="drafts",
                title="Drafts",
                component="list",
                widget="categorized_workspace",
                allow_add_rows=True,
                fields=[
                    FieldDef("title", "text", required=True, label="Section"),
                    FieldDef("category", "text", required=True, label="Outline Section"),
                    FieldDef("section_key", "text", label="Section Key"),
                    FieldDef("body", "long_text", label="Draft"),
                ],
                population=[
                    PopulationStep("read_confirmed_prior_stage", {"stage_id": "sections"}),
                    PopulationStep("extract_from_project_materials"),
                    PopulationStep("propose_with_ai", {"require_citation": True}),
                    PopulationStep("await_user_confirmation"),
                ],
            ),
        ]

    async def generate_items_for_stage(
        self,
        stage_id: str,
        step_type: str,
        context: dict,
        prior_data: dict[str, Any],
    ) -> list[dict]:
        if stage_id == "sections":
            return await self._generate_outline(context)
        if stage_id == "drafts":
            section_items = (prior_data.get("sections") or {}).get("data", {}).get("items", [])
            return await self._generate_drafts(context, section_items)
        return []

    async def generate_writeup_content(
        self,
        confirmed_stages: dict[str, Any],
        context: dict,
        *,
        previous_content: dict[str, Any] | None = None,
        change_summary: str | None = None,
    ) -> dict[str, Any]:
        """Assemble / lightly polish the memo from confirmed drafts for DOCX export."""
        draft_items = (confirmed_stages.get("drafts") or {}).get("data", {}).get("items", [])
        section_items = (confirmed_stages.get("sections") or {}).get("data", {}).get("items", [])
        synthesis = await self._synthesis_pack(context)

        drafts_text = self._format_drafts_for_prompt(draft_items)
        outline_text = self._format_outline_for_prompt(section_items)
        evidence_block, citations = await self._evidence_for_memo(context)

        system = (
            MEMO_SYSTEM_RULES
            + "\n\nReturn JSON with keys: title, executive_summary, "
            "sections (list of {theme, body}), open_questions_summary. "
            "Preserve the confirmed draft substance; polish for consistency and citation "
            "hygiene. Do not drop material findings from confirmed assessments."
        )

        user_parts = [
            f"Project: {context.get('project_title', '')}",
            f"Geography: {context.get('geography', '')}",
            f"Type: {context.get('project_type', '')}",
            "",
            "Confirmed outline:",
            outline_text or "(none)",
            "",
            "Confirmed section drafts:",
            drafts_text or "(none)",
            "",
            synthesis.get("prompt_text") or "",
            evidence_block,
        ]
        if previous_content:
            user_parts.extend(
                [
                    "",
                    f"Change context: {change_summary or 'Inputs changed'}",
                    "Previous writeup JSON:",
                    json.dumps(previous_content, default=str),
                ]
            )

        result = await llm_json(
            system=system,
            user_msg="\n".join(user_parts),
            model="gpt-4.1",
            context=context,
        )
        result = result or {}

        # Fallback assembly if the LLM returns little structure.
        if not result.get("sections") and draft_items:
            result["sections"] = [
                {
                    "theme": (item.get("content") or {}).get("title")
                    or (item.get("content") or {}).get("category")
                    or "Section",
                    "body": (item.get("content") or {}).get("body") or "",
                }
                for item in draft_items
                if isinstance(item, dict)
            ]
        if not result.get("title"):
            title = context.get("project_title") or "Project"
            result["title"] = f"Memo — {title}"
        if not result.get("executive_summary"):
            for item in draft_items:
                content = item.get("content") if isinstance(item, dict) else None
                if isinstance(content, dict) and content.get("section_key") == "executive_summary":
                    result["executive_summary"] = content.get("body") or ""
                    break

        if citations:
            result["citations"] = citations
        result["sources_used"] = synthesis.get("sources_used") or []
        result["sources_missing"] = synthesis.get("sources_missing") or []
        return result

    def export_input_fingerprint(
        self,
        confirmed_stages: dict[str, Any],
        state: dict[str, Any] | None = None,
    ) -> str:
        from app.services.assessment_export import fingerprint_payload

        return fingerprint_payload(
            {
                "sections": (confirmed_stages.get("sections") or {}).get("data"),
                "drafts": (confirmed_stages.get("drafts") or {}).get("data"),
            }
        )

    async def generate_export(self, confirmed_stages: dict[str, Any], context: dict) -> bytes:
        content = await self.generate_writeup_content(confirmed_stages, context)
        from app.services.docx_exporter import DocxExporterService

        return DocxExporterService().generate_assessment_docx(
            content=content,
            initiative_title=context.get("project_title", ""),
        )

    # ------------------------------------------------------------------ #
    # Generation helpers                                                   #
    # ------------------------------------------------------------------ #

    async def _generate_outline(self, context: dict) -> list[dict]:
        synthesis = await self._synthesis_pack(context)
        defaults_json = json.dumps(DEFAULT_MEMO_SECTIONS, indent=2)
        data = await llm_json(
            system=(
                "You are an expert at structuring risk-summary diligence memos for "
                "development finance. Adapt the default memo outline to this project. "
                "This memo summarizes risk and evidence; it does not make an investment "
                "recommendation, so do not add a recommendation/decision section. "
                "Keep all core sections unless the project clearly needs a renamed/extra "
                "section. Return JSON with key 'sections': list of objects with "
                "section_key, label, description, key_points (string)."
            ),
            user_msg=(
                f"Project: {context.get('project_title', '')}\n"
                f"Geography: {context.get('geography', '')}\n"
                f"Type: {context.get('project_type', '')}\n"
                f"Description: {context.get('project_description', '')}\n\n"
                f"{synthesis.get('prompt_text') or ''}\n\n"
                f"Default sections:\n{defaults_json}"
            ),
            context=context,
        )
        sections = data.get("sections") if isinstance(data, dict) else None
        if not isinstance(sections, list) or not sections:
            return [dict(s) for s in DEFAULT_MEMO_SECTIONS]

        by_key = {s["section_key"]: s for s in DEFAULT_MEMO_SECTIONS}
        out: list[dict] = []
        seen: set[str] = set()
        for raw in sections:
            if not isinstance(raw, dict):
                continue
            key = str(raw.get("section_key") or "").strip() or _slugify(raw.get("label") or "section")
            default = by_key.get(key, {})
            label = (raw.get("label") or default.get("label") or key.replace("_", " ").title()).strip()
            if not label:
                continue
            out.append(
                {
                    "section_key": key,
                    "label": label,
                    "description": (raw.get("description") or default.get("description") or "").strip(),
                    "key_points": (raw.get("key_points") or default.get("key_points") or "").strip(),
                }
            )
            seen.add(key)

        # Ensure core defaults remain present even if the model dropped them.
        for default in DEFAULT_MEMO_SECTIONS:
            if default["section_key"] not in seen:
                out.append(dict(default))
        return out

    async def _generate_drafts(
        self,
        context: dict,
        section_items: list[dict[str, Any]],
    ) -> list[dict]:
        synthesis = await self._synthesis_pack(context)
        outline_text = self._format_outline_for_prompt(section_items)
        evidence_block, _citations = await self._evidence_for_memo(context)

        data = await llm_json(
            system=(
                MEMO_SYSTEM_RULES
                + "\n\nWrite thorough draft bodies for each confirmed outline section. "
                "Stay consistent with approved/confirmed assessments and variables. "
                "For open_questions, explicitly include material gaps from sources_missing. "
                "Return JSON with key 'drafts': list of objects with "
                "section_key, title, category, body."
            ),
            user_msg=(
                f"Project: {context.get('project_title', '')}\n"
                f"Geography: {context.get('geography', '')}\n"
                f"Type: {context.get('project_type', '')}\n"
                f"Description: {context.get('project_description', '')}\n\n"
                f"Confirmed outline:\n{outline_text}\n\n"
                f"{synthesis.get('prompt_text') or ''}"
                f"{evidence_block}"
            ),
            model="gpt-4.1",
            context=context,
        )

        drafts = data.get("drafts") if isinstance(data, dict) else None
        if not isinstance(drafts, list) or not drafts:
            # Deterministic skeleton so the user can still edit.
            return [
                {
                    "section_key": (item.get("content") or {}).get("section_key") or "",
                    "title": (item.get("content") or {}).get("label") or "Section",
                    "category": (item.get("content") or {}).get("label") or "Section",
                    "body": "",
                }
                for item in section_items
                if isinstance(item, dict)
            ]

        outline_by_key = {}
        outline_by_label = {}
        for item in section_items:
            content = item.get("content") if isinstance(item, dict) else None
            if not isinstance(content, dict):
                continue
            key = str(content.get("section_key") or "").strip()
            label = str(content.get("label") or "").strip()
            if key:
                outline_by_key[key] = content
            if label:
                outline_by_label[label.lower()] = content

        out: list[dict] = []
        for raw in drafts:
            if not isinstance(raw, dict):
                continue
            key = str(raw.get("section_key") or "").strip()
            title = str(raw.get("title") or raw.get("label") or "").strip()
            outline = outline_by_key.get(key) or outline_by_label.get(title.lower())
            label = (
                (outline or {}).get("label")
                or title
                or key.replace("_", " ").title()
                or "Section"
            )
            section_key = key or (outline or {}).get("section_key") or _slugify(label)
            out.append(
                {
                    "section_key": section_key,
                    "title": title or label,
                    "category": label,
                    "body": str(raw.get("body") or "").strip(),
                }
            )

        # Ensure every confirmed outline section has a draft row.
        present = {d["section_key"] for d in out}
        for item in section_items:
            content = item.get("content") if isinstance(item, dict) else None
            if not isinstance(content, dict):
                continue
            key = str(content.get("section_key") or "").strip()
            label = str(content.get("label") or "Section").strip()
            if key and key not in present:
                out.append(
                    {
                        "section_key": key,
                        "title": label,
                        "category": label,
                        "body": "",
                    }
                )
        return out

    async def _synthesis_pack(self, context: dict) -> dict[str, Any]:
        db = context.get("_db")
        project_id = context.get("project_id")
        try:
            return await build_project_synthesis_context(
                db,
                project_id,
                initiative_context=context,
                exclude_assessment_id=self.definition.id,
            )
        except Exception as exc:
            logger.warning("Project synthesis failed: %s", exc)
            return {
                "prompt_text": "",
                "sources_used": [],
                "sources_missing": [],
            }

    async def _evidence_for_memo(self, context: dict) -> tuple[str, list[dict]]:
        db = context.get("_db")
        raw_pid = context.get("project_id")
        project_id: UUID | None = None
        if raw_pid:
            try:
                project_id = UUID(str(raw_pid))
            except (TypeError, ValueError):
                project_id = None

        geography = context.get("geography") or ""
        project_type = context.get("project_type") or ""
        title = context.get("project_title") or ""
        queries = [
            f"{title} risk summary {geography} {project_type}".strip(),
            f"evidence summary {title} {geography}".strip(),
            f"risks assumptions {title} {project_type} {geography}".strip(),
            f"comparable case studies {project_type} {geography}".strip(),
        ]
        queries = [q for q in queries if q]
        if not queries:
            return "", []

        try:
            context_str, citations = await retrieve_evidence(queries, db, project_id, max_facts=12)
        except Exception as exc:
            logger.warning("Memo evidence retrieval failed: %s", exc)
            return "", []

        if not context_str:
            return "", citations
        block = (
            "\n\nRetrieved sources — cite these as [1], [2] … in your text:\n"
            f"{context_str}"
        )
        return block, citations

    @staticmethod
    def _format_outline_for_prompt(section_items: list[dict[str, Any]]) -> str:
        lines: list[str] = []
        for item in section_items:
            content = item.get("content") if isinstance(item, dict) else None
            if not isinstance(content, dict):
                continue
            label = content.get("label") or content.get("section_key") or "Section"
            desc = content.get("description") or ""
            points = content.get("key_points") or ""
            lines.append(f"### {label} ({content.get('section_key') or ''})")
            if desc:
                lines.append(desc)
            if points:
                lines.append(f"Key points: {points}")
        return "\n".join(lines)

    @staticmethod
    def _format_drafts_for_prompt(draft_items: list[dict[str, Any]]) -> str:
        lines: list[str] = []
        for item in draft_items:
            content = item.get("content") if isinstance(item, dict) else None
            if not isinstance(content, dict):
                continue
            title = content.get("title") or content.get("category") or "Section"
            lines.append(f"### {title} ({content.get('section_key') or ''})")
            lines.append(content.get("body") or "")
        return "\n".join(lines)


def _slugify(value: Any) -> str:
    text = str(value or "").strip().lower()
    cleaned = "".join(ch if ch.isalnum() else "_" for ch in text).strip("_")
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    return cleaned[:80] or "section"
