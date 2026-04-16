"""Stakeholder Assessment Module.

Stage workflow:
  1. Stakeholder Categories  (list / categorized_list)
  2. Stakeholders            (list / categorized_workspace)
  3. Stakeholder Details     (record / categorized_workspace)

Export: DOCX generated on demand from confirmed stage data.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.base import BaseModule, FieldDef, PopulationStep, StageDef, ModuleDefinition, ModuleManifest
from app.modules.retrieval import retrieve_evidence
from app.modules.utils import llm_json
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class StakeholderAssessmentModule(BaseModule):
    """Stakeholder Assessment — map and profile key stakeholders for a project."""

    @property
    def definition(self) -> ModuleDefinition:
        return ModuleDefinition(
            id="stakeholder_assessment",
            name="Stakeholder Assessment",
            description="Identify, map, and profile key stakeholders for your project",
            icon="Users",
            output_type="assessment_document",
            category="assessment",
            keywords=["stakeholder", "actor", "mapping", "engagement", "community"],
            export_format="docx",
        )

    @property
    def manifest(self) -> ModuleManifest:
        return ModuleManifest(
            **self.definition.__dict__,
            goal="Produce a stakeholder assessment with engagement strategy and cited evidence.",
            primary_ui_object="categorized_workspace",
            export_artifact_types=["docx"],
            adapter_bindings={"research_source": "retrieval"},
            input_dependencies=[],
            produced_outputs=["stakeholder_map", "engagement_strategy"],
            downstream_dependencies=[],
            assumptions_behavior="tracks",
            evidence_behavior="rag_grounded",
        )

    @property
    def stage_defs(self) -> list[StageDef]:
        return [
            StageDef(
                id="categories",
                title="Categories",
                component="list",
                widget="categorized_list",
                fields=[
                    FieldDef("label", "text", required=True, label="Category"),
                    FieldDef("description", "long_text", label="Description"),
                ],
                population=[
                    PopulationStep("seed_from_template"),
                    PopulationStep("adapt_with_ai_from_project_materials", {"require_citation": True}),
                    PopulationStep("await_user_confirmation"),
                ],
            ),
            StageDef(
                id="stakeholders",
                title="Stakeholders",
                component="list",
                widget="categorized_workspace",
                fields=[
                    FieldDef("name", "text", required=True, label="Name"),
                    FieldDef("category", "text", required=True, label="Category"),
                    FieldDef("why_they_matter", "long_text", label="Why they matter"),
                ],
                population=[
                    PopulationStep("read_confirmed_prior_stage", {"stage_id": "categories"}),
                    PopulationStep("extract_from_project_materials"),
                    PopulationStep("propose_with_ai", {"require_citation": True}),
                    PopulationStep("await_user_confirmation"),
                ],
            ),
            StageDef(
                id="details",
                title="Stakeholder Details",
                component="record",
                widget="categorized_workspace",
                fields=[
                    FieldDef("role_in_project", "long_text", label="Role in project"),
                    FieldDef("influence_level", "select", label="Influence",
                             options=["Low", "Medium", "High"]),
                    FieldDef("impact_level", "select", label="Impact",
                             options=["Low", "Medium", "High"]),
                    FieldDef("engagement_priority", "select", label="Priority",
                             options=["Monitor", "Inform", "Consult", "Collaborate"]),
                    FieldDef("notes", "long_text", label="Notes"),
                ],
                population=[
                    PopulationStep("read_confirmed_prior_stage", {"stage_id": "stakeholders"}),
                    PopulationStep("enrich_selected_item_with_ai", {"require_citation": True}),
                    PopulationStep("await_user_confirmation"),
                ],
            ),
        ]

    # ------------------------------------------------------------------ #
    # Population hooks                                                     #
    # ------------------------------------------------------------------ #

    async def generate_items_for_stage(
        self,
        stage_id: str,
        step_type: str,
        context: dict,
        prior_data: dict[str, Any],
    ) -> list[dict]:
        if stage_id == "categories":
            return await self._generate_categories(context)
        elif stage_id == "stakeholders":
            prior_cats = (prior_data.get("categories") or {}).get("data", {}).get("items", [])
            return await self._generate_stakeholders(context, prior_cats)
        return []

    async def enrich_record(
        self,
        stage_id: str,
        item_content: dict,
        existing_record: dict,
        context: dict,
    ) -> dict:
        if stage_id != "details":
            raise ValueError(f"enrich_record called for unexpected stage '{stage_id}'")
        return await self._enrich_stakeholder_detail(item_content, existing_record, context)

    async def generate_export(self, confirmed_stages: dict[str, Any], context: dict) -> bytes:
        category_items = (confirmed_stages.get("categories") or {}).get("data", {}).get("items", [])
        stakeholder_items = (confirmed_stages.get("stakeholders") or {}).get("data", {}).get("items", [])
        records = (confirmed_stages.get("details") or {}).get("data", {}).get("records", {})

        categories = [i["content"].get("label", "") for i in category_items]
        by_category: dict[str, list[str]] = {c: [] for c in categories}
        for item in stakeholder_items:
            cat = item["content"].get("category", "")
            name = item["content"].get("name", "")
            by_category.setdefault(cat, []).append(name)

        outline_text = "\n".join(
            f"### {cat}\n" + "\n".join(f"  - {s}" for s in by_category.get(cat, []))
            for cat in categories
        )

        geography = context.get("geography", "")
        project_type = context.get("project_type", "")
        queries = [
            f"{cat} stakeholder {geography} {project_type}".strip()
            for cat in categories[:5]
        ] + ([f"stakeholder engagement {project_type} {geography}"] if project_type or geography else [])

        context_str, citations = await retrieve_evidence(queries, None, None)

        evidence_block = (
            f"\n\nRetrieved sources — cite these as [1], [2] … in your text:\n{context_str}"
            if context_str else ""
        )

        result = await llm_json(
            system=(
                "You are a senior stakeholder engagement specialist producing a professional assessment. "
                "Using the confirmed stakeholder categories and named stakeholders, write a full "
                "stakeholder assessment. Include:\n"
                "  • Executive Summary (3–5 sentences)\n"
                "  • One section per category with analytical paragraphs covering interests, influence, "
                "    stance, and engagement considerations. Cite sources as [1], [2], etc.\n"
                "  • Engagement Strategy section with priority actions\n"
                "  • Risk Considerations\n\n"
                "Return JSON with keys: title, executive_summary, sections (list of {category, body}), "
                "engagement_strategy, risk_considerations"
            ),
            user_msg=(
                f"Project: Geography={geography}, Type={project_type}\n\n"
                f"Stakeholder outline:\n{outline_text}"
                f"{evidence_block}"
            ),
            model="gpt-4.1",
        )
        result = result or {"title": "Stakeholder Assessment"}
        if citations:
            result["citations"] = citations

        from app.services.docx_exporter import DocxExporterService
        exporter = DocxExporterService()
        return exporter.generate_assessment_docx(
            content=result,
            initiative_title=context.get("project_title", ""),
        )

    # ------------------------------------------------------------------ #
    # Private generation helpers                                           #
    # ------------------------------------------------------------------ #

    async def _generate_categories(self, context: dict) -> list[dict]:
        data = await llm_json(
            system=(
                "You are an expert stakeholder analyst. Generate 5–8 stakeholder categories "
                "for the given project. Each category is a distinct group of stakeholders. "
                "Return JSON with key 'categories', a list of objects with 'label' and optional 'description'."
            ),
            user_msg=(
                f"Project: {context.get('project_title', 'Unknown')}\n"
                f"Geography: {context.get('geography', '')}\n"
                f"Project type: {context.get('project_type', '')}\n"
                f"Description: {context.get('project_description', '')}"
            ),
        )
        return [
            {"label": c.get("label", c.get("title", "")), "description": c.get("description", "")}
            for c in data.get("categories", [])
        ]

    async def _generate_stakeholders(self, context: dict, category_items: list[dict]) -> list[dict]:
        categories = [i["content"].get("label", i["content"].get("title", "")) for i in category_items]
        categories_list = "\n".join(f"- {c}" for c in categories)
        data = await llm_json(
            system=(
                "You are an expert stakeholder analyst. For each stakeholder category listed, "
                "identify 3–5 specific stakeholders. Each item must have 'name', 'category' "
                "(exactly matching one category label), and 'why_they_matter'. "
                "Return JSON with key 'stakeholders', a flat list."
            ),
            user_msg=(
                f"Project: {context.get('project_title', 'Unknown')}\n"
                f"Geography: {context.get('geography', '')}\n"
                f"Project type: {context.get('project_type', '')}\n"
                f"Stakeholder categories:\n{categories_list}"
            ),
        )
        return [
            {
                "name": s.get("name", ""),
                "category": s.get("category", ""),
                "why_they_matter": s.get("why_they_matter", ""),
            }
            for s in data.get("stakeholders", [])
        ]

    async def _enrich_stakeholder_detail(
        self,
        item_content: dict,
        existing_record: dict,
        context: dict,
    ) -> dict:
        data = await llm_json(
            system=(
                "You are an expert stakeholder analyst. Enrich the stakeholder detail record. "
                "Return JSON with keys: role_in_project, influence_level (Low/Medium/High), "
                "impact_level (Low/Medium/High), engagement_priority (Monitor/Inform/Consult/Collaborate), "
                "notes."
            ),
            user_msg=(
                f"Stakeholder: {item_content.get('name', '')}\n"
                f"Category: {item_content.get('category', '')}\n"
                f"Why they matter: {item_content.get('why_they_matter', '')}\n"
                f"Project: {context.get('project_title', '')}, "
                f"Geography: {context.get('geography', '')}"
            ),
        )
        return {
            "role_in_project": data.get("role_in_project", existing_record.get("role_in_project", "")),
            "influence_level": data.get("influence_level", existing_record.get("influence_level", "")),
            "impact_level": data.get("impact_level", existing_record.get("impact_level", "")),
            "engagement_priority": data.get("engagement_priority", existing_record.get("engagement_priority", "")),
            "notes": data.get("notes", existing_record.get("notes", "")),
        }
