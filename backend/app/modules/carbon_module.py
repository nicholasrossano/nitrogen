"""
Carbon Emissions Calculator Tool — callable within chat.

Stage workflow:
  1. Inputs  (table / editable_table)   — pre-populated from engine defaults; user confirms.
  2. Results (computed_results / carbon_results) — auto-computed after Inputs confirmed; user confirms.

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
        "method_pack": {
            "type": "string",
            "enum": [
                "cookstoves", "fuel_switch", "safe_water",
                "grid_renewable", "solar_home", "biodigester", "efficient_lighting",
            ],
            "description": "Project type determining calculation methodology.",
        },
        "usage_rate": {"type": "number"},
        "adoption_rate": {"type": "number"},
        "baseline_fuel_type": {"type": "string"},
        "fnrb": {"type": "number"},
        "crediting_period_years": {"type": "integer"},
        "devices_households": {"type": "number"},
        "baseline_fuel_consumption_kg_yr": {"type": "number"},
        "project_fuel_type": {"type": "string"},
        "project_fuel_consumption_kg_yr": {"type": "number"},
        "baseline_efficiency": {"type": "number"},
        "project_efficiency": {"type": "number"},
        "fuel_savings_pct": {"type": "number"},
        "emission_factor_kgco2_per_kg": {"type": "number"},
        "people_served": {"type": "number"},
        "water_per_person_day": {"type": "number"},
        "proportion_already_safe": {"type": "number"},
        "proportion_still_boiling": {"type": "number"},
        "installed_capacity_kw": {"type": "number"},
        "capacity_factor": {"type": "number"},
        "grid_emission_factor": {"type": "number"},
        "num_systems": {"type": "number"},
        "system_capacity_wp": {"type": "number"},
        "peak_sun_hours": {"type": "number"},
        "baseline_fuel_consumption_l_yr": {"type": "number"},
        "num_digesters": {"type": "number"},
        "livestock_type": {"type": "string"},
        "num_animals": {"type": "number"},
        "num_lamps": {"type": "number"},
        "baseline_wattage": {"type": "number"},
        "project_wattage": {"type": "number"},
        "operating_hours_per_day": {"type": "number"},
    },
}


class CarbonTool(BaseModule):
    """Carbon emissions calculator."""

    @property
    def definition(self) -> ModuleDefinition:
        return ModuleDefinition(
            id="carbon_model",
            name="Carbon Emissions Calculator",
            description="Estimate emission reductions (tCO₂e) by comparing baseline vs project scenarios — extracts inputs from conversation and documents, fills gaps with methodology-aligned assumptions, and produces transparent, auditable results.",
            icon="Leaf",
            output_type="carbon",
            category="analysis",
            keywords=[
                "carbon", "emissions", "tco2", "tco2e", "emission reductions",
                "carbon credits", "cookstove", "cookstoves", "baseline",
                "fnrb", "leakage", "er calculation", "gold standard",
                "clean cooking", "fuel consumption", "emission factor",
                "fuel switch", "lpg", "biogas", "ethanol",
                "safe water", "water purification", "water filter",
                "solar", "wind", "renewable energy", "grid emission factor",
                "solar home system", "shs", "off-grid", "kerosene lamp",
                "biodigester", "manure", "methane", "livestock", "anaerobic",
                "efficient lighting", "led", "cfl", "incandescent", "lamp",
            ],
            export_format="xlsx",
        )

    @property
    def manifest(self) -> ModuleManifest:
        return ModuleManifest(
            **self.definition.__dict__,
            goal="Estimate project emission reductions and uncertainty sensitivity.",
            primary_ui_object="carbon_results",
            investigate_hint="Prefer methodology-approved defaults and project measurements first; otherwise use peer-reviewed or standards-based benchmarks from comparable project types and geographies.",
            export_artifact_types=["xlsx"],
            adapter_bindings={"core_engine": "carbon"},
            input_dependencies=[],
            produced_outputs=["annual_emission_reduction_tco2e", "carbon_sensitivity", "carbon_inputs"],
            downstream_dependencies=[],
            assumptions_behavior="tracks",
            evidence_behavior="none",
            decision_log_attribution=DecisionLogAttribution(
                adapter_labels={"carbon": "Nitrogen carbon engine"},
                widget_detail_labels={"method_pack": "Method pack"},
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
                widget="carbon_results",
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
        if stage_id != "inputs":
            return []
        from app.services.carbon_engine import CarbonEngine

        method_pack = context.get("tool_inputs", {}).get("method_pack") or context.get("project_type")
        known_values: dict[str, Any] = {}
        if method_pack:
            known_values["method_pack"] = method_pack

        inputs = CarbonEngine.build_default_inputs(method_pack=method_pack, known_values=known_values)
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
        if stage_id != "results":
            raise ValueError(f"compute_stage called for unexpected stage '{stage_id}'")

        inputs_data = (confirmed_stages.get("inputs") or {}).get("data") or {}
        items = inputs_data.get("items", [])

        known_values: dict[str, Any] = {}
        stage_input_meta: dict[str, dict[str, Any]] = {}
        method_pack = None
        for item in items:
            content = item.get("content", {})
            var = content.get("variable", "")
            explicit_field_name = content.get("field_name")
            key = explicit_field_name if isinstance(explicit_field_name, str) and explicit_field_name else var.lower().replace(" ", "_")
            val = content.get("value")
            stage_input_meta[key] = {
                "value": val,
                "status": content.get("status"),
                "source": content.get("source"),
            }
            if val is None:
                continue
            if "method_pack" in key or "project_type" in key:
                method_pack = val
            else:
                known_values[key] = val

        widget_data = await self.recalculate_from_values(method_pack=method_pack, known_values=known_values)
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
        method_pack: str | None,
        known_values: dict[str, Any],
    ) -> dict[str, Any]:
        adapter = get_adapter_registry().get("carbon")
        if adapter is None:
            raise RuntimeError("carbon adapter is not registered.")
        ctx = ExecutionContext(
            user_id="system",
            user_email=None,
            initiative_id=None,
            initiative_role=None,
            ai_access_granted=True,
            is_byok=False,
            request_id="carbon:compute_stage",
        )
        result = await adapter.execute(ctx, None, {"method_pack": method_pack, "known_values": known_values})
        result_data = dict(result.output)
        result_data["method_pack"] = method_pack
        return result_data

    async def generate_export(self, confirmed_stages: dict[str, Any], context: dict) -> bytes:
        results_data = (confirmed_stages.get("results") or {}).get("data") or {}
        widget_data = results_data.get("widget_data", {})
        from app.services.carbon_engine import CarbonEngine
        return CarbonEngine.export_xlsx(widget_data)

    def is_exportable(self, content: dict) -> bool:
        return bool(
            isinstance(content, dict)
            and content.get("computable", False)
            and content.get("inputs")
        )

    # ------------------------------------------------------------------ #
    # Chat-path methods                                                    #
    # ------------------------------------------------------------------ #

    @property
    def required_inputs(self) -> list[ModuleInput]:
        return [
            ModuleInput(
                name="devices_households",
                label="Devices / Households",
                description="How many devices or households does this project cover?",
                input_type="number",
                placeholder="e.g. 5000",
            ),
            ModuleInput(
                name="baseline_fuel_consumption_kg_yr",
                label="Baseline Fuel Consumption (kg/yr per device)",
                description="How much fuel does each household consume per year under the baseline?",
                input_type="number",
                placeholder="e.g. 2000",
            ),
        ]

    @property
    def optional_inputs(self) -> list[ModuleInput]:
        return [
            ModuleInput(
                name="project_fuel_consumption_kg_yr",
                label="Project Fuel Consumption (kg/yr per device)",
                description="How much fuel per household per year under the project scenario?",
                input_type="number",
                required=False,
                placeholder="e.g. 700",
            ),
            ModuleInput(
                name="fnrb",
                label="fNRB",
                description="Fraction of non-renewable biomass.",
                input_type="number",
                required=False,
                default=0.70,
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
        method_pack: str | None = None,
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
                            "You are a carbon project analyst. Extract any carbon-ER-relevant "
                            "numeric inputs from the conversation below. "
                            "Only include values that are explicitly stated or clearly implied."
                        ),
                    },
                    {"role": "user", "content": conversation_text},
                ],
                tools=[{
                    "type": "function",
                    "function": {
                        "name": "extract_carbon_inputs",
                        "description": "Extract carbon emissions model inputs from conversation",
                        "parameters": INPUT_EXTRACTION_SCHEMA,
                    },
                }],
                tool_choice={"type": "function", "function": {"name": "extract_carbon_inputs"}},
                temperature=0,
            )
            if user_id and db:
                await record_usage_from_response(user_id, settings.openai_orchestration_model, resp, db, is_byok=is_byok)
            tool_call = resp.choices[0].message.tool_calls[0]
            extracted = json.loads(tool_call.function.arguments)
            return {k: v for k, v in extracted.items() if v is not None}
        except Exception as e:
            logger.error(f"Carbon input extraction failed: {e}")
            return {}

    async def recalculate(self, inputs_dict: dict[str, dict[str, Any]]) -> dict[str, Any]:
        known_values: dict[str, Any] = {}
        for key, value in inputs_dict.items():
            if isinstance(value, dict):
                known_values[key] = value.get("value")
            else:
                known_values[key] = value
        method_pack = known_values.pop("method_pack", None)
        return await self.recalculate_from_values(method_pack=method_pack, known_values=known_values)

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
        method_pack = planner_args.get("method_pack")

        await _progress("Extracting carbon inputs from conversation...")
        extracted = await self.extract_inputs_from_text(conversation_text, method_pack)

        if not method_pack and extracted.get("method_pack"):
            method_pack = extracted.pop("method_pack", None)

        await _progress("Calculating emission reductions...")
        widget_data = await self.recalculate_from_values(method_pack=method_pack, known_values=extracted)

        if widget_data.get("computable"):
            widget_type = "carbon_output"
            carbon_result = widget_data.get("result") or {}
            await _progress(
                f"Net ERs: {carbon_result.get('net_er_tco2e', 0):,.2f} tCO₂e/yr "
                f"({carbon_result.get('assumption_count', 0)} assumptions)"
            )
        else:
            widget_type = "carbon_inputs"
            await _progress(
                f"Need {len(widget_data.get('missing_essentials', []))} more inputs — showing input table"
            )

        return widget_type, widget_data
