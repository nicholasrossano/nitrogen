"""Monitoring, Evaluation & Learning (MEL) Plan Module.

Three-layer Build workflow:
  dimensions   (simple_list)    → result chain levels or thematic impact dimensions
  indicators   (structured_list) → indicators per dimension
  data_plan    (structured_list) → data collection details per indicator

After Data Plan layer is confirmed, "Generate Output" drafts the full MEL
plan as a results framework with per-dimension sections and inline citations.
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


class MELPlanModule(BaseAssessmentModule):
    """Monitoring, Evaluation & Learning Plan — results framework for grant/DFI reporting."""

    @property
    def definition(self) -> ModuleDefinition:
        return ModuleDefinition(
            id="mel_plan",
            name="Monitoring, Evaluation & Learning Plan",
            description="Build a results framework with indicators and data collection plan for funders",
            icon="BarChart2",
            output_type="assessment_document",
            category="assessment",
            keywords=[
                "mel", "monitoring", "evaluation", "learning", "m&e", "results framework",
                "logframe", "indicators", "impact", "outcomes", "reporting", "iris",
                "sdg", "theory of change", "data collection", "baseline",
            ],
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
                    placeholder="e.g. Northern Ghana, Nairobi county Kenya",
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
                SetupFieldDef(
                    name="reporting_framework",
                    label="Reporting Framework",
                    description="Which framework should indicators align to?",
                    field_type="select",
                    options=[
                        "IRIS+ (GIIN)",
                        "SDG Indicators",
                        "EU Results Framework",
                        "USAID Standard Indicators",
                        "Donor-specific",
                        "Internal only",
                    ],
                ),
                SetupFieldDef(
                    name="target_population",
                    label="Target Population",
                    description="Who are the primary beneficiaries?",
                    field_type="text",
                    placeholder="e.g. rural households in Northern Ghana, smallholder farmers",
                ),
            ],
            build_layers=[
                BuildLayerDef(
                    id="dimensions",
                    name="Impact Dimensions",
                    view_type="simple_list",
                    description="Result chain levels or thematic impact dimensions to measure",
                    item_schema={"title": "Dimension or result level name"},
                ),
                BuildLayerDef(
                    id="indicators",
                    name="Indicators",
                    view_type="structured_list",
                    description="Specific indicators to track within each dimension",
                    item_schema={
                        "indicator_name": "Full indicator name",
                        "unit": "Unit of measurement (e.g. households, %, tCO2e)",
                        "parent": "Which Impact Dimension this belongs to",
                    },
                ),
                BuildLayerDef(
                    id="data_plan",
                    name="Data Collection Plan",
                    view_type="structured_list",
                    description="Data collection method, baseline, and target for each indicator",
                    item_schema={
                        "indicator_name": "The indicator being planned (from Indicators layer)",
                        "baseline": "Baseline value or source",
                        "target": "Target value by project end",
                        "data_source": "Where data comes from (e.g. household survey, admin records)",
                        "collection_method": "How data is collected (survey, observation, records review)",
                        "frequency": "How often data is collected (monthly, quarterly, annually)",
                        "responsible_party": "Who collects and reports this data",
                        "parent": "Which Impact Dimension this belongs to",
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
                "You are helping configure a Monitoring, Evaluation & Learning (MEL) Plan for a "
                "development project. Based on the project context, suggest sensible defaults for: "
                "geography, sector, reporting_framework, target_population. "
                "For sector choose from: Energy Access, Clean Cooking, Water & Sanitation, "
                "Agriculture, Health, Education, Financial Inclusion, Other. "
                "For reporting_framework choose from: IRIS+ (GIIN), SDG Indicators, "
                "EU Results Framework, USAID Standard Indicators, Donor-specific, Internal only. "
                "Return a JSON object with those four keys. Use empty string for fields that cannot be inferred."
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
        if layer_id == "dimensions":
            return await self._generate_dimensions(setup_fields, context)
        elif layer_id == "indicators":
            dimension_items = prior_layers.get("dimensions", {}).get("items", [])
            return await self._generate_indicators(setup_fields, dimension_items, context)
        elif layer_id == "data_plan":
            dimension_items = prior_layers.get("dimensions", {}).get("items", [])
            indicator_items = prior_layers.get("indicators", {}).get("items", [])
            return await self._generate_data_plan(setup_fields, dimension_items, indicator_items, context)
        else:
            logger.warning(f"Unknown layer_id: {layer_id}")
            return []

    async def _generate_dimensions(self, setup: dict, context: dict) -> list[dict]:
        data = await llm_json(
            system=(
                "You are an MEL specialist. Generate 4–7 impact dimensions or result chain levels "
                "for the project's results framework. These should cover the full theory of change — "
                "typically: Inputs, Activities, Outputs, Outcomes, Impact — or thematic dimensions "
                "like Access, Affordability, Reliability, Gender & Social Inclusion, Environment, "
                "Livelihoods. Tailor to the sector and reporting framework. "
                "Return JSON with key 'dimensions', a list of objects with 'title' only."
            ),
            user_msg=(
                f"Sector: {setup.get('sector', '')}\n"
                f"Reporting framework: {setup.get('reporting_framework', '')}\n"
                f"Target population: {setup.get('target_population', '')}\n"
                f"Geography: {setup.get('geography', '')}\n"
                f"Project description: {context.get('project_description', '')}"
            ),
        )
        return [
            make_build_item(
                content={"title": d.get("title", "")},
                derivation="inferred",
                rationale="Generated from project context and reporting framework requirements",
            )
            for d in data.get("dimensions", [])
        ]

    async def _generate_indicators(
        self, setup: dict, dimension_items: list[dict], context: dict
    ) -> list[dict]:
        dimensions = [i["content"].get("title", "") for i in dimension_items]
        dimensions_list = "\n".join(f"- {d}" for d in dimensions)
        framework = setup.get("reporting_framework", "")
        data = await llm_json(
            system=(
                "You are an MEL specialist. For each impact dimension listed, generate 2–4 "
                "specific, measurable indicators. Each indicator must have: "
                "'indicator_name' (full indicator name, specific and measurable), "
                "'unit' (unit of measurement, e.g. households, %, tCO2e, USD, score), "
                "'parent' (exactly matching one dimension title). "
                "Where applicable, align indicators to the specified reporting framework. "
                "Return JSON with key 'indicators', a flat list."
            ),
            user_msg=(
                f"Sector: {setup.get('sector', '')}\n"
                f"Reporting framework: {framework}\n"
                f"Target population: {setup.get('target_population', '')}\n"
                f"Geography: {setup.get('geography', '')}\n"
                f"Project description: {context.get('project_description', '')}\n\n"
                f"Impact dimensions:\n{dimensions_list}"
            ),
        )
        return [
            make_build_item(
                content={
                    "indicator_name": ind.get("indicator_name", ""),
                    "unit": ind.get("unit", ""),
                    "parent": ind.get("parent", ""),
                },
                derivation="inferred",
                rationale=f"Aligned to {framework or 'best practice MEL standards'}",
            )
            for ind in data.get("indicators", [])
        ]

    async def _generate_data_plan(
        self,
        setup: dict,
        dimension_items: list[dict],
        indicator_items: list[dict],
        context: dict,
    ) -> list[dict]:
        dimensions = [i["content"].get("title", "") for i in dimension_items]
        indicators_text = "\n".join(
            f"- [{ind['content'].get('parent', '')}] "
            f"{ind['content'].get('indicator_name', '')} "
            f"({ind['content'].get('unit', '')})"
            for ind in indicator_items
        )
        data = await llm_json(
            system=(
                "You are an MEL specialist drafting a data collection plan. "
                "For each indicator listed, provide: "
                "'indicator_name' (repeat the indicator name), "
                "'baseline' (baseline value, or 'TBD — baseline survey required' if unknown), "
                "'target' (target value by project end, or a realistic estimate), "
                "'data_source' (where data comes from: household survey, admin records, "
                "project MIS, national statistics, etc.), "
                "'collection_method' (survey, direct observation, records review, sensor data, etc.), "
                "'frequency' (monthly, quarterly, semi-annual, annual, end-line only), "
                "'responsible_party' (project M&E officer, implementing partner, independent evaluator), "
                "'parent' (the impact dimension, exactly matching one of the dimensions listed). "
                "Return JSON with key 'data_plans', a flat list."
            ),
            user_msg=(
                f"Sector: {setup.get('sector', '')}\n"
                f"Reporting framework: {setup.get('reporting_framework', '')}\n"
                f"Target population: {setup.get('target_population', '')}\n"
                f"Geography: {setup.get('geography', '')}\n\n"
                f"Impact dimensions: {', '.join(dimensions)}\n\n"
                f"Indicators to plan for:\n{indicators_text}"
            ),
        )
        return [
            make_build_item(
                content={
                    "indicator_name": dp.get("indicator_name", ""),
                    "baseline": dp.get("baseline", ""),
                    "target": dp.get("target", ""),
                    "data_source": dp.get("data_source", ""),
                    "collection_method": dp.get("collection_method", ""),
                    "frequency": dp.get("frequency", ""),
                    "responsible_party": dp.get("responsible_party", ""),
                    "parent": dp.get("parent", ""),
                },
                derivation="inferred",
                rationale="Data collection plan aligned to reporting framework requirements",
            )
            for dp in data.get("data_plans", [])
        ]

    async def generate_output(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        setup_fields: dict,
        confirmed_build: dict,
    ) -> dict:
        dimension_items = confirmed_build.get("dimensions", {}).get("items", [])
        indicator_items = confirmed_build.get("indicators", {}).get("items", [])
        data_plan_items = confirmed_build.get("data_plan", {}).get("items", [])

        dimensions = [i["content"].get("title", "") for i in dimension_items]

        by_dimension: dict[str, dict] = {d: {"indicators": [], "data_plans": []} for d in dimensions}
        for item in indicator_items:
            parent = item["content"].get("parent", "")
            ind_name = item["content"].get("indicator_name", "")
            unit = item["content"].get("unit", "")
            if parent in by_dimension:
                by_dimension[parent]["indicators"].append(f"{ind_name} ({unit})")
        for item in data_plan_items:
            parent = item["content"].get("parent", "")
            c = item["content"]
            entry = (
                f"Indicator: {c.get('indicator_name', '')}\n"
                f"  Baseline: {c.get('baseline', '')}\n"
                f"  Target: {c.get('target', '')}\n"
                f"  Source: {c.get('data_source', '')}\n"
                f"  Method: {c.get('collection_method', '')}\n"
                f"  Frequency: {c.get('frequency', '')}\n"
                f"  Responsible: {c.get('responsible_party', '')}"
            )
            if parent in by_dimension:
                by_dimension[parent]["data_plans"].append(entry)

        outline_text = "\n\n".join(
            f"### {dim}\n"
            + "Indicators:\n" + "\n".join(f"  - {ind}" for ind in by_dimension[dim]["indicators"])
            + "\nData Collection Plan:\n" + "\n".join(by_dimension[dim]["data_plans"])
            for dim in dimensions
        )

        geography = setup_fields.get("geography", "")
        sector = setup_fields.get("sector", "")
        framework = setup_fields.get("reporting_framework", "")
        queries = [
            f"monitoring evaluation {dim} {sector} {geography}".strip()
            for dim in dimensions[:5]
        ] + [f"MEL best practices {sector} development impact indicators"]

        context_str, citations = await self._retrieve_evidence(queries, db, initiative_id)
        evidence_block = (
            f"\n\nRetrieved sources — cite as [1], [2] … inline:\n{context_str}"
            if context_str else ""
        )

        target_pop = setup_fields.get("target_population", "")

        result = await llm_json(
            system=(
                "You are a senior MEL specialist drafting a professional Monitoring, Evaluation & "
                "Learning (MEL) Plan for a development project. Using the confirmed impact dimensions, "
                "indicators, and data collection plan, write a complete MEL plan. The document must:\n"
                "  • Open with an Executive Summary (4–6 sentences: project overview, theory of change "
                "    summary, MEL approach, and key outcomes being tracked)\n"
                "  • Include one section per impact dimension. Each section must present the indicators "
                "    for that dimension, describe the data collection approach, and explain what the "
                "    data will tell us about project performance. Cite sources as [1], [2], etc.\n"
                "  • Include a Learning & Adaptive Management section describing how findings will be "
                "    used to improve project delivery\n"
                "  • Close with a Reporting section describing the reporting calendar and outputs "
                "    (progress reports, mid-term review, end-line evaluation)\n"
                "  • Use professional language appropriate for a funder submission\n\n"
                "Return JSON with keys:\n"
                "  title (string),\n"
                "  executive_summary (string),\n"
                "  sections (list of {theme, body} — one per impact dimension, "
                "use 'theme' as the key name),\n"
                "  learning_and_adaptive_management (string),\n"
                "  reporting (string)"
            ),
            user_msg=(
                f"Project: Sector={sector}, Geography={geography}, "
                f"Reporting framework={framework}, Target population={target_pop}\n\n"
                f"Impact dimensions, indicators, and data plans:\n{outline_text}"
                f"{evidence_block}"
            ),
            model="gpt-4.1",
        )
        result = result or {"title": "Monitoring, Evaluation & Learning Plan"}
        if citations:
            result["citations"] = citations
        return result
