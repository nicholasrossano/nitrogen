"""Environmental & Social Management Plan (ESMP) Module.

Three-layer Build workflow:
  risk_themes  (simple_list)    → high-level E&S risk themes
  risks        (structured_list) → specific risks per theme
  mitigation   (structured_list) → mitigation measure + monitoring per risk

After Mitigation layer is confirmed, "Generate Output" drafts the full ESMP
document with executive summary, per-theme sections, and inline citations.
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


class ESMPModule(BaseAssessmentModule):
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
                    name="project_type",
                    label="Project Type",
                    description="What type of project is this?",
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
                    name="ifc_category",
                    label="IFC Risk Category",
                    description="Project risk category under IFC Performance Standards",
                    field_type="select",
                    options=[
                        "Category A — High risk (significant adverse impacts)",
                        "Category B — Moderate risk (limited/reversible impacts)",
                        "Category C — Low risk (minimal or no adverse impacts)",
                    ],
                ),
                SetupFieldDef(
                    name="financing_institution",
                    label="Lead Financing Institution",
                    description="Which DFI or funder requires this ESMP? (optional)",
                    field_type="text",
                    required=False,
                    placeholder="e.g. IFC, AfDB, KfW, USAID, bilateral donor",
                ),
            ],
            build_layers=[
                BuildLayerDef(
                    id="risk_themes",
                    name="Risk Themes",
                    view_type="simple_list",
                    description="High-level E&S risk themes relevant to this project",
                    item_schema={"title": "Risk theme name"},
                ),
                BuildLayerDef(
                    id="risks",
                    name="Risks",
                    view_type="structured_list",
                    description="Specific risks identified within each theme",
                    item_schema={
                        "risk": "Description of the specific risk",
                        "parent": "Which Risk Theme this belongs to",
                    },
                ),
                BuildLayerDef(
                    id="mitigation",
                    name="Mitigation & Monitoring",
                    view_type="structured_list",
                    description="Mitigation measure and monitoring indicator for each risk",
                    item_schema={
                        "risk": "The risk being addressed",
                        "measure": "Mitigation measure to be implemented",
                        "indicator": "Monitoring indicator to track effectiveness",
                        "responsible_party": "Who is responsible",
                        "timing": "When / frequency (e.g. pre-construction, quarterly)",
                        "parent": "Which Risk Theme this belongs to",
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
                "You are helping configure an Environmental & Social Management Plan for a development "
                "project. Based on the project context, suggest sensible defaults for: geography, "
                "project_type, ifc_category, financing_institution. "
                "For project_type choose from: Energy Access, Clean Cooking, Water & Sanitation, "
                "Agriculture, Health, Education, Financial Inclusion, Other. "
                "For ifc_category choose from: "
                "'Category A — High risk (significant adverse impacts)', "
                "'Category B — Moderate risk (limited/reversible impacts)', "
                "'Category C — Low risk (minimal or no adverse impacts)'. "
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
        if layer_id == "risk_themes":
            return await self._generate_risk_themes(setup_fields, context)
        elif layer_id == "risks":
            theme_items = prior_layers.get("risk_themes", {}).get("items", [])
            return await self._generate_risks(setup_fields, theme_items, context)
        elif layer_id == "mitigation":
            theme_items = prior_layers.get("risk_themes", {}).get("items", [])
            risk_items = prior_layers.get("risks", {}).get("items", [])
            return await self._generate_mitigation(setup_fields, theme_items, risk_items, context)
        else:
            logger.warning(f"Unknown layer_id: {layer_id}")
            return []

    async def _generate_risk_themes(self, setup: dict, context: dict) -> list[dict]:
        data = await llm_json(
            system=(
                "You are an E&S specialist applying IFC Performance Standards. "
                "Generate 5–8 high-level E&S risk themes appropriate for the project. "
                "Common themes include: Land Acquisition & Resettlement, Biodiversity & Natural Habitats, "
                "Community Health Safety & Security, Labor & Working Conditions, Cultural Heritage, "
                "Gender & Social Inclusion, Water Resources, Air Quality & Noise, Waste Management, "
                "Climate Risk & Resilience. Tailor to the project type and IFC risk category. "
                "Return JSON with key 'themes', a list of objects with 'title' only."
            ),
            user_msg=(
                f"Project type: {setup.get('project_type', '')}\n"
                f"Geography: {setup.get('geography', '')}\n"
                f"IFC category: {setup.get('ifc_category', '')}\n"
                f"Project description: {context.get('project_description', '')}"
            ),
        )
        return [
            make_build_item(
                content={"title": t.get("title", "")},
                derivation="inferred",
                rationale="Generated from project context and IFC Performance Standards",
            )
            for t in data.get("themes", [])
        ]

    async def _generate_risks(
        self, setup: dict, theme_items: list[dict], context: dict
    ) -> list[dict]:
        themes = [i["content"].get("title", "") for i in theme_items]
        themes_list = "\n".join(f"- {t}" for t in themes)
        data = await llm_json(
            system=(
                "You are an E&S specialist. For each risk theme listed, identify 2–4 specific risks "
                "relevant to this project. Each item must have: "
                "'risk' (a concise description of the specific risk, 1–2 sentences) and "
                "'parent' (exactly matching one theme title). "
                "Return JSON with key 'risks', a flat list."
            ),
            user_msg=(
                f"Project type: {setup.get('project_type', '')}\n"
                f"Geography: {setup.get('geography', '')}\n"
                f"IFC category: {setup.get('ifc_category', '')}\n"
                f"Project description: {context.get('project_description', '')}\n\n"
                f"Risk themes:\n{themes_list}"
            ),
        )
        return [
            make_build_item(
                content={
                    "risk": r.get("risk", ""),
                    "parent": r.get("parent", ""),
                },
                derivation="inferred",
                rationale="Identified from project context and IFC Performance Standards",
            )
            for r in data.get("risks", [])
        ]

    async def _generate_mitigation(
        self,
        setup: dict,
        theme_items: list[dict],
        risk_items: list[dict],
        context: dict,
    ) -> list[dict]:
        themes = [i["content"].get("title", "") for i in theme_items]
        risks_text = "\n".join(
            f"- [{r['content'].get('parent', '')}] {r['content'].get('risk', '')}"
            for r in risk_items
        )
        data = await llm_json(
            system=(
                "You are an E&S specialist drafting mitigation and monitoring commitments. "
                "For each risk listed, provide: "
                "'risk' (repeat the risk description), "
                "'measure' (the mitigation action to implement), "
                "'indicator' (monitoring indicator to track effectiveness), "
                "'responsible_party' (developer, contractor, operator, or government), "
                "'timing' (pre-construction, construction, operations, quarterly, annually, etc.), "
                "'parent' (the risk theme, exactly matching one of the themes listed). "
                "Return JSON with key 'measures', a flat list. "
                "Be specific and actionable — these will appear in a funder submission."
            ),
            user_msg=(
                f"Project type: {setup.get('project_type', '')}\n"
                f"Geography: {setup.get('geography', '')}\n"
                f"Financing institution: {setup.get('financing_institution', 'Not specified')}\n\n"
                f"Risk themes: {', '.join(themes)}\n\n"
                f"Risks to address:\n{risks_text}"
            ),
        )
        return [
            make_build_item(
                content={
                    "risk": m.get("risk", ""),
                    "measure": m.get("measure", ""),
                    "indicator": m.get("indicator", ""),
                    "responsible_party": m.get("responsible_party", ""),
                    "timing": m.get("timing", ""),
                    "parent": m.get("parent", ""),
                },
                derivation="inferred",
                rationale="Mitigation and monitoring measures per IFC Performance Standards",
            )
            for m in data.get("measures", [])
        ]

    async def generate_output(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        setup_fields: dict,
        confirmed_build: dict,
    ) -> dict:
        theme_items = confirmed_build.get("risk_themes", {}).get("items", [])
        risk_items = confirmed_build.get("risks", {}).get("items", [])
        mitigation_items = confirmed_build.get("mitigation", {}).get("items", [])

        themes = [i["content"].get("title", "") for i in theme_items]

        by_theme: dict[str, dict] = {t: {"risks": [], "measures": []} for t in themes}
        for item in risk_items:
            parent = item["content"].get("parent", "")
            risk = item["content"].get("risk", "")
            if parent in by_theme:
                by_theme[parent]["risks"].append(risk)
        for item in mitigation_items:
            parent = item["content"].get("parent", "")
            c = item["content"]
            entry = (
                f"Risk: {c.get('risk', '')}\n"
                f"  Measure: {c.get('measure', '')}\n"
                f"  Indicator: {c.get('indicator', '')}\n"
                f"  Responsible: {c.get('responsible_party', '')}\n"
                f"  Timing: {c.get('timing', '')}"
            )
            if parent in by_theme:
                by_theme[parent]["measures"].append(entry)

        outline_text = "\n\n".join(
            f"### {theme}\n"
            + "Risks:\n" + "\n".join(f"  - {r}" for r in by_theme[theme]["risks"])
            + "\nMitigation & Monitoring:\n" + "\n".join(by_theme[theme]["measures"])
            for theme in themes
        )

        geography = setup_fields.get("geography", "")
        project_type = setup_fields.get("project_type", "")
        queries = [
            f"environmental social management {theme} {project_type} {geography}".strip()
            for theme in themes[:5]
        ] + [f"IFC Performance Standards {project_type} {geography}"]

        context_str, citations = await self._retrieve_evidence(queries, db, initiative_id)
        evidence_block = (
            f"\n\nRetrieved sources — cite as [1], [2] … inline:\n{context_str}"
            if context_str else ""
        )

        funder = setup_fields.get("financing_institution", "") or "DFI funders"
        ifc_cat = setup_fields.get("ifc_category", "")

        result = await llm_json(
            system=(
                "You are a senior E&S specialist drafting a professional Environmental & Social "
                "Management Plan (ESMP) for submission to a development finance institution. "
                "Using the confirmed risk themes, identified risks, and mitigation commitments, "
                "write a complete ESMP. The document must:\n"
                "  • Open with an Executive Summary (4–6 sentences: project overview, "
                "    IFC category rationale, key risks, and the management approach)\n"
                "  • Include one section per risk theme. Each section must describe the risks, "
                "    mitigation measures, and monitoring commitments in professional prose. "
                "    Cite retrieved sources as [1], [2], etc. where relevant.\n"
                "  • Close with a Monitoring & Reporting section describing the overall framework "
                "    (frequency, responsible parties, reporting to funder)\n"
                "  • Use formal language appropriate for a DFI submission\n\n"
                "Return JSON with keys:\n"
                "  title (string),\n"
                "  executive_summary (string),\n"
                "  sections (list of {theme, body} — one per risk theme),\n"
                "  monitoring_and_reporting (string)"
            ),
            user_msg=(
                f"Project: {project_type}, Geography: {geography}, "
                f"IFC Category: {ifc_cat}, Funder: {funder}\n\n"
                f"Risk themes, risks, and mitigation:\n{outline_text}"
                f"{evidence_block}"
            ),
            model="gpt-4.1",
        )
        result = result or {"title": "Environmental & Social Management Plan"}
        if citations:
            result["citations"] = citations
        return result
