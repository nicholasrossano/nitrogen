"""
Template for a widget-backed Nitrogen module.

Lifecycle: setup -> build (single widget stage) -> output

Copy this file, rename the class, and fill in the TODOs.
Register the module in backend/app/modules/registry.py.
Create the matching React widget in frontend/src/components/widgets/ and
register it in frontend/src/lib/widgetRegistry.tsx.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.base import (
    BaseModule,
    ExecutionModel,
    ModuleDefinition,
    ModuleInput,
    ModuleManifest,
    ModuleOutput,
    RefinementModel,
)


class ExampleWidgetModule(BaseModule):
    @property
    def definition(self) -> ModuleDefinition:
        return ModuleDefinition(
            id="example_widget_module",
            name="Example Widget Module",
            description="Short user-facing summary of what this module does.",
            icon="Calculator",
            output_type="example_output",
            category="analysis",
            keywords=["example"],
            export_format="xlsx",
        )

    @property
    def manifest(self) -> ModuleManifest:
        return ModuleManifest(
            **self.definition.__dict__,
            goal="State the user outcome this module produces.",
            primary_ui_object="example_output",
            workspace_build_widget="example_inputs",
            workspace_output_widget="example_output",
            export_artifact_types=["xlsx"],
            adapter_bindings={"core_engine": "example_adapter"},
            input_dependencies=[],
            produced_outputs=["example_output"],
            downstream_dependencies=[],
            assumptions_behavior="tracks",
            evidence_behavior="none",
        )

    @property
    def required_inputs(self) -> list[ModuleInput]:
        return [
            ModuleInput(
                name="example_input",
                label="Example Input",
                description="Describe the minimum required input.",
                input_type="number",
                placeholder="e.g. 42",
            )
        ]

    @property
    def execution_model(self) -> ExecutionModel:
        return ExecutionModel.SYNC_COMPUTATION

    @property
    def refinement_model(self) -> RefinementModel:
        return RefinementModel.EDIT_AND_RECOMPUTE

    @property
    def workspace_setup_fields(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "project_title",
                "label": "Project Title",
                "description": "Optional working title for the run.",
                "field_type": "text",
                "required": False,
                "placeholder": "Project title",
            }
        ]

    async def build_workspace_widget_data(
        self,
        known_values: dict[str, Any],
    ) -> dict[str, Any]:
        """Convert project/setup context into initial widget_data for the build stage."""
        return {
            "inputs": {
                "example_input": {
                    "field_name": "example_input",
                    "label": "Example Input",
                    "value": known_values.get("example_input"),
                    "unit": "",
                    "source": "chat",
                    "status": "inferred",
                }
            },
            "computable": known_values.get("example_input") is not None,
            "result": None,
        }

    async def recalculate(
        self,
        inputs_dict: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        """Fast edit loop called on every widget change; returns updated widget_data."""
        value = (inputs_dict.get("example_input") or {}).get("value")
        return {
            "inputs": inputs_dict,
            "computable": value is not None,
            "result": {"value": value},
        }

    async def export(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        widget_data: dict[str, Any],
    ) -> bytes:
        """Produce the export artifact (xlsx, pdf, etc.) from confirmed widget_data."""
        raise NotImplementedError("Implement export() for this module.")

    async def execute(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        inputs: dict[str, Any],
        include_corpus: bool = True,
        alignment=None,
    ) -> ModuleOutput:
        content = await self.recalculate(
            {
                key: {"field_name": key, "value": value}
                for key, value in inputs.items()
            }
        )
        return ModuleOutput(
            module_id=self.definition.id,
            output_type=self.definition.output_type,
            title=self.definition.name,
            content=content,
        )
