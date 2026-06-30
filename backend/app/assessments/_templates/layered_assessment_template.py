"""Template for a Nitrogen assessment assessment using the staged workflow.

Assessment assessments are an ordered sequence of confirmable stages:
  1. A list/categorized_list stage for top-level categories or themes
  2. A list/categorized_workspace stage for items grouped under those categories
  3. Optionally a record/categorized_workspace stage for per-item detail views

Copy this file, rename the class, and implement the required methods.
Register the assessment in backend/app/assessments/registry.py.
"""

from __future__ import annotations

from typing import Any

from app.assessments.base import (
    BaseAssessment,
    FieldDef,
    PopulationStep,
    StageDef,
    AssessmentDefinition,
    AssessmentManifest,
)
from app.assessments.utils import llm_json


class ExampleLayeredAssessment(BaseAssessment):
    @property
    def definition(self) -> AssessmentDefinition:
        return AssessmentDefinition(
            id="example_layered_assessment",
            name="Example Layered Assessment",
            description="Short user-facing summary of the assessment.",
            icon="ListChecks",
            output_type="assessment_document",
            category="assessment",
            keywords=["example"],
            export_format="docx",
        )

    @property
    def manifest(self) -> AssessmentManifest:
        return AssessmentManifest(
            **self.definition.__dict__,
            goal="State the final decision-support output this assessment creates.",
            primary_ui_object="categorized_workspace",
            export_artifact_types=["docx"],
            adapter_bindings={"research_source": "retrieval"},
            input_dependencies=[],
            produced_outputs=["example_document"],
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
                    PopulationStep("adapt_with_ai_from_project_materials"),
                    PopulationStep("await_user_confirmation"),
                ],
            ),
            StageDef(
                id="items",
                title="Items",
                component="list",
                widget="categorized_workspace",
                fields=[
                    FieldDef("name", "text", required=True, label="Name"),
                    FieldDef("category", "text", required=True, label="Category"),
                    FieldDef("summary", "long_text", label="Summary"),
                ],
                population=[
                    PopulationStep("read_confirmed_prior_stage", {"stage_id": "categories"}),
                    PopulationStep("propose_with_ai"),
                    PopulationStep("await_user_confirmation"),
                ],
            ),
        ]

    # ------------------------------------------------------------------ #
    # Population hooks — implement these to drive AI generation            #
    # ------------------------------------------------------------------ #

    async def generate_items_for_stage(
        self,
        stage_id: str,
        step_type: str,
        context: dict,
        prior_data: dict[str, Any],
    ) -> list[dict]:
        """Generate items for AI-driven population steps.

        Return a list of content dicts (one per item); the executor wraps them.
        """
        if stage_id == "categories":
            data = await llm_json(
                system=(
                    "Generate 5–6 relevant categories for the given project. "
                    "Return JSON with key 'categories', a list of objects with 'label' and 'description'."
                ),
                user_msg=f"Project: {context.get('project_title', '')}\n{context.get('project_description', '')}",
                context=context,
            )
            return [
                {"label": c.get("label", ""), "description": c.get("description", "")}
                for c in data.get("categories", [])
            ]

        elif stage_id == "items":
            prior_cats = (prior_data.get("categories") or {}).get("data", {}).get("items", [])
            cat_labels = [i["content"].get("label", "") for i in prior_cats]
            data = await llm_json(
                system=(
                    "For each category, generate 3–4 items. "
                    "Return JSON with key 'items', a list of objects with 'name', 'category', 'summary'."
                ),
                user_msg=f"Categories: {', '.join(cat_labels)}\nProject: {context.get('project_title', '')}",
                context=context,
            )
            return [
                {"name": i.get("name", ""), "category": i.get("category", ""), "summary": i.get("summary", "")}
                for i in data.get("items", [])
            ]

        return []

    async def generate_export(self, confirmed_stages: dict[str, Any], context: dict) -> bytes:
        """Generate DOCX from confirmed stage data. Implement document synthesis here."""
        from app.services.docx_exporter import DocxExporterService
        result = {
            "title": self.definition.name,
            "executive_summary": "Example assessment summary.",
            "sections": [],
        }
        exporter = DocxExporterService()
        return exporter.generate_assessment_docx(
            content=result,
            initiative_title=context.get("project_title", ""),
        )
