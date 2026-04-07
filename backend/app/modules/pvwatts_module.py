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

from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters import get_adapter_registry
from app.config import get_settings
from app.core.execution_context import ExecutionContext
from app.core.llm_client import get_openai_client, record_usage_from_response
from app.modules.base import (
    BaseModule,
    ExecutionModel,
    ModuleManifest,
    ProgressCallback,
    RefinementModel,
    ReviewStrategy,
    ModuleDefinition,
    ModuleInput,
    ModuleOutput,
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
            module_class="foundational",
            workflow_category="design",
            goal="Estimate annual and monthly solar generation from site and system assumptions.",
            primary_ui_object="solar_output",
            export_artifact_types=["xlsx"],
            adapter_bindings={"core_engine": "pvwatts"},
            input_dependencies=[],
            produced_outputs=["solar_annual_kwh", "solar_monthly_kwh", "solar_inputs"],
            downstream_dependencies=["lcoe_model"],
            assumptions_behavior="tracks",
            evidence_behavior="none",
        )

    def is_exportable(self, content: dict) -> bool:
        return bool(
            isinstance(content, dict)
            and content.get("result")
            and content.get("inputs")
        )

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
        user_id: str | None = None,
        db: AsyncSession | None = None,
    ) -> dict[str, Any]:
        """Extract solar estimate inputs from conversation text via LLM."""
        client, is_byok = await get_openai_client(user_id, db)
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
            if user_id and db:
                await record_usage_from_response(user_id, settings.openai_orchestration_model, resp, db, is_byok=is_byok)
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
        result = await adapter.execute(ctx, None, {"known_values": extracted})
        widget_data: dict[str, Any] = dict(result.output)
        if widget_data.get("computable") and widget_data.get("result"):
            widget_type = "solar_output"
            solar_result = widget_data.get("result", {})
            await _progress(
                f"Year 1 AC Energy: {solar_result.get('ac_annual', 0):,.0f} kWh | "
                f"Capacity Factor: {solar_result.get('capacity_factor', 0):.1f}% "
                f"({solar_result.get('assumption_count', 0)} assumptions, {solar_result.get('quality_label', 'unknown')} confidence)"
            )
        else:
            widget_type = "solar_inputs"
            await _progress(
                f"Need {len(widget_data.get('missing_essentials', []))} more inputs to run estimate — showing input table"
            )

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
        known_values = {k: v.value for k, v in engine_inputs.items()}

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
        result = await adapter.execute(ctx, None, {"known_values": known_values})
        return dict(result.output)

    async def execute(self, db, initiative_id, inputs, **kwargs) -> ModuleOutput:
        """Full execution for initiative-scoped tool runs (not used in core chat)."""
        result_data = await self.recalculate(inputs)
        return ModuleOutput(
            module_id="solar_estimate",
            output_type="solar",
            title="Solar Production Estimate",
            content=result_data,
        )
