"""Monitoring, Evaluation & Learning (MEL) Plan Module.

Stage workflow:
  1. Impact Dimensions    (list / categorized_list)
  2. Indicators           (list / categorized_workspace)
  3. Data Collection Plan (record / categorized_workspace)

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


class MELPlanModule(BaseModule):
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
            export_format="docx",
        )

    @property
    def manifest(self) -> ModuleManifest:
        return ModuleManifest(
            **self.definition.__dict__,
            goal="Produce a MEL plan with indicators and data collection strategy for reporting.",
            primary_ui_object="categorized_workspace",
            export_artifact_types=["docx"],
            adapter_bindings={"research_source": "retrieval"},
            input_dependencies=[],
            produced_outputs=["mel_indicators", "mel_data_plan"],
            downstream_dependencies=[],
            assumptions_behavior="tracks",
            evidence_behavior="rag_grounded",
        )

    @property
    def stage_defs(self) -> list[StageDef]:
        return [
            StageDef(
                id="dimensions",
                title="Impact Dimensions",
                component="list",
                widget="categorized_list",
                fields=[
                    FieldDef("label", "text", required=True, label="Dimension"),
                    FieldDef("description", "long_text", label="Description"),
                ],
                population=[
                    PopulationStep("seed_from_template"),
                    PopulationStep("adapt_with_ai_from_project_materials", {"require_citation": True}),
                    PopulationStep("await_user_confirmation"),
                ],
            ),
            StageDef(
                id="indicators",
                title="Indicators",
                component="list",
                widget="categorized_workspace",
                fields=[
                    FieldDef("indicator_name", "text", required=True, label="Indicator Name"),
                    FieldDef("unit", "text", label="Unit"),
                    FieldDef("dimension", "text", required=True, label="Impact Dimension"),
                ],
                population=[
                    PopulationStep("read_confirmed_prior_stage", {"stage_id": "dimensions"}),
                    PopulationStep("extract_from_project_materials"),
                    PopulationStep("propose_with_ai", {"require_citation": True}),
                    PopulationStep("await_user_confirmation"),
                ],
            ),
            StageDef(
                id="data_plan",
                title="Data Collection Plan",
                component="record",
                widget="categorized_workspace",
                fields=[
                    FieldDef("baseline", "text", label="Baseline"),
                    FieldDef("target", "text", label="Target"),
                    FieldDef("data_source", "text", label="Data Source"),
                    FieldDef("collection_method", "text", label="Collection Method"),
                    FieldDef("frequency", "select", label="Frequency",
                             options=["Monthly", "Quarterly", "Semi-annual", "Annual", "End-line only"]),
                    FieldDef("responsible_party", "text", label="Responsible Party"),
                ],
                population=[
                    PopulationStep("read_confirmed_prior_stage", {"stage_id": "indicators"}),
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
        if stage_id == "dimensions":
            return await self._generate_dimensions(context)
        elif stage_id == "indicators":
            prior_dims = (prior_data.get("dimensions") or {}).get("data", {}).get("items", [])
            return await self._generate_indicators(context, prior_dims)
        return []

    async def enrich_record(
        self,
        stage_id: str,
        item_content: dict,
        existing_record: dict,
        context: dict,
    ) -> dict:
        if stage_id != "data_plan":
            raise ValueError(f"enrich_record called for unexpected stage '{stage_id}'")
        return await self._enrich_data_plan(item_content, existing_record, context)

    async def generate_export(self, confirmed_stages: dict[str, Any], context: dict) -> bytes:
        dimension_items = (confirmed_stages.get("dimensions") or {}).get("data", {}).get("items", [])
        indicator_items = (confirmed_stages.get("indicators") or {}).get("data", {}).get("items", [])
        records = (confirmed_stages.get("data_plan") or {}).get("data", {}).get("records", {})

        dimensions = [i["content"].get("label", "") for i in dimension_items]
        by_dimension: dict[str, dict] = {d: {"indicators": [], "data_plans": []} for d in dimensions}

        for item in indicator_items:
            dim = item["content"].get("dimension", "")
            ind_name = item["content"].get("indicator_name", "")
            unit = item["content"].get("unit", "")
            if dim in by_dimension:
                by_dimension[dim]["indicators"].append(f"{ind_name} ({unit})")

        for item_id, record in records.items():
            source_item = next((i for i in indicator_items if i["id"] == item_id), None)
            if source_item:
                dim = source_item["content"].get("dimension", "")
                entry = (
                    f"Indicator: {source_item['content'].get('indicator_name', '')}\n"
                    f"  Baseline: {record.get('baseline', '')}\n"
                    f"  Target: {record.get('target', '')}\n"
                    f"  Source: {record.get('data_source', '')}\n"
                    f"  Method: {record.get('collection_method', '')}\n"
                    f"  Frequency: {record.get('frequency', '')}\n"
                    f"  Responsible: {record.get('responsible_party', '')}"
                )
                if dim in by_dimension:
                    by_dimension[dim]["data_plans"].append(entry)

        outline_text = "\n\n".join(
            f"### {dim}\n"
            + "Indicators:\n" + "\n".join(f"  - {ind}" for ind in by_dimension[dim]["indicators"])
            + "\nData Collection Plan:\n" + "\n".join(by_dimension[dim]["data_plans"])
            for dim in dimensions
        )

        geography = context.get("geography", "")
        sector = context.get("project_type", "")
        queries = [
            f"monitoring evaluation {dim} {sector} {geography}".strip()
            for dim in dimensions[:5]
        ] + [f"MEL best practices {sector} development impact indicators"]

        context_str, citations = await retrieve_evidence(queries, None, None)
        evidence_block = (
            f"\n\nRetrieved sources — cite as [1], [2] … inline:\n{context_str}"
            if context_str else ""
        )

        result = await llm_json(
            system=(
                "You are a senior MEL specialist drafting a professional MEL Plan for DFI submission. "
                "Using the confirmed dimensions, indicators, and data collection plan:\n"
                "  • Executive Summary (4–6 sentences)\n"
                "  • One section per impact dimension with indicators and data collection approach. "
                "    Cite sources as [1], [2], etc.\n"
                "  • Learning & Adaptive Management section\n"
                "  • Reporting section\n\n"
                "Return JSON with keys: title, executive_summary, "
                "sections (list of {theme, body}), learning_and_adaptive_management, reporting"
            ),
            user_msg=(
                f"Project: Sector={sector}, Geography={geography}\n\n"
                f"Dimensions, indicators, and data plans:\n{outline_text}"
                f"{evidence_block}"
            ),
            model="gpt-4.1",
        )
        result = result or {"title": "Monitoring, Evaluation & Learning Plan"}
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

    async def _generate_dimensions(self, context: dict) -> list[dict]:
        data = await llm_json(
            system=(
                "You are an MEL specialist. Generate 4–7 impact dimensions or result chain levels "
                "for the project's results framework. Return JSON with key 'dimensions', "
                "a list of objects with 'label' and optional 'description'."
            ),
            user_msg=(
                f"Sector: {context.get('project_type', '')}\n"
                f"Geography: {context.get('geography', '')}\n"
                f"Description: {context.get('project_description', '')}"
            ),
        )
        return [
            {"label": d.get("label", d.get("title", "")), "description": d.get("description", "")}
            for d in data.get("dimensions", [])
        ]

    async def _generate_indicators(self, context: dict, dimension_items: list[dict]) -> list[dict]:
        dimensions = [i["content"].get("label", "") for i in dimension_items]
        dims_list = "\n".join(f"- {d}" for d in dimensions)
        data = await llm_json(
            system=(
                "You are an MEL specialist. For each impact dimension listed, generate 2–4 "
                "specific, measurable indicators. Each indicator must have: "
                "'indicator_name', 'unit', 'dimension' (exactly matching one dimension label). "
                "Return JSON with key 'indicators', a flat list."
            ),
            user_msg=(
                f"Sector: {context.get('project_type', '')}\n"
                f"Geography: {context.get('geography', '')}\n"
                f"Impact dimensions:\n{dims_list}"
            ),
        )
        return [
            {
                "indicator_name": ind.get("indicator_name", ""),
                "unit": ind.get("unit", ""),
                "dimension": ind.get("dimension", ind.get("parent", "")),
            }
            for ind in data.get("indicators", [])
        ]

    async def _enrich_data_plan(
        self,
        item_content: dict,
        existing_record: dict,
        context: dict,
    ) -> dict:
        data = await llm_json(
            system=(
                "You are an MEL specialist. Provide a data collection plan for the given indicator. "
                "Return JSON with keys: baseline, target, data_source, collection_method, "
                "frequency (Monthly/Quarterly/Semi-annual/Annual/End-line only), responsible_party."
            ),
            user_msg=(
                f"Indicator: {item_content.get('indicator_name', '')} ({item_content.get('unit', '')})\n"
                f"Dimension: {item_content.get('dimension', '')}\n"
                f"Sector: {context.get('project_type', '')}\n"
                f"Geography: {context.get('geography', '')}"
            ),
        )
        return {
            "baseline": data.get("baseline", existing_record.get("baseline", "")),
            "target": data.get("target", existing_record.get("target", "")),
            "data_source": data.get("data_source", existing_record.get("data_source", "")),
            "collection_method": data.get("collection_method", existing_record.get("collection_method", "")),
            "frequency": data.get("frequency", existing_record.get("frequency", "")),
            "responsible_party": data.get("responsible_party", existing_record.get("responsible_party", "")),
        }
