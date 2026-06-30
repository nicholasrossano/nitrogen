"""Landscape Mapping Assessment.

Stage workflow:
  1. Categories  (list / categorized_list)
  2. Entities    (list / categorized_workspace)
  3. Map         (computed_results / assessment_map)

Exports:
  - Write-up DOCX: LLM-generated, cached in workflow_state after first generation.
  - Decision Log DOCX: deterministic extraction, no LLM, always fast.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from app.assessments.base import BaseAssessment, FieldDef, PopulationStep, StageDef, AssessmentDefinition, AssessmentManifest
from app.assessments.retrieval import retrieve_evidence
from app.assessments.utils import llm_json, infer_category_icon
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class LandscapeMappingAssessment(BaseAssessment):
    """Landscape Mapping — map the ecosystem of actors, initiatives and dynamics around a project."""

    @property
    def definition(self) -> AssessmentDefinition:
        return AssessmentDefinition(
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
    def manifest(self) -> AssessmentManifest:
        return AssessmentManifest(
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
            StageDef(
                id="map",
                title="Map",
                component="computed_results",
                widget="assessment_map",
                population=[
                    PopulationStep("read_confirmed_prior_stage", {"stage_id": "entities"}),
                    PopulationStep("compute_with_assessment_logic"),
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

    async def compute_stage(
        self,
        stage_id: str,
        confirmed_stages: dict[str, Any],
        context: dict,
    ) -> dict[str, Any]:
        """Build the assessment_map widget_data from confirmed themes + entities."""
        if stage_id != "map":
            raise ValueError(f"compute_stage called for unexpected stage '{stage_id}'")

        theme_items = (confirmed_stages.get("themes") or {}).get("data", {}).get("items", [])
        entity_items = (confirmed_stages.get("entities") or {}).get("data", {}).get("items", [])

        pillar_colors = [
            "#005e72", "#6b3fa0", "#1a7340", "#c05621",
            "#1d4ed8", "#92400e", "#065f46", "#7e22ce",
        ]
        groups = []
        for idx, theme_item in enumerate(theme_items):
            content = theme_item.get("content", {})
            label = content.get("label", "")
            if not label:
                continue
            icon = content.get("icon", "Compass")
            color = pillar_colors[idx % len(pillar_colors)]

            theme_entities = [
                e for e in entity_items
                if e.get("content", {}).get("category", "") == label
            ]
            items = [
                {
                    "id": e.get("id", ""),
                    "name": e.get("content", {}).get("name", ""),
                    "description": e.get("content", {}).get("description", ""),
                    "category": label,
                    "provenance": e.get("provenance", {}),
                }
                for e in theme_entities
            ]
            groups.append({
                "id": theme_item.get("id", ""),
                "label": label,
                "icon": icon,
                "color": color,
                "items": items,
            })

        return {"groups": groups, "assessment_id": "landscape_mapping"}

    async def generate_writeup_content(
        self,
        confirmed_stages: dict[str, Any],
        context: dict,
    ) -> dict[str, Any]:
        """Generate the write-up as a JSON dict (cacheable). Called by the export endpoint."""
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
        queries = [f"{theme} {region} {sector}".strip() for theme in themes[:6]]
        context_str, citations = await retrieve_evidence(queries, None, None)
        evidence_block = (
            f"\n\nRetrieved sources — cite as [1], [2] … inline:\n{context_str}"
            if context_str else ""
        )

        result = await llm_json(
            system=(
                "You are a senior landscape analyst producing a professional report. "
                "Write a woven, prosaic landscape mapping document — NOT a list of sections for each entity. "
                "Weave findings across categories into coherent analytical prose:\n"
                "  • Executive Summary (3–5 sentences)\n"
                "  • 3–5 thematic sections combining insights across categories (not one-per-category). "
                "    Cite sources as [1], [2], etc.\n"
                "  • Strategic Implications and Recommendations\n\n"
                "Return JSON with keys: title, executive_summary, "
                "sections (list of {heading, body}), strategic_implications, recommendations"
            context=context,
            ),
            user_msg=(
                f"Project: Region={region}, Type={sector}\n\n"
                f"Confirmed landscape:\n{outline_text}"
                f"{evidence_block}"
            ),
            model="gpt-4.1",
        )
        result = result or {"title": "Landscape Mapping"}
        if citations:
            result["citations"] = citations
        return result

    async def generate_export(self, confirmed_stages: dict[str, Any], context: dict) -> bytes:
        content = await self.generate_writeup_content(confirmed_stages, context)
        from app.services.docx_exporter import DocxExporterService
        return DocxExporterService().generate_assessment_docx(
            content=content,
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
            context=context,
            ),
            user_msg=(
                f"Region: {context.get('geography', '')}\n"
                f"Project type / sector: {context.get('project_type', '')}\n"
                f"Project description: {context.get('project_description', '')}"
            ),
        )
        return [
            {
                "label": t.get("label", t.get("title", "")),
                "description": t.get("description", ""),
                "icon": infer_category_icon(t.get("label", t.get("title", ""))),
            }
            for t in data.get("categories", [])
        ]

    async def _generate_entities(self, context: dict, theme_items: list[dict]) -> list[dict]:
        themes = [i["content"].get("label", "").strip() for i in theme_items if i["content"].get("label", "").strip()]
        if not themes:
            return []
        themes_list = "\n".join(f"- {t}" for t in themes)
        data = await llm_json(
            system=(
                "You are a landscape researcher. For each category listed, identify 3–5 specific "
                "organisations, programmes, policies, technologies, or trends. Each item must have "
                "'name' and 'category' (exactly matching one category label). "
                "Do not skip categories. Ensure every category has at least 3 items. "
                "Return JSON with key 'entities', a flat list."
            context=context,
            ),
            user_msg=(
                f"Region: {context.get('geography', '')}\n"
                f"Project type / sector: {context.get('project_type', '')}\n"
                f"Categories:\n{themes_list}"
            ),
        )

        entities_by_theme = self._bucket_entities(data.get("entities", []), themes)

        min_per_theme = 3
        underfilled = [t for t in themes if len(entities_by_theme.get(t, [])) < min_per_theme]
        if underfilled:
            shortfalls = "\n".join(
                f"- {t}: need at least {min_per_theme - len(entities_by_theme.get(t, []))} more"
                for t in underfilled
            )
            existing = "\n".join(
                f"- {t}: {', '.join(e['name'] for e in entities_by_theme.get(t, [])) or '(none)'}"
                for t in themes
            )
            refill = await llm_json(
                system=(
                    "You are a landscape researcher. Fill only missing entities for underfilled categories. "
                    "Return JSON with key 'entities' as a flat list of objects with 'name' and 'category'. "
                    "Category values must exactly match one listed category."
                context=context,
                ),
                user_msg=(
                    f"Region: {context.get('geography', '')}\n"
                    f"Project type / sector: {context.get('project_type', '')}\n"
                    f"All categories:\n{themes_list}\n\n"
                    f"Existing entities by category:\n{existing}\n\n"
                    f"Underfilled categories:\n{shortfalls}"
                ),
            )
            refill_bucket = self._bucket_entities(refill.get("entities", []), themes)
            for theme in themes:
                existing_names = {e["name"].strip().lower() for e in entities_by_theme.get(theme, [])}
                for entity in refill_bucket.get(theme, []):
                    key = entity["name"].strip().lower()
                    if key not in existing_names:
                        entities_by_theme.setdefault(theme, []).append(entity)
                        existing_names.add(key)

        output: list[dict] = []
        for theme in themes:
            output.extend(entities_by_theme.get(theme, [])[:6])
        return output

    @staticmethod
    def _normalize_category(raw_category: str, categories: list[str]) -> str:
        raw = (raw_category or "").strip()
        if not raw:
            return ""
        if raw in categories:
            return raw

        lowered_map = {c.lower(): c for c in categories}
        if raw.lower() in lowered_map:
            return lowered_map[raw.lower()]

        raw_norm = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", raw.lower())).strip()
        for category in categories:
            cat_norm = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", category.lower())).strip()
            if raw_norm and cat_norm and (raw_norm in cat_norm or cat_norm in raw_norm):
                return category
        return ""

    def _bucket_entities(self, raw_entities: list[dict], categories: list[str]) -> dict[str, list[dict]]:
        buckets: dict[str, list[dict]] = {c: [] for c in categories}
        seen: set[tuple[str, str]] = set()

        for entity in raw_entities or []:
            name = (entity.get("name") or "").strip()
            category = self._normalize_category(
                entity.get("category", entity.get("parent", "")),
                categories,
            )
            if not name or not category:
                continue
            dedupe_key = (category, name.lower())
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            buckets[category].append(
                {
                    "name": name,
                    "category": category,
                    "description": (entity.get("description") or "").strip(),
                }
            )

        return buckets
