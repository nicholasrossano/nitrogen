"""
LCOE Tool — Levelized Cost of Energy modeling.

Stage workflow:
  1. Inputs  (table / editable_table)   — pre-populated from engine defaults,
     then enriched from project materials; user confirms.
  2. Results (computed_results / lcoe_results) — auto-computed after Inputs
     are confirmed; user confirms.

Chat path uses execute_from_conversation() (not part of the stage contract).
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.adapters import get_adapter_registry
from app.config import get_settings
from app.core.execution_context import ExecutionContext
from app.core.llm_client import get_openai_client, record_usage_from_response
from app.modules.base import (
    BaseModule,
    DecisionLogAttribution,
    FieldDef,
    PopulationStep,
    StageDef,
    ExecutionModel,
    ModuleManifest,
    ProgressCallback,
    RefinementModel,
    ModuleDefinition,
    ModuleInput,
    ModuleOutput,
)
from app.models.initiative import Initiative
from app.models.onboarding import ChatMessage

settings = get_settings()
logger = logging.getLogger(__name__)

INPUT_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "technology_type": {
            "type": "string",
            "description": "Energy technology: solar_pv, wind, battery, mini_grid, clean_cooking, or other",
        },
        "net_capacity_kw": {"type": "number", "description": "Net installed capacity in kW"},
        "capacity_factor": {"type": "number", "description": "Capacity factor as a decimal (0-1)"},
        "total_capex": {"type": "number", "description": "Total capital expenditure in project currency"},
        "annual_opex": {"type": "number", "description": "Annual operations & maintenance cost"},
        "annual_fuel_cost": {"type": "number", "description": "Annual fuel cost — 0 if N/A"},
        "discount_rate": {"type": "number", "description": "Discount rate / WACC as a decimal"},
        "project_life_years": {"type": "integer", "description": "Project operational lifetime in years"},
        "degradation_rate": {"type": "number", "description": "Annual production degradation as a decimal"},
        "construction_years": {"type": "integer", "description": "Number of construction years"},
        "currency": {"type": "string", "description": "Currency code (e.g. USD, EUR, KES)"},
        "location": {"type": "string", "description": "Project location / country / region"},
    },
}


class LCOETool(BaseModule):
    """LCOE modeling tool."""

    @property
    def definition(self) -> ModuleDefinition:
        return ModuleDefinition(
            id="lcoe_model",
            name="LCOE Model",
            description="Calculate the Levelized Cost of Energy for a project — extracts inputs from conversation and documents, fills gaps with assumptions, and produces transparent cost estimates.",
            icon="Calculator",
            output_type="lcoe",
            category="analysis",
            keywords=[
                "lcoe", "levelized cost", "cost of energy", "cost per kwh",
                "project economics", "feasibility", "capex", "opex",
                "discount rate", "wacc", "capacity factor",
                "solar", "wind", "battery", "mini-grid", "clean cooking",
            ],
            export_format="xlsx",
        )

    @property
    def manifest(self) -> ModuleManifest:
        return ModuleManifest(
            **self.definition.__dict__,
            goal="Estimate project levelized cost of energy and sensitivity ranges.",
            primary_ui_object="lcoe_results",
            investigate_hint="Prefer project-specific engineering or vendor data when available; otherwise anchor assumptions to comparable technology, geography, and operating conditions.",
            export_artifact_types=["xlsx"],
            adapter_bindings={"core_engine": "lcoe"},
            input_dependencies=["solar_estimate"],
            produced_outputs=["lcoe_kwh", "lcoe_sensitivity", "lcoe_inputs"],
            downstream_dependencies=[],
            assumptions_behavior="tracks",
            evidence_behavior="none",
            decision_log_attribution=DecisionLogAttribution(
                adapter_labels={"lcoe": "LCOE engine"},
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
                ],
                population=[
                    PopulationStep("start_from_predefined_rows"),
                    PopulationStep("extract_from_project_materials"),
                    PopulationStep("infer_missing_with_ai", {"require_citation": True}),
                    PopulationStep("await_user_confirmation"),
                ],
            ),
            StageDef(
                id="results",
                title="Results",
                component="computed_results",
                widget="lcoe_results",
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
        """Return default LCOE input rows from the engine."""
        if stage_id != "inputs":
            return []
        from app.services.lcoe_engine import LCOEEngine

        tech_type = context.get("tool_inputs", {}).get("technology_type") or context.get("project_type")
        known_values: dict[str, Any] = {}
        if tech_type:
            known_values["technology_type"] = tech_type

        inputs = LCOEEngine.build_default_inputs(tech_type=tech_type, known_values=known_values)
        rows = []
        for key, inp_obj in inputs.items():
            d = inp_obj.to_dict() if hasattr(inp_obj, "to_dict") else {}
            row = {
                "field_name": key,
                "variable": d.get("label", key),
                "value": d.get("value"),
                "unit": d.get("unit", ""),
                "category": d.get("category", "general"),
                "status": d.get("status", "assumed"),
                "rationale": d.get("rationale", ""),
            }
            if d.get("field_type"):
                row["field_type"] = d.get("field_type")
            if d.get("options") is not None:
                row["options"] = d.get("options")
            rows.append(row)
        return rows

    async def compute_stage(
        self,
        stage_id: str,
        confirmed_stages: dict[str, Any],
        context: dict,
    ) -> dict[str, Any]:
        """Compute LCOE results from confirmed inputs stage."""
        if stage_id != "results":
            raise ValueError(f"compute_stage called for unexpected stage '{stage_id}'")

        inputs_data = (confirmed_stages.get("inputs") or {}).get("data") or {}
        items = inputs_data.get("items", [])

        # Reconstruct known_values from item rows and retain row-level metadata
        # so computed widget inputs preserve user engagement status.
        known_values: dict[str, Any] = {}
        stage_input_meta: dict[str, dict[str, Any]] = {}
        tech_type = None
        for item in items:
            content = item.get("content", {})
            var = content.get("variable", "")
            explicit_field_name = content.get("field_name")
            key = explicit_field_name if isinstance(explicit_field_name, str) and explicit_field_name else _variable_name_to_key(var)
            val = content.get("value")
            stage_input_meta[key] = {
                "value": val,
                "status": content.get("status"),
                "source": content.get("source"),
            }
            if val is None:
                continue
            if key == "technology_type":
                tech_type = val
            else:
                known_values[key] = val

        widget_data = await self.recalculate_from_values(tech_type=tech_type, known_values=known_values)
        result_inputs = widget_data.get("inputs")
        if isinstance(result_inputs, dict):
            for field_name, meta in stage_input_meta.items():
                current = result_inputs.get(field_name)
                if not isinstance(current, dict):
                    continue
                current["value"] = meta.get("value")
                if isinstance(meta.get("status"), str):
                    current["status"] = meta["status"]
                if isinstance(meta.get("source"), str):
                    current["source"] = meta["source"]
        return widget_data

    async def recalculate_from_values(
        self,
        tech_type: str | None,
        known_values: dict[str, Any],
    ) -> dict[str, Any]:
        adapter = get_adapter_registry().get("lcoe")
        if adapter is None:
            raise RuntimeError("lcoe adapter is not registered.")
        ctx = ExecutionContext(
            user_id="system",
            user_email=None,
            initiative_id=None,
            initiative_role=None,
            ai_access_granted=True,
            is_byok=False,
            request_id="lcoe:compute_stage",
        )
        result = await adapter.execute(ctx, None, {"tech_type": tech_type, "known_values": known_values})
        result_data: dict[str, Any] = dict(result.output)
        result_data["technology_type"] = tech_type
        return result_data

    async def generate_export(
        self,
        confirmed_stages: dict[str, Any],
        context: dict,
    ) -> bytes:
        """Generate XLSX from confirmed inputs and results."""
        results_data = (confirmed_stages.get("results") or {}).get("data") or {}
        widget_data = results_data.get("widget_data", {})

        from app.services.lcoe_engine import LCOEEngine
        return LCOEEngine.export_xlsx(widget_data)

    def is_exportable(self, content: dict) -> bool:
        return bool(
            isinstance(content, dict)
            and content.get("computable", False)
            and content.get("inputs")
        )

    # ------------------------------------------------------------------ #
    # Chat-path methods (not part of stage contract)                       #
    # ------------------------------------------------------------------ #

    @property
    def required_inputs(self) -> list[ModuleInput]:
        return [
            ModuleInput(
                name="net_capacity_kw",
                label="Net Capacity (kW)",
                description="What is the installed capacity of the project in kW?",
                input_type="number",
                placeholder="e.g. 500",
            ),
            ModuleInput(
                name="total_capex",
                label="Total CAPEX",
                description="What is the total capital expenditure?",
                input_type="number",
                placeholder="e.g. 750000",
            ),
            ModuleInput(
                name="annual_opex",
                label="Annual O&M Cost",
                description="What is the estimated annual operations & maintenance cost?",
                input_type="number",
                placeholder="e.g. 15000",
            ),
        ]

    @property
    def optional_inputs(self) -> list[ModuleInput]:
        return [
            ModuleInput(
                name="capacity_factor",
                label="Capacity Factor",
                description="Expected capacity factor (0-1). Will use technology default if not provided.",
                input_type="number",
                required=False,
                placeholder="e.g. 0.18",
            ),
            ModuleInput(
                name="discount_rate",
                label="Discount Rate / WACC",
                description="Discount rate as a decimal. Default 8%.",
                input_type="number",
                required=False,
                default=0.08,
            ),
        ]

    @property
    def execution_model(self) -> ExecutionModel:
        return ExecutionModel.SYNC_COMPUTATION

    @property
    def refinement_model(self) -> RefinementModel:
        return RefinementModel.EDIT_AND_RECOMPUTE

    async def extract_inputs_from_text(
        self,
        conversation_text: str,
        tech_type: str | None = None,
        user_id: str | None = None,
        db: AsyncSession | None = None,
    ) -> dict[str, Any]:
        client, is_byok = await get_openai_client(user_id, db)
        try:
            resp = await client.chat.completions.create(
                model=settings.openai_orchestration_model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are an energy project analyst. Extract any LCOE-relevant "
                            "numeric inputs from the conversation below. "
                            "Only include values that are explicitly stated or clearly implied. "
                            "Convert units where needed (e.g. MW → kW). "
                            "For capacity_factor and discount_rate, return as decimals (0-1)."
                        ),
                    },
                    {"role": "user", "content": conversation_text},
                ],
                tools=[{
                    "type": "function",
                    "function": {
                        "name": "extract_lcoe_inputs",
                        "description": "Extract LCOE model inputs from conversation",
                        "parameters": INPUT_EXTRACTION_SCHEMA,
                    },
                }],
                tool_choice={"type": "function", "function": {"name": "extract_lcoe_inputs"}},
                temperature=0,
            )
            if user_id and db:
                await record_usage_from_response(user_id, settings.openai_orchestration_model, resp, db, is_byok=is_byok)
            tool_call = resp.choices[0].message.tool_calls[0]
            extracted = json.loads(tool_call.function.arguments)
            return {k: v for k, v in extracted.items() if v is not None}
        except Exception as e:
            logger.error(f"LCOE input extraction failed: {e}")
            return {}

    async def recalculate(self, inputs_dict: dict[str, dict[str, Any]]) -> dict[str, Any]:
        """Fast path recalculate for chat widget edits."""
        known_values: dict[str, Any] = {}
        for key, value in inputs_dict.items():
            if isinstance(value, dict):
                known_values[key] = value.get("value")
            else:
                known_values[key] = value
        tech_type = known_values.pop("technology_type", None)
        return await self.recalculate_from_values(tech_type=tech_type, known_values=known_values)

    async def execute_from_conversation(
        self,
        conversation_text: str,
        planner_args: dict | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> tuple[str, dict]:
        async def _progress(msg: str) -> None:
            if on_progress:
                await on_progress(msg)

        planner_args = planner_args or {}
        tech_type = planner_args.get("technology_type")

        await _progress("Extracting inputs from conversation...")
        extracted = await self.extract_inputs_from_text(conversation_text, tech_type)

        if not tech_type and extracted.get("technology_type"):
            tech_type = extracted.pop("technology_type", None)
        extracted.pop("location", None)

        await _progress("Calculating LCOE...")
        widget_data = await self.recalculate_from_values(tech_type=tech_type, known_values=extracted)

        if widget_data.get("computable"):
            widget_type = "lcoe_output"
            lcoe_result = (widget_data.get("result") or {})
            await _progress(
                f"LCOE: {lcoe_result.get('currency', '')} {lcoe_result.get('lcoe', 0):.4f}/kWh "
                f"({lcoe_result.get('assumption_count', 0)} assumptions)"
            )
        else:
            widget_type = "lcoe_inputs"
            await _progress(
                f"Need {len(widget_data.get('missing_essentials', []))} more inputs — showing input table"
            )

        return widget_type, widget_data


def _variable_name_to_key(variable_label: str) -> str:
    """Map human-readable variable labels back to engine field keys."""
    mapping = {
        "Net Capacity": "net_capacity_kw",
        "Capacity Factor": "capacity_factor",
        "Total CAPEX": "total_capex",
        "Annual O&M": "annual_opex",
        "Annual Fuel Cost": "annual_fuel_cost",
        "Discount Rate": "discount_rate",
        "Project Life": "project_life_years",
        "Degradation Rate": "degradation_rate",
        "Construction Years": "construction_years",
        "Technology Type": "technology_type",
        "Currency": "currency",
    }
    for label, key in mapping.items():
        if label.lower() in variable_label.lower():
            return key
    # Fallback: snake_case the label
    return variable_label.lower().replace(" ", "_").replace("(", "").replace(")", "").replace("/", "_")
