"""Landscape Mapping Module.

Two-layer Build workflow:
  outline  (simple_list)    → high-level themes / categories in the landscape
  details  (structured_list) → specific entities per theme (grouped by outline item)

After Details are confirmed the user clicks "Generate Output" which drafts
a full write-up from both layers with citations and analysis.
"""

from __future__ import annotations

import json
import logging
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.base import ModuleDefinition
from app.modules.assessment_base import (
    AssessmentModuleDef,
    BaseAssessmentModule,
    BuildLayerDef,
    SetupFieldDef,
    make_build_item,
    llm_json,
)
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class LandscapeMappingModule(BaseAssessmentModule):
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
        )

    @property
    def assessment_definition(self) -> AssessmentModuleDef:
        return AssessmentModuleDef(
            setup_fields=[
                SetupFieldDef(
                    name="region",
                    label="Region",
                    description="Geographic focus of the landscape mapping",
                    field_type="text",
                    placeholder="e.g. Sub-Saharan Africa, East Africa, Kenya",
                ),
                SetupFieldDef(
                    name="project_type",
                    label="Project Type",
                    description="The technology or sector being mapped",
                    field_type="select",
                    options=[
                        "Mini Grids",
                        "Solar Home Systems",
                        "Clean Cooking",
                        "Productive Use Appliances",
                        "Water & Sanitation",
                        "Agriculture & Food",
                        "Health",
                        "Climate Finance",
                        "Other",
                    ],
                ),
            ],
            build_layers=[
                BuildLayerDef(
                    id="outline",
                    name="Outline",
                    view_type="simple_list",
                    description="High-level themes or dimensions that structure the landscape",
                    item_schema={"title": "Theme or dimension name"},
                ),
                BuildLayerDef(
                    id="details",
                    name="Details",
                    view_type="structured_list",
                    description="Specific entities, initiatives, or actors per theme",
                    item_schema={
                        "name": "Entity / initiative name",
                        "parent": "Which Outline theme this belongs to",
                    },
                ),
            ],
            output_type="assessment_document",
        )

    async def generate_setup_defaults(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        context: dict,
    ) -> dict:
        return await llm_json(
            system=(
                "You are helping set up a Landscape Mapping assessment for a development project. "
                "Based on the project context provided, suggest values for: region and project_type. "
                "Return a JSON object with those two keys only. "
                "For region, use this location specificity order: "
                "1) If a project country is present in the provided project materials, default to that country as the base. "
                "2) If subnational detail is also available (state/province/county/district/city/site), include it with the country "
                "for higher granularity (for example: 'Turkana County, Kenya'). "
                "3) If no country is available, fall back to the narrowest credible broader region (for example: 'East Africa'). "
                "Do not return a broad region when a country is available. "
                "For project_type choose the best match from: Mini Grids, Solar Home Systems, "
                "Clean Cooking, Productive Use Appliances, Water & Sanitation, Agriculture & Food, "
                "Health, Climate Finance, Other."
            ),
            user_msg=f"Project context:\n{json.dumps(context, indent=2)}",
        )

    async def generate_layer(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        layer_id: str,
        setup_fields: dict,
        prior_layers: dict,
        context: dict,
    ) -> list[dict]:
        if layer_id == "outline":
            return await self._generate_outline(setup_fields, context)
        elif layer_id == "details":
            outline_items = prior_layers.get("outline", {}).get("items", [])
            return await self._generate_details(setup_fields, outline_items, context)
        else:
            logger.warning(f"Unknown layer_id: {layer_id}")
            return []

    async def _generate_outline(self, setup: dict, context: dict) -> list[dict]:
        data = await llm_json(
            system=(
                "You are a landscape analysis expert. Generate 5–8 high-level themes or dimensions "
                "for a landscape mapping assessment. Each theme is a distinct lens on the ecosystem. "
                "Return JSON with key 'themes', a list of objects with 'title' only (no description)."
            ),
            user_msg=(
                f"Region: {setup.get('region', '')}\n"
                f"Project type / sector: {setup.get('project_type', '')}\n"
                f"Project description: {context.get('project_description', '')}"
            ),
        )
        return [
            make_build_item(
                content={"title": t.get("title", "")},
                derivation="inferred",
                rationale="Generated from project context",
            )
            for t in data.get("themes", [])
        ]

    async def _generate_details(
        self, setup: dict, outline_items: list[dict], context: dict
    ) -> list[dict]:
        themes = [item["content"].get("title", "") for item in outline_items]
        themes_list = "\n".join(f"- {t}" for t in themes)
        data = await llm_json(
            system=(
                "You are a landscape researcher. For each theme listed, identify 3–5 specific "
                "organisations, programmes, policies, technologies, or trends that belong to that theme. "
                "Each item must have 'name' (the entity name) and 'parent' (exactly matching one theme title). "
                "Return JSON with key 'entities', a flat list. Do not add descriptions, types, or relevance scores."
            ),
            user_msg=(
                f"Region: {setup.get('region', '')}\n"
                f"Project type / sector: {setup.get('project_type', '')}\n"
                f"Themes:\n{themes_list}"
            ),
        )
        return [
            make_build_item(
                content={
                    "name": e.get("name", ""),
                    "parent": e.get("parent", ""),
                },
                derivation="inferred",
                rationale="Mapped from landscape themes",
            )
            for e in data.get("entities", [])
        ]

    async def generate_output(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        setup_fields: dict,
        confirmed_build: dict,
    ) -> dict:
        outline_items = confirmed_build.get("outline", {}).get("items", [])
        details_items = confirmed_build.get("details", {}).get("items", [])

        themes = [i["content"].get("title", "") for i in outline_items]
        by_theme: dict[str, list[str]] = {t: [] for t in themes}
        for item in details_items:
            parent = item["content"].get("parent", "")
            name = item["content"].get("name", "")
            if parent in by_theme:
                by_theme[parent].append(name)
            else:
                by_theme.setdefault("Other", []).append(name)

        outline_text = "\n".join(
            f"### {theme}\n" + "\n".join(f"  - {e}" for e in by_theme.get(theme, []))
            for theme in themes
        )

        # Retrieve real evidence — one query per theme (cap at 6 themes to avoid rate limits)
        region = setup_fields.get("region", "")
        sector = setup_fields.get("project_type", "")
        queries = [
            f"{theme} {region} {sector}".strip()
            for theme in themes[:6]
        ]
        context_str, citations = await self._retrieve_evidence(queries, db, initiative_id)

        evidence_block = (
            f"\n\nRetrieved sources — cite these as [1], [2] … in your text:\n{context_str}"
            if context_str else ""
        )

        result = await llm_json(
            system=(
                "You are a senior landscape analyst producing a professional report for a development "
                "project team. Using the confirmed outline, listed entities, and retrieved sources, "
                "write a full landscape mapping report. The report must:\n"
                "  • Follow the outline structure theme by theme\n"
                "  • For each theme, describe the landscape in 2–3 analytical paragraphs. Where "
                "    retrieved sources are available, cite them inline as [1], [2], etc.\n"
                "  • Include an Executive Summary (3–5 sentences)\n"
                "  • End with Strategic Implications and Recommendations for the project\n"
                "  • Use professional, factual language appropriate for a funding proposal audience\n\n"
                "Return JSON with keys:\n"
                "  title (string),\n"
                "  executive_summary (string),\n"
                "  sections (list of {theme, body} objects — one per outline theme),\n"
                "  strategic_implications (string),\n"
                "  recommendations (string)"
            ),
            user_msg=(
                f"Project: {_context_str(setup_fields)}\n\n"
                f"Outline with entities:\n{outline_text}"
                f"{evidence_block}"
            ),
            model="gpt-4.1",
        )
        result = result or {"title": "Landscape Mapping"}
        if citations:
            result["citations"] = citations
        return result


def _context_str(setup_fields: dict) -> str:
    return (
        f"Region={setup_fields.get('region', '')}, "
        f"Project Type={setup_fields.get('project_type', '')}"
    )
