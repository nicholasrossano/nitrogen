"""
PVWatts Tool — Solar Production Estimate.

Stage workflow:
  1. Inputs  (table / editable_table)   — pre-populated from engine defaults; user confirms.
  2. Results (computed_results / solar_yield_results) — auto-computed via PVWatts API
     after Inputs confirmed; user confirms.

Chat path uses execute_from_conversation() (not part of the stage contract).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

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
)

settings = get_settings()
logger = logging.getLogger(__name__)

INPUT_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "address": {"type": "string", "description": "Site address or location description"},
        "lat": {"type": "number", "description": "Latitude of the site (-90 to 90)"},
        "lon": {"type": "number", "description": "Longitude of the site (-180 to 180)"},
        "system_capacity": {"type": "number", "description": "System capacity in kW DC"},
        "panel_count": {"type": "integer"},
        "panel_wattage": {"type": "number"},
        "module_type": {"type": "integer"},
        "array_type": {"type": "integer"},
        "tilt": {"type": "number"},
        "azimuth": {"type": "number"},
        "losses": {"type": "number"},
        "dc_ac_ratio": {"type": "number"},
        "notes": {"type": "string"},
    },
}


class PVWattsTool(BaseModule):
    """Solar production estimate tool using NREL PVWatts V8."""

    @property
    def definition(self) -> ModuleDefinition:
        return ModuleDefinition(
            id="solar_estimate",
            name="Solar Production Estimate",
            description="Estimate annual and monthly solar PV energy production (kWh) — extracts site and system inputs from conversation, calls the PVWatts API, and produces transparent energy yield estimates.",
            icon="Sun",
            output_type="solar",
            category="analysis",
            keywords=[
                "solar", "pv", "photovoltaic", "production estimate",
                "energy yield", "kwh", "annual production", "monthly production",
                "pvwatts", "solar feasibility", "capacity factor",
                "tilt", "azimuth", "irradiance", "solar radiation",
            ],
            export_format="xlsx",
        )

    @property
    def manifest(self) -> ModuleManifest:
        return ModuleManifest(
            **self.definition.__dict__,
            goal="Estimate annual and monthly solar generation from site and system assumptions.",
            primary_ui_object="solar_yield_results",
            investigate_hint="For solar inputs, prefer site-specific geometry and equipment specs first, then fall back to climate-appropriate PV benchmarks and PVWatts-compatible defaults.",
            export_artifact_types=["xlsx"],
            adapter_bindings={"core_engine": "pvwatts"},
            input_dependencies=[],
            produced_outputs=["solar_annual_kwh", "solar_monthly_kwh", "solar_inputs"],
            downstream_dependencies=["lcoe_model"],
            assumptions_behavior="tracks",
            evidence_behavior="none",
            decision_log_attribution=DecisionLogAttribution(
                adapter_labels={"pvwatts": "NREL PVWatts API"},
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
                widget="solar_yield_results",
                population=[
                    PopulationStep("read_confirmed_prior_stage", {"stage_id": "inputs"}),
                    PopulationStep("compute_with_external_tool", {"tool": "pvwatts"}),
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
        from app.services.pvwatts_engine import PVWattsEngine

        known_values: dict[str, Any] = {}
        geography = context.get("geography") or context.get("tool_inputs", {}).get("address")
        if geography:
            known_values["address"] = geography

        inputs = PVWattsEngine.build_default_inputs(known_values=known_values)
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

    async def compute_external(
        self,
        stage_id: str,
        tool: str,
        confirmed_stages: dict[str, Any],
        context: dict,
    ) -> dict[str, Any]:
        if stage_id != "results" or tool != "pvwatts":
            raise ValueError(f"compute_external called for unexpected stage/tool '{stage_id}/{tool}'")

        inputs_data = (confirmed_stages.get("inputs") or {}).get("data") or {}
        items = inputs_data.get("items", [])

        # Reconstruct known_values from confirmed stage rows.
        # Keep explicit field_name as the canonical key so the computed widget
        # can stay in sync with stage-table statuses/provenance.
        known_values: dict[str, Any] = {}
        stage_input_meta: dict[str, dict[str, Any]] = {}
        for item in items:
            content = item.get("content", {})
            key = content.get("field_name") or str(content.get("variable", "")).lower().replace(" ", "_")
            val = content.get("value")
            if key:
                stage_input_meta[key] = {
                    "value": val,
                    "status": content.get("status"),
                    "source": content.get("source"),
                }
            if val is None:
                continue
            known_values[key] = val

        adapter = get_adapter_registry().get("pvwatts")
        if adapter is None:
            raise RuntimeError("pvwatts adapter is not registered.")
        ctx = ExecutionContext(
            user_id="system",
            user_email=None,
            initiative_id=None,
            initiative_role=None,
            ai_access_granted=True,
            is_byok=False,
            request_id="pvwatts:compute_stage",
        )
        result = await adapter.execute(ctx, None, {"known_values": known_values, "resolve_address": True})
        widget_data = dict(result.output)
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

    async def generate_export(self, confirmed_stages: dict[str, Any], context: dict) -> bytes:
        results_data = (confirmed_stages.get("results") or {}).get("data") or {}
        widget_data = results_data.get("widget_data", {})
        from app.services.pvwatts_engine import PVWattsEngine
        return PVWattsEngine.export_xlsx(widget_data)

    def is_exportable(self, content: dict) -> bool:
        return bool(
            isinstance(content, dict)
            and content.get("result")
            and content.get("inputs")
        )

    # ------------------------------------------------------------------ #
    # Chat-path methods                                                    #
    # ------------------------------------------------------------------ #

    @property
    def required_inputs(self) -> list[ModuleInput]:
        return [
            ModuleInput(
                name="system_capacity",
                label="System Capacity (kW DC)",
                description="What is the DC nameplate capacity of the system?",
                input_type="number",
                placeholder="e.g. 100",
            ),
            ModuleInput(
                name="lat",
                label="Latitude",
                description="Latitude of the site location",
                input_type="number",
                placeholder="e.g. -1.286",
            ),
            ModuleInput(
                name="lon",
                label="Longitude",
                description="Longitude of the site location",
                input_type="number",
                placeholder="e.g. 36.817",
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
                            "You are a solar energy analyst. Extract solar PV production estimate "
                            "inputs from the conversation. If an address/place is mentioned, return "
                            "it as 'address' — do NOT also return lat/lon. Only return lat/lon if "
                            "explicit numeric coordinates are given. Never fabricate coordinates."
                        ),
                    },
                    {"role": "user", "content": conversation_text},
                ],
                tools=[{
                    "type": "function",
                    "function": {
                        "name": "extract_solar_inputs",
                        "description": "Extract solar PV production estimate inputs from conversation",
                        "parameters": INPUT_EXTRACTION_SCHEMA,
                    },
                }],
                tool_choice={"type": "function", "function": {"name": "extract_solar_inputs"}},
                temperature=0,
            )
            if user_id and db:
                await record_usage_from_response(user_id, settings.openai_orchestration_model, resp, db, is_byok=is_byok)
            tool_call = resp.choices[0].message.tool_calls[0]
            extracted = json.loads(tool_call.function.arguments)
            return {k: v for k, v in extracted.items() if v is not None}
        except Exception as e:
            logger.error(f"Solar input extraction failed: {e}")
            return {}

    async def recalculate(self, inputs_dict: dict[str, dict[str, Any]]) -> dict[str, Any]:
        adapter = get_adapter_registry().get("pvwatts")
        if adapter is None:
            raise RuntimeError("pvwatts adapter is not registered.")
        ctx = ExecutionContext(
            user_id="system",
            user_email=None,
            initiative_id=None,
            initiative_role=None,
            ai_access_granted=True,
            is_byok=False,
            request_id="pvwatts:recalculate",
        )
        result = await adapter.execute(ctx, None, {"serialized_inputs": inputs_dict})
        return dict(result.output)

    async def execute_from_conversation(
        self,
        conversation_text: str,
        planner_args: dict | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> tuple[str, dict]:
        async def _progress(msg: str) -> None:
            if on_progress:
                await on_progress(msg)

        await _progress("Extracting solar inputs from conversation...")
        extracted = await self.extract_inputs_from_text(conversation_text)

        if "system_capacity" not in extracted:
            panel_count = extracted.pop("panel_count", None)
            panel_wattage = extracted.pop("panel_wattage", None)
            if panel_count and panel_wattage:
                extracted["system_capacity"] = (panel_count * panel_wattage) / 1000.0
                await _progress(f"Derived capacity: {panel_count} × {panel_wattage}W = {extracted['system_capacity']:.1f} kW DC")
        else:
            extracted.pop("panel_count", None)
            extracted.pop("panel_wattage", None)

        address = extracted.get("address")
        if address and ("lat" not in extracted or "lon" not in extracted):
            await _progress(f'Geocoding: "{address}"...')

        extracted.pop("notes", None)

        adapter = get_adapter_registry().get("pvwatts")
        if adapter is None:
            raise RuntimeError("pvwatts adapter is not registered.")
        ctx = ExecutionContext(
            user_id="system",
            user_email=None,
            initiative_id=None,
            initiative_role=None,
            ai_access_granted=True,
            is_byok=False,
            request_id="pvwatts:conversation",
        )
        await _progress("Calling PVWatts API for production estimate...")
        result = await adapter.execute(ctx, None, {"known_values": extracted, "resolve_address": True})
        widget_data: dict[str, Any] = dict(result.output)

        geocode = widget_data.get("geocode")
        if isinstance(geocode, dict) and "lat" in geocode:
            await _progress(f"Location: {geocode['lat']:.4f}, {geocode['lon']:.4f}")

        if widget_data.get("computable") and widget_data.get("result"):
            widget_type = "solar_output"
            solar_result = widget_data.get("result", {})
            await _progress(
                f"Year 1 AC Energy: {solar_result.get('ac_annual', 0):,.0f} kWh | "
                f"Capacity Factor: {solar_result.get('capacity_factor', 0):.1f}%"
            )
        else:
            widget_type = "solar_inputs"
            await _progress(
                f"Need {len(widget_data.get('missing_essentials', []))} more inputs — showing input table"
            )

        return widget_type, widget_data
