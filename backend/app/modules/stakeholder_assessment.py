"""Stakeholder Assessment Module.

Two-layer Build workflow:
  outline  (simple_list)    → stakeholder categories / groupings
  details  (structured_list) → named stakeholders per category

After Details are confirmed the user clicks "Generate Output" which drafts
a full stakeholder assessment with engagement strategies and inline citations.
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


class StakeholderAssessmentModule(BaseAssessmentModule):
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
        )

    @property
    def assessment_definition(self) -> AssessmentModuleDef:
        return AssessmentModuleDef(
            setup_fields=[
                SetupFieldDef(
                    name="geography",
                    label="Geography / Location",
                    description="Where is the project located?",
                    field_type="text",
                    placeholder="e.g. Northern Ghana",
                ),
                SetupFieldDef(
                    name="sector",
                    label="Sector",
                    description="What sector does the project operate in?",
                    field_type="select",
                    options=[
                        "Energy Access",
                        "Clean Cooking",
                        "Water & Sanitation",
                        "Agriculture",
                        "Health",
                        "Education",
                        "Financial Inclusion",
                        "Other",
                    ],
                ),
            ],
            build_layers=[
                BuildLayerDef(
                    id="outline",
                    name="Outline",
                    view_type="simple_list",
                    description="High-level stakeholder categories or groupings",
                    item_schema={"title": "Stakeholder category name"},
                ),
                BuildLayerDef(
                    id="details",
                    name="Details",
                    view_type="structured_list",
                    description="Named stakeholders per category",
                    item_schema={
                        "name": "Stakeholder name",
                        "parent": "Which Outline category this belongs to",
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
                "You are helping set up a Stakeholder Assessment for a development project. "
                "Based on the project context provided, suggest sensible default values for the setup fields. "
                "Return a JSON object with keys: geography, sector. "
                "Use the project information to infer the best defaults. "
                "For geography, use this location specificity order: "
                "1) If a project country is present in the provided project materials, default to that country as the base. "
                "2) If subnational detail is also available (state/province/county/district/city/site), include it with the country "
                "for higher granularity (for example: 'Northern Region, Ghana'). "
                "3) If no country is available, fall back to the narrowest credible broader region. "
                "Do not return a broad region when a country is available. "
                "If a field cannot be inferred, return an empty string."
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
                "You are an expert stakeholder analyst. Generate 5–8 stakeholder categories "
                "for the given project. Each category is a distinct group of stakeholders. "
                "Return JSON with key 'categories', a list of objects with 'title' only (no description)."
            ),
            user_msg=(
                f"Project: {context.get('project_title', 'Unknown')}\n"
                f"Geography: {setup.get('geography', '')}\n"
                f"Sector: {setup.get('sector', '')}\n"
                f"Assessment scope: {setup.get('assessment_scope', '')}\n"
                f"Project description: {context.get('project_description', '')}"
            ),
        )
        return [
            make_build_item(
                content={"title": c.get("title", "")},
                derivation="inferred",
                rationale="Generated from project context",
            )
            for c in data.get("categories", [])
        ]

    async def _generate_details(
        self, setup: dict, outline_items: list[dict], context: dict
    ) -> list[dict]:
        categories = [item["content"].get("title", "") for item in outline_items]
        categories_list = "\n".join(f"- {c}" for c in categories)
        data = await llm_json(
            system=(
                "You are an expert stakeholder analyst. For each stakeholder category listed, identify 3–5 "
                "specific stakeholders that belong to that category. "
                "Each item must have 'name' (the stakeholder name) and 'parent' (exactly matching one category title). "
                "Return JSON with key 'stakeholders', a flat list. Do not add roles, types, or relevance scores."
            ),
            user_msg=(
                f"Project: {context.get('project_title', 'Unknown')}\n"
                f"Geography: {setup.get('geography', '')}\n"
                f"Sector: {setup.get('sector', '')}\n"
                f"Stakeholder categories:\n{categories_list}"
            ),
        )
        return [
            make_build_item(
                content={
                    "name": s.get("name", ""),
                    "parent": s.get("parent", ""),
                },
                derivation="inferred",
                rationale="Inferred from project context and stakeholder categories",
            )
            for s in data.get("stakeholders", [])
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

        categories = [i["content"].get("title", "") for i in outline_items]
        by_category: dict[str, list[str]] = {c: [] for c in categories}
        for item in details_items:
            parent = item["content"].get("parent", "")
            name = item["content"].get("name", "")
            if parent in by_category:
                by_category[parent].append(name)
            else:
                by_category.setdefault("Other", []).append(name)

        outline_text = "\n".join(
            f"### {cat}\n" + "\n".join(f"  - {s}" for s in by_category.get(cat, []))
            for cat in categories
        )

        # Retrieve real evidence — query per category + a general engagement query
        geography = setup_fields.get("geography", "")
        sector = setup_fields.get("sector", "")
        queries = [
            f"{cat} stakeholder {geography} {sector}".strip()
            for cat in categories[:5]
        ] + ([f"stakeholder engagement {sector} {geography}"] if sector or geography else [])

        context_str, citations = await self._retrieve_evidence(queries, db, initiative_id)

        evidence_block = (
            f"\n\nRetrieved sources — cite these as [1], [2] … in your text:\n{context_str}"
            if context_str else ""
        )

        result = await llm_json(
            system=(
                "You are a senior stakeholder engagement specialist producing a professional assessment "
                "for a development project team. Using the confirmed stakeholder categories, named "
                "stakeholders, and retrieved sources, write a full stakeholder assessment. The report must:\n"
                "  • Include an Executive Summary (3–5 sentences)\n"
                "  • Have a section per stakeholder category with 2–3 analytical paragraphs covering "
                "    each named stakeholder's likely interests, influence, stance, and engagement "
                "    considerations. Where retrieved sources support a point, cite them as [1], [2], etc.\n"
                "  • Include an Engagement Strategy section with priority actions\n"
                "  • End with Risk Considerations (key risks if stakeholders are not engaged)\n"
                "  • Use professional language appropriate for a funding proposal or project brief\n\n"
                "Return JSON with keys:\n"
                "  title (string),\n"
                "  executive_summary (string),\n"
                "  sections (list of {category, body} objects — one per outline category),\n"
                "  engagement_strategy (string),\n"
                "  risk_considerations (string)"
            ),
            user_msg=(
                f"Project: Geography={geography}, Sector={sector}\n\n"
                f"Stakeholder outline:\n{outline_text}"
                f"{evidence_block}"
            ),
            model="gpt-4.1",
        )
        result = result or {"title": "Stakeholder Assessment"}
        if citations:
            result["citations"] = citations
        return result
