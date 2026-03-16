"""
PVWatts Tool — Solar Production Estimate inside chat.

Orchestration flow:
1. Tool is invoked (by planner tool call or tool_hint).
2. LLM extracts candidate inputs from chat history + docs.
3. Engine fills gaps with defaults (tilt=abs(lat), azimuth by hemisphere, etc.).
4. If address provided but no lat/lon, geocode first.
5. Inputs table + map widget is shown; user confirms / edits.
6. Engine calls PVWatts API; output widget is shown.
7. User can iterate (edit input → re-run) or ask assistant to change inputs.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from openai import AsyncOpenAI

from app.config import get_settings
from app.tools.base import (
    BaseTool,
    ExecutionModel,
    ProgressCallback,
    RefinementModel,
    ReviewStrategy,
    ToolDefinition,
    ToolInput,
    ToolOutput,
)
from app.services.pvwatts_engine import PVWattsEngine, PVWattsInput

settings = get_settings()
logger = logging.getLogger(__name__)

INPUT_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "address": {
            "type": "string",
            "description": "Site address or location description (e.g. 'Nairobi, Kenya' or '123 Main St, Denver, CO')",
        },
        "lat": {
            "type": "number",
            "description": "Latitude of the site (-90 to 90)",
        },
        "lon": {
            "type": "number",
            "description": "Longitude of the site (-180 to 180)",
        },
        "system_capacity": {
            "type": "number",
            "description": "System capacity in kW DC",
        },
        "panel_count": {
            "type": "integer",
            "description": "Number of solar panels (used with panel_wattage to compute system_capacity if not directly given)",
        },
        "panel_wattage": {
            "type": "number",
            "description": "Wattage per panel in watts (used with panel_count to compute system_capacity)",
        },
        "module_type": {
            "type": "integer",
            "description": "Module type: 0=Standard, 1=Premium, 2=Thin film",
        },
        "array_type": {
            "type": "integer",
            "description": "Array type: 0=Fixed Open Rack, 1=Fixed Roof Mounted, 2=1-Axis, 3=1-Axis Backtracking, 4=2-Axis",
        },
        "tilt": {
            "type": "number",
            "description": "Tilt angle in degrees (0-90)",
        },
        "azimuth": {
            "type": "number",
            "description": "Azimuth angle in degrees (0-360, 180=south-facing in N hemisphere)",
        },
        "losses": {
            "type": "number",
            "description": "System losses as percentage (e.g. 14 for 14%)",
        },
        "dc_ac_ratio": {
            "type": "number",
            "description": "DC to AC ratio (e.g. 1.2)",
        },
        "notes": {
            "type": "string",
            "description": "Any additional notes about the system (shading, soiling, etc.)",
        },
    },
}


class PVWattsTool(BaseTool):
    """Solar production estimate tool using NREL PVWatts V8."""

    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
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
        )

    @property
    def required_inputs(self) -> list[ToolInput]:
        return [
            ToolInput(
                name="system_capacity",
                label="System Capacity (kW DC)",
                description="What is the DC nameplate capacity of the system?",
                input_type="number",
                placeholder="e.g. 100",
            ),
            ToolInput(
                name="lat",
                label="Latitude",
                description="Latitude of the site location",
                input_type="number",
                placeholder="e.g. -1.286",
            ),
            ToolInput(
                name="lon",
                label="Longitude",
                description="Longitude of the site location",
                input_type="number",
                placeholder="e.g. 36.817",
            ),
        ]

    @property
    def review_strategy(self) -> ReviewStrategy:
        return ReviewStrategy.INPUT_REVIEW

    @property
    def execution_model(self) -> ExecutionModel:
        return ExecutionModel.SYNC_COMPUTATION

    @property
    def refinement_model(self) -> RefinementModel:
        return RefinementModel.EDIT_AND_RECOMPUTE

    async def extract_inputs_from_text(
        self,
        conversation_text: str,
    ) -> dict[str, Any]:
        """Extract solar estimate inputs from conversation text via LLM."""
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        try:
            resp = await client.chat.completions.create(
                model=settings.openai_orchestration_model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a solar energy analyst. Extract any solar PV production estimate "
                            "inputs from the conversation below.\n\n"
                            "LOCATION EXTRACTION — this is critical:\n"
                            "- If an explicit address or place name is mentioned, return it as 'address'. "
                            "Do NOT also return lat/lon — the geocoder will resolve coordinates from the address.\n"
                            "- Only return lat/lon if the user explicitly provides numeric coordinates.\n"
                            "- If the project name, title, or context mentions a country, city, or region "
                            "(e.g. 'Zimbabwe Solar Farm', 'Kenya PV Project', 'Dubai rooftop'), "
                            "extract that geographic reference as the 'address' field. "
                            "For example, 'Zimbabwe Solar Farm' → address: 'Zimbabwe'.\n"
                            "- Prefer the most specific location available (city > country).\n"
                            "- NEVER guess or fabricate coordinates.\n\n"
                            "OTHER INPUTS:\n"
                            "- Only include values that are explicitly stated or clearly implied.\n"
                            "- If the user mentions a number of panels and wattage per panel, extract those "
                            "so system_capacity can be derived.\n"
                            "- Convert units where needed (e.g. MW → kW, watts → kW for capacity).\n"
                            "- Do NOT extract tilt or azimuth unless the user explicitly states a specific "
                            "value (e.g. '30 degree tilt' or '270 degree azimuth'). "
                            "These are always computed from latitude — never guess them."
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
            tool_call = resp.choices[0].message.tool_calls[0]
            extracted = json.loads(tool_call.function.arguments)
            return {k: v for k, v in extracted.items() if v is not None}
        except Exception as e:
            logger.error(f"Solar input extraction failed: {e}")
            return {}

    async def execute_from_conversation(
        self,
        conversation_text: str,
        planner_args: dict | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> tuple[str, dict]:
        """Run solar estimate from conversation text — main entry for core chat."""

        async def _progress(msg: str) -> None:
            if on_progress:
                await on_progress(msg)

        planner_args = planner_args or {}

        await _progress("Extracting solar inputs from conversation...")
        extracted = await self.extract_inputs_from_text(conversation_text)

        # Derive system_capacity from panel_count × panel_wattage if needed
        if "system_capacity" not in extracted:
            panel_count = extracted.pop("panel_count", None)
            panel_wattage = extracted.pop("panel_wattage", None)
            if panel_count and panel_wattage:
                extracted["system_capacity"] = (panel_count * panel_wattage) / 1000.0
                await _progress(f"Derived capacity: {panel_count} panels × {panel_wattage}W = {extracted['system_capacity']:.1f} kW DC")
        else:
            extracted.pop("panel_count", None)
            extracted.pop("panel_wattage", None)

        # When an address is present, ALWAYS geocode it — LLM-generated lat/lon
        # are often hallucinated and won't match the address string.
        address = extracted.get("address")
        if address:
            try:
                await _progress(f"Geocoding: \"{address}\"...")
                geo = await PVWattsEngine.geocode_address(address)
                extracted["lat"] = geo["lat"]
                extracted["lon"] = geo["lon"]
                extracted["address"] = geo["display_name"]
                await _progress(f"Location: {geo['lat']:.4f}, {geo['lon']:.4f}")
            except Exception as e:
                logger.error(f"Geocoding failed: {e}")
                await _progress(f"Could not geocode \"{address}\" — please provide coordinates")

        extracted.pop("notes", None)

        engine_inputs = PVWattsEngine.build_default_inputs(known_values=extracted)
        missing = PVWattsEngine.get_missing_essentials(engine_inputs)
        computable = PVWattsEngine.is_computable(engine_inputs)

        widget_data: dict = {
            "inputs": {k: v.to_dict() for k, v in engine_inputs.items()},
            "missing_essentials": missing,
            "computable": computable,
        }

        if computable:
            await _progress("Calling PVWatts API for production estimate...")
            try:
                result = await PVWattsEngine.call_pvwatts(engine_inputs)
                widget_data["result"] = result.to_dict()
                widget_type = "solar_output"
                await _progress(
                    f"Year 1 AC Energy: {result.ac_annual:,.0f} kWh | "
                    f"Capacity Factor: {result.capacity_factor:.1f}% "
                    f"({result.assumption_count} assumptions, {result.quality_label} confidence)"
                )
            except Exception as e:
                logger.error(f"PVWatts API call failed: {e}", exc_info=True)
                widget_data["error"] = str(e)
                widget_data["computable"] = False
                widget_type = "solar_inputs"
                await _progress(f"PVWatts API error — showing inputs for review")
        else:
            widget_type = "solar_inputs"
            await _progress(f"Need {len(missing)} more inputs to run estimate — showing input table")

        return widget_type, widget_data

    async def recalculate(
        self,
        inputs_dict: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        """Recalculate from serialized inputs. Fast path for widget edits — no LLM.
        Always refreshes location-derived defaults (tilt, azimuth) from the current
        lat unless those fields have been user-confirmed."""
        engine_inputs = {
            k: PVWattsInput.from_dict(v) for k, v in inputs_dict.items()
        }

        # Re-derive orientation defaults from current lat for any non-confirmed values
        engine_inputs = PVWattsEngine.refresh_location_defaults(engine_inputs)

        computable = PVWattsEngine.is_computable(engine_inputs)
        missing = PVWattsEngine.get_missing_essentials(engine_inputs)

        result_data: dict[str, Any] = {
            "inputs": {k: v.to_dict() for k, v in engine_inputs.items()},
            "missing_essentials": missing,
            "computable": computable,
        }

        if computable:
            try:
                result = await PVWattsEngine.call_pvwatts(engine_inputs)
                result_data["result"] = result.to_dict()
            except Exception as e:
                result_data["error"] = str(e)
                result_data["computable"] = False

        return result_data

    async def execute(self, db, initiative_id, inputs, **kwargs) -> ToolOutput:
        """Full execution for initiative-scoped tool runs (not used in core chat)."""
        result_data = await self.recalculate(inputs)
        return ToolOutput(
            tool_id="solar_estimate",
            output_type="solar",
            title="Solar Production Estimate",
            content=result_data,
        )
