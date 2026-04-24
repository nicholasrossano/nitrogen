"""
Template for a widget-backed (calculator) Nitrogen module using the staged workflow.

Calculator modules have two stages:
  1. Inputs  (table / editable_table)   — user confirms pre-populated input rows
  2. Results (computed_results / <widget>)  — auto-computed after Inputs confirmed

Copy this file, rename the class, and fill in the TODOs.
Register the module in backend/app/modules/registry.py.
Create the matching React widget in frontend/src/components/widgets/ and
register it in frontend/src/lib/widgetRegistry.tsx.
"""

from __future__ import annotations

from typing import Any

from app.modules.base import (
    BaseModule,
    DecisionLogAttribution,
    FieldDef,
    PopulationStep,
    StageDef,
    ExecutionModel,
    ModuleDefinition,
    ModuleInput,
    ModuleManifest,
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
            primary_ui_object="example_results",
            export_artifact_types=["xlsx"],
            adapter_bindings={"core_engine": "example_adapter"},
            input_dependencies=[],
            produced_outputs=["example_output"],
            downstream_dependencies=[],
            assumptions_behavior="tracks",
            evidence_behavior="none",
            decision_log_attribution=DecisionLogAttribution(
                adapter_labels={"example_adapter": "Example adapter"},
            ),
        )

    @property
    def stage_defs(self) -> list[StageDef]:
        return [
            StageDef(
                id="inputs",
                title="Inputs",
                component="table",
                widget="editable_table",
                allow_add_rows=False,
                fields=[
                    FieldDef("variable", "text", required=True, label="Variable"),
                    FieldDef("value", "number", label="Value"),
                    FieldDef("unit", "text", label="Unit"),
                    FieldDef("source", "text", label="Source"),
                    FieldDef("rationale", "long_text", label="Rationale"),
                ],
                population=[
                    PopulationStep("start_from_predefined_rows"),
                    PopulationStep("extract_from_project_materials"),
                    PopulationStep("infer_missing_with_ai"),
                    PopulationStep("await_user_confirmation"),
                ],
            ),
            StageDef(
                id="results",
                title="Results",
                component="computed_results",
                widget="example_results",   # register this widget in widgetRegistry.tsx
                population=[
                    PopulationStep("read_confirmed_prior_stage", {"stage_id": "inputs"}),
                    PopulationStep("compute_with_module_logic"),
                    PopulationStep("await_user_confirmation"),
                ],
            ),
        ]

    # ------------------------------------------------------------------ #
    # Population hooks                                                     #
    # ------------------------------------------------------------------ #

    async def get_predefined_rows(self, stage_id: str, context: dict) -> list[dict]:
        """Return default input rows from the engine."""
        if stage_id != "inputs":
            return []
        # TODO: call your engine's build_default_inputs() method here
        return [
            {"variable": "Example Input", "value": 42, "unit": "", "source": "Engine default", "rationale": ""},
        ]

    async def compute_stage(
        self,
        stage_id: str,
        confirmed_stages: dict[str, Any],
        context: dict,
    ) -> dict[str, Any]:
        """Compute results from confirmed inputs stage."""
        if stage_id != "results":
            raise ValueError(f"compute_stage called for unexpected stage '{stage_id}'")

        inputs_data = (confirmed_stages.get("inputs") or {}).get("data") or {}
        items = inputs_data.get("items", [])

        # TODO: reconstruct engine inputs from items and run computation
        known_values = {
            item["content"]["variable"]: item["content"].get("value")
            for item in items
            if item.get("content", {}).get("variable")
        }

        # TODO: call your adapter and return widget_data
        return {
            "computable": True,
            "inputs": known_values,
            "result": {"value": sum(v for v in known_values.values() if isinstance(v, (int, float)))},
        }

    async def generate_export(self, confirmed_stages: dict[str, Any], context: dict) -> bytes:
        """Generate XLSX from confirmed inputs and results."""
        # TODO: implement real export
        raise NotImplementedError("Implement generate_export() for this module")

    # ------------------------------------------------------------------ #
    # Chat-path methods (optional)                                         #
    # ------------------------------------------------------------------ #

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

    async def execute_from_conversation(
        self,
        conversation_text: str,
        planner_args: dict | None = None,
        on_progress=None,
    ) -> tuple[str, dict]:
        """Execute from chat context. Override if the module supports chat."""
        raise NotImplementedError("This module does not support conversation-based execution")
