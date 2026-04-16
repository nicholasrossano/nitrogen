"""Landscape Mapping Module.

Stage workflow:
  1. Categories  (list / categorized_list)
  2. Entities    (list / categorized_workspace)

Export: DOCX generated on demand from confirmed stage data.
"""

from __future__ import annotations

import logging
from typing import Any

from app.modules.base import BaseModule, FieldDef, PopulationStep, StageDef, ModuleDefinition, ModuleManifest
from app.modules.retrieval import retrieve_evidence
from app.modules.utils import llm_json
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class LandscapeMappingModule(BaseModule):
    """Landscape Mapping — map the ecosystem of actors, initiatives and dynamics around a project."""

    @property
    def definition(self) -> ModuleDefinition:
        return ModuleDefinition(
            id="landscape_mapping",
            name="Landscape Mapping",
            description="Map the ecosystem of actors, initiatives, and dynamics relevant to your project",
            icon="Map",
            output_type="assessment_document",
            category="assessment",
            keywords=["landscape", "ecosystem", "mapping", "market", "actors", "initiatives", "context"],
            export_format="docx",
        )

    @property
    def manifest(self) -> ModuleManifest:
        return ModuleManifest(
            **self.definition.__dict__,
            goal="Generate a landscape map of ecosystem categories, entities, and strategic implications.",
            primary_ui_object="categorized_workspace",
            export_artifact_types=["docx"],
            adapter_bindings={"research_source": "retrieval"},
            input_dependencies=[],
            produced_outputs=["landscape_categories", "landscape_recommendations"],
            downstream_dependencies=[],
            assumptions_behavior="tracks",
            evidence_behavior="rag_grounded",
        )

    @property
    def stage_defs(self) -> list[StageDef]:
        return [
            StageDef(
                id="themes",
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
                id="entities",
                title="Entities",
                component="list",
                widget="categorized_workspace",
                fields=[
                    FieldDef("name", "text", required=True, label="Name"),
                    FieldDef("category", "text", required=True, label="Category"),
                    FieldDef("description", "long_text", label="Description"),
                ],
                population=[
                    PopulationStep("read_confirmed_prior_stage", {"stage_id": "themes"}),
                    PopulationStep("extract_from_project_materials"),
                    PopulationStep("propose_with_ai", {"require_citation": True}),
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
        if stage_id == "themes":
            return await self._generate_themes(context)
        elif stage_id == "entities":
            prior_themes = (prior_data.get("themes") or {}).get("data", {}).get("items", [])
            return await self._generate_entities(context, prior_themes)
        return []

    async def generate_export(self, confirmed_stages: dict[str, Any], context: dict) -> bytes:
        theme_items = (confirmed_stages.get("themes") or {}).get("data", {}).get("items", [])
        entity_items = (confirmed_stages.get("entities") or {}).get("data", {}).get("items", [])

        themes = [i["content"].get("label", "") for i in theme_items]
        by_theme: dict[str, list[str]] = {t: [] for t in themes}
        for item in entity_items:
            cat = item["content"].get("category", "")
            name = item["content"].get("name", "")
            if cat in by_theme:
                by_theme[cat].append(name)
            else:
                by_theme.setdefault("Other", []).append(name)

        outline_text = "\n".join(
            f"### {theme}\n" + "\n".join(f"  - {e}" for e in by_theme.get(theme, []))
            for theme in themes
        )

        region = context.get("geography", "")
        sector = context.get("project_type", "")
        queries = [
            f"{theme} {region} {sector}".strip()
            for theme in themes[:6]
        ]
        context_str, citations = await retrieve_evidence(queries, None, None)
        evidence_block = (
            f"\n\nRetrieved sources — cite as [1], [2] … inline:\n{context_str}"
            if context_str else ""
        )

        result = await llm_json(
            system=(
                "You are a senior landscape analyst producing a professional report. "
                "Using the confirmed categories, entities, and retrieved sources, write a full "
                "landscape mapping report:\n"
                "  • Executive Summary (3–5 sentences)\n"
                "  • One section per category with 2–3 analytical paragraphs. Cite as [1], [2], etc.\n"
                "  • Strategic Implications and Recommendations\n\n"
                "Return JSON with keys: title, executive_summary, "
                "sections (list of {category, body}), strategic_implications, recommendations"
            ),
            user_msg=(
                f"Project: Region={region}, Type={sector}\n\n"
                f"Outline with entities:\n{outline_text}"
                f"{evidence_block}"
            ),
            model="gpt-4.1",
        )
        result = result or {"title": "Landscape Mapping"}
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

    async def _generate_themes(self, context: dict) -> list[dict]:
        data = await llm_json(
            system=(
                "You are a landscape analysis expert. Generate 5–8 high-level categories or dimensions "
                "for a landscape mapping assessment. Return JSON with key 'categories', a list of objects "
                "with 'label' (no descriptions needed)."
            ),
            user_msg=(
                f"Region: {context.get('geography', '')}\n"
                f"Project type / sector: {context.get('project_type', '')}\n"
                f"Project description: {context.get('project_description', '')}"
            ),
        )
        return [
            {"label": t.get("label", t.get("title", "")), "description": t.get("description", "")}
            for t in data.get("categories", [])
        ]

    async def _generate_entities(self, context: dict, theme_items: list[dict]) -> list[dict]:
        themes = [i["content"].get("label", "") for i in theme_items]
        themes_list = "\n".join(f"- {t}" for t in themes)
        data = await llm_json(
            system=(
                "You are a landscape researcher. For each category listed, identify 3–5 specific "
                "organisations, programmes, policies, technologies, or trends. Each item must have "
                "'name' and 'category' (exactly matching one category label). "
                "Return JSON with key 'entities', a flat list."
            ),
            user_msg=(
                f"Region: {context.get('geography', '')}\n"
                f"Project type / sector: {context.get('project_type', '')}\n"
                f"Categories:\n{themes_list}"
            ),
        )
        return [
            {"name": e.get("name", ""), "category": e.get("category", e.get("parent", "")), "description": ""}
            for e in data.get("entities", [])
        ]
