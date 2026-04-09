"""Template for a layered Nitrogen assessment module."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.assessment_base import (
    AssessmentModuleDef,
    BaseAssessmentModule,
    BuildLayerDef,
    SetupFieldDef,
    make_build_item,
)
from app.modules.base import ModuleDefinition, ModuleManifest


class ExampleLayeredModule(BaseAssessmentModule):
    @property
    def definition(self) -> ModuleDefinition:
        return ModuleDefinition(
            id="example_layered_module",
            name="Example Layered Module",
            description="Short user-facing summary of the assessment.",
            icon="ListChecks",
            output_type="example_document",
            category="analysis",
            keywords=["example"],
        )

    @property
    def manifest(self) -> ModuleManifest:
        return ModuleManifest(
            **self.definition.__dict__,
            goal="State the final decision-support output this module creates.",
            primary_ui_object="module_workspace",
            workspace_build_widget="module_workspace",
            workspace_output_widget="document_viewer",
            export_artifact_types=[],
            adapter_bindings={},
            input_dependencies=[],
            produced_outputs=["example_document"],
            downstream_dependencies=[],
            assumptions_behavior="tracks",
            evidence_behavior="none",
        )

    @property
    def assessment_definition(self) -> AssessmentModuleDef:
        return AssessmentModuleDef(
            setup_fields=[
                SetupFieldDef(
                    name="geography",
                    label="Geography",
                    description="Where is the project happening?",
                    required=False,
                    placeholder="e.g. Kenya",
                ),
                SetupFieldDef(
                    name="focus_area",
                    label="Focus Area",
                    description="What should this assessment focus on?",
                    required=True,
                    placeholder="e.g. grid access",
                ),
            ],
            build_layers=[
                BuildLayerDef(
                    id="factors",
                    name="Key Factors",
                    view_type="structured_list",
                    description="Identify the major factors to consider.",
                    item_schema={"type": "object"},
                ),
                BuildLayerDef(
                    id="recommendations",
                    name="Recommendations",
                    view_type="structured_list",
                    description="Turn the confirmed factors into recommendations.",
                    item_schema={"type": "object"},
                ),
            ],
            output_type="example_document",
        )

    async def generate_setup_defaults(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        context: dict,
    ) -> dict:
        return {
            "geography": context.get("geography") or "",
            "focus_area": context.get("project_description") or "",
        }

    async def generate_layer(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        layer_id: str,
        setup_fields: dict,
        prior_layers: dict,
        context: dict,
    ) -> list[dict]:
        if layer_id == "factors":
            return [
                make_build_item(
                    {
                        "title": "Example factor",
                        "summary": "Why this matters for the project.",
                    },
                    rationale="Template placeholder item",
                )
            ]

        return [
            make_build_item(
                {
                    "title": "Example recommendation",
                    "summary": "Action based on the confirmed factors.",
                },
                rationale="Template placeholder item",
            )
        ]

    async def generate_output(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        setup_fields: dict,
        confirmed_build: dict,
    ) -> dict:
        return {
            "title": self.definition.name,
            "setup_fields": setup_fields,
            "build": confirmed_build,
        }
