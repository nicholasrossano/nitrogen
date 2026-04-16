"""Stakeholder Assessment Module.

Stage workflow:
  1. Stakeholder Categories  (list / categorized_list)
  2. Stakeholders            (list / categorized_workspace)
  3. Stakeholder Details     (record / categorized_workspace)
  4. Map                     (computed_results / assessment_map)

Exports:
  - Write-up DOCX: LLM-generated, cached in workflow_state after first generation.
  - Decision Log DOCX: deterministic extraction, no LLM, always fast.
"""

from __future__ import annotations

import logging
import re
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.base import BaseModule, FieldDef, PopulationStep, StageDef, ModuleDefinition, ModuleManifest
from app.modules.retrieval import retrieve_evidence
from app.modules.utils import llm_json, infer_category_icon
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
            StageDef(
                id="map",
                title="Map",
                component="computed_results",
                widget="assessment_map",
                population=[
                    PopulationStep("read_confirmed_prior_stage", {"stage_id": "details"}),
                    PopulationStep("compute_with_module_logic"),
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

    async def compute_stage(
        self,
        stage_id: str,
        confirmed_stages: dict[str, Any],
        context: dict,
    ) -> dict[str, Any]:
        """Build the assessment_map widget_data from confirmed categories + stakeholders."""
        if stage_id != "map":
            raise ValueError(f"compute_stage called for unexpected stage '{stage_id}'")

        category_items = (confirmed_stages.get("categories") or {}).get("data", {}).get("items", [])
        stakeholder_items = (confirmed_stages.get("stakeholders") or {}).get("data", {}).get("items", [])
        records = (confirmed_stages.get("details") or {}).get("data", {}).get("records", {})

        pillar_colors = [
            "#005e72", "#6b3fa0", "#1a7340", "#c05621",
            "#1d4ed8", "#92400e", "#065f46", "#7e22ce",
        ]
        groups = []
        for idx, cat_item in enumerate(category_items):
            content = cat_item.get("content", {})
            label = content.get("label", "")
            if not label:
                continue
            icon = content.get("icon", "Compass")
            color = pillar_colors[idx % len(pillar_colors)]

            stakeholders = [
                s for s in stakeholder_items
                if s.get("content", {}).get("category", "") == label
            ]
            items = []
            for sh in stakeholders:
                sc = sh.get("content", {})
                record = records.get(sh.get("id", ""), {})
                items.append({
                    "id": sh.get("id", ""),
                    "name": sc.get("name", ""),
                    "description": sc.get("why_they_matter", ""),
                    "category": label,
                    "influence_level": record.get("influence_level", ""),
                    "impact_level": record.get("impact_level", ""),
                    "engagement_priority": record.get("engagement_priority", ""),
                    "role_in_project": record.get("role_in_project", ""),
                    "provenance": sh.get("provenance", {}),
                })
            groups.append({
                "id": cat_item.get("id", ""),
                "label": label,
                "icon": icon,
                "color": color,
                "items": items,
            })

        return {"groups": groups, "module_id": "stakeholder_assessment"}

    async def generate_writeup_content(
        self,
        confirmed_stages: dict[str, Any],
        context: dict,
    ) -> dict[str, Any]:
        """Generate the write-up as a JSON dict (cacheable). Called by the export endpoint."""
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
                "Write a woven, prosaic stakeholder assessment — NOT a list of sections for each category. "
                "Weave stakeholder insights into coherent analytical narrative:\n"
                "  • Executive Summary (3–5 sentences)\n"
                "  • 3–4 thematic sections that cut across stakeholder groups (e.g. 'Power and Influence', "
                "    'Community and Civil Society', 'Regulatory Landscape'). "
                "    Cite sources as [1], [2], etc.\n"
                "  • Engagement Strategy with priority actions\n"
                "  • Risk Considerations\n\n"
                "Return JSON with keys: title, executive_summary, sections (list of {heading, body}), "
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
            {
                "label": c.get("label", c.get("title", "")),
                "description": c.get("description", ""),
                "icon": infer_category_icon(c.get("label", c.get("title", ""))),
            }
            for c in data.get("categories", [])
        ]

    async def _generate_stakeholders(self, context: dict, category_items: list[dict]) -> list[dict]:
        categories = [
            i["content"].get("label", i["content"].get("title", "")).strip()
            for i in category_items
            if i["content"].get("label", i["content"].get("title", "")).strip()
        ]
        if not categories:
            return []
        categories_list = "\n".join(f"- {c}" for c in categories)
        data = await llm_json(
            system=(
                "You are an expert stakeholder analyst. For each stakeholder category listed, "
                "identify 3–5 specific stakeholders. Each item must have 'name', 'category' "
                "(exactly matching one category label), and 'why_they_matter'. "
                "Do not skip categories. Ensure every category has at least 3 stakeholders. "
                "Return JSON with key 'stakeholders', a flat list."
            ),
            user_msg=(
                f"Project: {context.get('project_title', 'Unknown')}\n"
                f"Geography: {context.get('geography', '')}\n"
                f"Project type: {context.get('project_type', '')}\n"
                f"Stakeholder categories:\n{categories_list}"
            ),
        )
        stakeholders_by_category = self._bucket_stakeholders(data.get("stakeholders", []), categories)

        min_per_category = 3
        underfilled = [c for c in categories if len(stakeholders_by_category.get(c, [])) < min_per_category]
        if underfilled:
            shortfalls = "\n".join(
                f"- {c}: need at least {min_per_category - len(stakeholders_by_category.get(c, []))} more"
                for c in underfilled
            )
            existing = "\n".join(
                f"- {c}: {', '.join(s['name'] for s in stakeholders_by_category.get(c, [])) or '(none)'}"
                for c in categories
            )
            refill = await llm_json(
                system=(
                    "You are an expert stakeholder analyst. Fill only missing stakeholders for underfilled categories. "
                    "Return JSON with key 'stakeholders' as a flat list of objects with "
                    "'name', 'category', and 'why_they_matter'. Category values must exactly match one listed category."
                ),
                user_msg=(
                    f"Project: {context.get('project_title', 'Unknown')}\n"
                    f"Geography: {context.get('geography', '')}\n"
                    f"Project type: {context.get('project_type', '')}\n"
                    f"All categories:\n{categories_list}\n\n"
                    f"Existing stakeholders by category:\n{existing}\n\n"
                    f"Underfilled categories:\n{shortfalls}"
                ),
            )
            refill_bucket = self._bucket_stakeholders(refill.get("stakeholders", []), categories)
            for category in categories:
                existing_names = {s["name"].strip().lower() for s in stakeholders_by_category.get(category, [])}
                for stakeholder in refill_bucket.get(category, []):
                    key = stakeholder["name"].strip().lower()
                    if key not in existing_names:
                        stakeholders_by_category.setdefault(category, []).append(stakeholder)
                        existing_names.add(key)

        output: list[dict] = []
        for category in categories:
            output.extend(stakeholders_by_category.get(category, [])[:6])
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

    def _bucket_stakeholders(self, raw_stakeholders: list[dict], categories: list[str]) -> dict[str, list[dict]]:
        buckets: dict[str, list[dict]] = {c: [] for c in categories}
        seen: set[tuple[str, str]] = set()

        for stakeholder in raw_stakeholders or []:
            name = (stakeholder.get("name") or "").strip()
            category = self._normalize_category(stakeholder.get("category", ""), categories)
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
                    "why_they_matter": (stakeholder.get("why_they_matter") or "").strip(),
                }
            )

        return buckets

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
