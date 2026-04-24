"""Environmental & Social Management Plan (ESMP) Module.

Stage workflow:
  1. Risk Themes         (list / categorized_list)
  2. Risks               (list / categorized_workspace)
  3. Mitigation & Monitoring (record / categorized_workspace)

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


class ESMPModule(BaseModule):
    """Environmental & Social Management Plan — IFC/DFI-standard E&S plan."""

    @property
    def definition(self) -> ModuleDefinition:
        return ModuleDefinition(
            id="esmp",
            name="Environmental & Social Management Plan",
            description="Draft an IFC-aligned ESMP covering E&S risks, mitigation, and monitoring",
            icon="ShieldCheck",
            output_type="assessment_document",
            category="assessment",
            keywords=[
                "esmp", "environmental", "social", "safeguards", "ifc", "e&s",
                "mitigation", "monitoring", "dfi", "world bank", "impact assessment",
                "esia", "esmf", "resettlement", "biodiversity", "community health",
            ],
            export_format="docx",
        )

    @property
    def manifest(self) -> ModuleManifest:
        return ModuleManifest(
            **self.definition.__dict__,
            goal="Draft an IFC-aligned ESMP with risk, mitigation, and monitoring commitments.",
            primary_ui_object="categorized_workspace",
            export_artifact_types=["docx"],
            adapter_bindings={"research_source": "retrieval"},
            input_dependencies=[],
            produced_outputs=["esmp_risk_register", "esmp_monitoring_plan"],
            downstream_dependencies=[],
            assumptions_behavior="tracks",
            evidence_behavior="rag_grounded",
        )

    @property
    def stage_defs(self) -> list[StageDef]:
        return [
            StageDef(
                id="risk_themes",
                title="Risk Themes",
                component="list",
                widget="categorized_list",
                fields=[
                    FieldDef("label", "text", required=True, label="Risk Theme"),
                    FieldDef("description", "long_text", label="Description"),
                ],
                population=[
                    PopulationStep("seed_from_template"),
                    PopulationStep("adapt_with_ai_from_project_materials", {"require_citation": True}),
                    PopulationStep("await_user_confirmation"),
                ],
            ),
            StageDef(
                id="risks",
                title="Risks",
                component="list",
                widget="categorized_workspace",
                fields=[
                    FieldDef("risk", "long_text", required=True, label="Risk Description"),
                    FieldDef("category", "text", required=True, label="Risk Theme"),
                ],
                population=[
                    PopulationStep("read_confirmed_prior_stage", {"stage_id": "risk_themes"}),
                    PopulationStep("extract_from_project_materials"),
                    PopulationStep("propose_with_ai", {"require_citation": True}),
                    PopulationStep("await_user_confirmation"),
                ],
            ),
            StageDef(
                id="mitigation",
                title="Mitigation & Monitoring",
                component="record",
                widget="categorized_workspace",
                fields=[
                    FieldDef("measure", "long_text", label="Mitigation Measure"),
                    FieldDef("indicator", "long_text", label="Monitoring Indicator"),
                    FieldDef("responsible_party", "select", label="Responsible Party",
                             options=["Developer", "Contractor", "Operator", "Government", "Community"]),
                    FieldDef("timing", "text", label="Timing / Frequency"),
                ],
                population=[
                    PopulationStep("read_confirmed_prior_stage", {"stage_id": "risks"}),
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
        if stage_id == "risk_themes":
            return await self._generate_risk_themes(context)
        elif stage_id == "risks":
            prior_themes = (prior_data.get("risk_themes") or {}).get("data", {}).get("items", [])
            return await self._generate_risks(context, prior_themes)
        return []

    async def enrich_record(
        self,
        stage_id: str,
        item_content: dict,
        existing_record: dict,
        context: dict,
    ) -> dict:
        if stage_id != "mitigation":
            raise ValueError(f"enrich_record called for unexpected stage '{stage_id}'")
        return await self._enrich_mitigation(item_content, existing_record, context)

    async def generate_export(self, confirmed_stages: dict[str, Any], context: dict) -> bytes:
        theme_items = (confirmed_stages.get("risk_themes") or {}).get("data", {}).get("items", [])
        risk_items = (confirmed_stages.get("risks") or {}).get("data", {}).get("items", [])
        records = (confirmed_stages.get("mitigation") or {}).get("data", {}).get("records", {})

        themes = [i["content"].get("label", "") for i in theme_items]
        by_theme: dict[str, dict] = {t: {"risks": [], "measures": []} for t in themes}

        for item in risk_items:
            cat = item["content"].get("category", "")
            risk = item["content"].get("risk", "")
            if cat in by_theme:
                by_theme[cat]["risks"].append(risk)

        for item_id, record in records.items():
            source_item = next((r for r in risk_items if r["id"] == item_id), None)
            if source_item:
                parent = source_item["content"].get("category", "")
                entry = (
                    f"Risk: {source_item['content'].get('risk', '')}\n"
                    f"  Measure: {record.get('measure', '')}\n"
                    f"  Indicator: {record.get('indicator', '')}\n"
                    f"  Responsible: {record.get('responsible_party', '')}\n"
                    f"  Timing: {record.get('timing', '')}"
                )
                if parent in by_theme:
                    by_theme[parent]["measures"].append(entry)

        outline_text = "\n\n".join(
            f"### {theme}\n"
            + "Risks:\n" + "\n".join(f"  - {r}" for r in by_theme[theme]["risks"])
            + "\nMitigation & Monitoring:\n" + "\n".join(by_theme[theme]["measures"])
            for theme in themes
        )

        geography = context.get("geography", "")
        project_type = context.get("project_type", "")
        queries = [
            f"environmental social management {theme} {project_type} {geography}".strip()
            for theme in themes[:5]
        ] + [f"IFC Performance Standards {project_type} {geography}"]

        context_str, citations = await retrieve_evidence(queries, None, None)
        evidence_block = (
            f"\n\nRetrieved sources — cite as [1], [2] … inline:\n{context_str}"
            if context_str else ""
        )

        result = await llm_json(
            system=(
                "You are a senior E&S specialist drafting a professional Environmental & Social "
                "Management Plan (ESMP) for DFI submission. Write a complete ESMP using the "
                "confirmed risk themes, risks, and mitigation commitments:\n"
                "  • Executive Summary (4–6 sentences)\n"
                "  • One section per risk theme with risks, mitigation, and monitoring in prose. "
                "    Cite sources as [1], [2], etc.\n"
                "  • Monitoring & Reporting section\n\n"
                "Return JSON with keys: title, executive_summary, "
                "sections (list of {theme, body}), monitoring_and_reporting"
            ),
            user_msg=(
                f"Project: {project_type}, Geography: {geography}\n\n"
                f"Risk themes, risks, and mitigation:\n{outline_text}"
                f"{evidence_block}"
            ),
            model="gpt-4.1",
        )
        result = result or {"title": "Environmental & Social Management Plan"}
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

    async def _generate_risk_themes(self, context: dict) -> list[dict]:
        data = await llm_json(
            system=(
                "You are an E&S specialist applying IFC Performance Standards. "
                "Generate 5–8 high-level E&S risk themes for the project. "
                "Return JSON with key 'themes', a list of objects with 'label' and optional 'description'."
            ),
            user_msg=(
                f"Project type: {context.get('project_type', '')}\n"
                f"Geography: {context.get('geography', '')}\n"
                f"Description: {context.get('project_description', '')}"
            ),
        )
        return [
            {"label": t.get("label", t.get("title", "")), "description": t.get("description", "")}
            for t in data.get("themes", [])
        ]

    async def _generate_risks(self, context: dict, theme_items: list[dict]) -> list[dict]:
        themes = [i["content"].get("label", "") for i in theme_items]
        themes_list = "\n".join(f"- {t}" for t in themes)
        data = await llm_json(
            system=(
                "You are an E&S specialist. For each risk theme listed, identify 2–4 specific risks. "
                "Each item must have 'risk' (description, 1–2 sentences) and 'category' "
                "(exactly matching one theme label). Return JSON with key 'risks', a flat list."
            ),
            user_msg=(
                f"Project type: {context.get('project_type', '')}\n"
                f"Geography: {context.get('geography', '')}\n"
                f"Risk themes:\n{themes_list}"
            ),
        )
        return [
            {"risk": r.get("risk", ""), "category": r.get("category", r.get("parent", ""))}
            for r in data.get("risks", [])
        ]

    async def _enrich_mitigation(
        self,
        item_content: dict,
        existing_record: dict,
        context: dict,
    ) -> dict:
        data = await llm_json(
            system=(
                "You are an E&S specialist. Provide mitigation and monitoring for the given risk. "
                "Return JSON with keys: measure, indicator, responsible_party "
                "(one of: Developer, Contractor, Operator, Government, Community), timing."
            ),
            user_msg=(
                f"Risk: {item_content.get('risk', '')}\n"
                f"Category: {item_content.get('category', '')}\n"
                f"Project type: {context.get('project_type', '')}\n"
                f"Geography: {context.get('geography', '')}"
            ),
        )
        return {
            "measure": data.get("measure", existing_record.get("measure", "")),
            "indicator": data.get("indicator", existing_record.get("indicator", "")),
            "responsible_party": data.get("responsible_party", existing_record.get("responsible_party", "")),
            "timing": data.get("timing", existing_record.get("timing", "")),
        }
