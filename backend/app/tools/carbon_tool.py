"""
Carbon Emissions Calculator Tool — callable within chat.

Orchestration flow:
1. Tool is invoked (by orchestration action or directly).
2. LLM extracts candidate inputs from chat history + uploaded docs.
3. Engine fills gaps with method-pack defaults.
4. Inputs table widget is shown; user confirms / edits.
5. Engine calculates ERs; outputs widget is shown.
6. User can iterate (edit input → recompute) or request sensitivity / export.
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import get_settings
from app.core.llm_client import get_openai_client, record_usage_from_response
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
from app.models.initiative import Initiative
from app.models.onboarding import ChatMessage
from app.services.carbon_engine import (
    CarbonEngine,
    CarbonInput,
)

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
            "description": (
                "Project type determining calculation methodology. "
                "'cookstoves': improved biomass cookstoves (biomass-to-biomass). "
                "'fuel_switch': biomass to LPG/biogas/ethanol. "
                "'safe_water': water purification replacing fuel-based boiling. "
                "'grid_renewable': grid-connected solar/wind/hydro/geothermal. "
                "'solar_home': off-grid solar home systems displacing kerosene/diesel. "
                "'biodigester': animal manure biodigesters (methane avoidance + fuel). "
                "'efficient_lighting': replacing incandescent/CFL with LED. "
                "Default to 'cookstoves' if unclear but involves cooking or stoves."
            ),
        },
        # --- Shared ---
        "usage_rate": {"type": "number", "description": "Usage rate (0-1). 1.0 = 100%."},
        "adoption_rate": {"type": "number", "description": "Adoption rate (0-1). 1.0 = full in year 1."},
        "baseline_fuel_type": {"type": "string", "description": "Baseline fuel: wood, charcoal, kerosene, dung."},
        "fnrb": {"type": "number", "description": "Fraction of non-renewable biomass (0-1)."},
        "crediting_period_years": {"type": "integer", "description": "Crediting period in years."},
        # --- Cookstoves & fuel switch ---
        "devices_households": {"type": "number", "description": "Number of devices/households (cookstoves & fuel switch)."},
        "baseline_fuel_consumption_kg_yr": {"type": "number", "description": "Baseline fuel in kg/yr per device/household."},
        "project_fuel_type": {"type": "string", "description": "Project fuel: improved_biomass, lpg, biogas, ethanol."},
        "project_fuel_consumption_kg_yr": {"type": "number", "description": "Project fuel in kg/yr per device/household."},
        "baseline_efficiency": {"type": "number", "description": "Baseline stove thermal efficiency (decimal)."},
        "project_efficiency": {"type": "number", "description": "Project stove thermal efficiency (decimal)."},
        "fuel_savings_pct": {"type": "number", "description": "Fuel savings % as decimal (cookstoves only)."},
        "emission_factor_kgco2_per_kg": {"type": "number", "description": "Direct EF kgCO2/kg (cookstoves only). ~1.747 for wood."},
        # --- Safe water ---
        "people_served": {"type": "number", "description": "Number of people served (safe water projects)."},
        "water_per_person_day": {"type": "number", "description": "Litres of drinking water per person per day. Default 4, cap 5.5."},
        "proportion_already_safe": {"type": "number", "description": "Proportion already with safe water before project (0-1)."},
        "proportion_still_boiling": {"type": "number", "description": "Proportion still boiling after project (0-1)."},
        # --- Grid renewable energy ---
        "installed_capacity_kw": {"type": "number", "description": "Installed capacity in kW (grid renewable)."},
        "capacity_factor": {"type": "number", "description": "Capacity factor 0-1 (grid renewable). ~0.18 solar, ~0.30 wind."},
        "grid_emission_factor": {"type": "number", "description": "Grid EF in tCO₂/MWh (grid renewable, efficient lighting)."},
        # --- Solar home systems ---
        "num_systems": {"type": "number", "description": "Number of solar home systems deployed."},
        "system_capacity_wp": {"type": "number", "description": "SHS panel watt-peak capacity (Wp)."},
        "peak_sun_hours": {"type": "number", "description": "Average peak sun hours per day."},
        "baseline_fuel_consumption_l_yr": {"type": "number", "description": "Baseline kerosene/diesel per HH per year (litres)."},
        # --- Biodigesters ---
        "num_digesters": {"type": "number", "description": "Number of biodigesters installed."},
        "livestock_type": {"type": "string", "description": "Livestock type: dairy_cattle, other_cattle, swine, poultry, buffalo, sheep, goats."},
        "num_animals": {"type": "number", "description": "Number of animals per digester."},
        # --- Efficient lighting ---
        "num_lamps": {"type": "number", "description": "Number of project lamps distributed."},
        "baseline_wattage": {"type": "number", "description": "Baseline lamp wattage (W). Typical incandescent ~60W."},
        "project_wattage": {"type": "number", "description": "Project lamp wattage (W). Typical LED ~9W."},
        "operating_hours_per_day": {"type": "number", "description": "Daily lamp operating hours. Default 3.5, max 5.0."},
    },
}


class CarbonTool(BaseTool):
    """Carbon emissions calculator for chat-based ER estimation."""

    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
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

    def is_exportable(self, content: dict) -> bool:
        return bool(
            isinstance(content, dict)
            and content.get("computable", False)
            and content.get("inputs")
        )

    @property
    def required_inputs(self) -> list[ToolInput]:
        return [
            ToolInput(
                name="devices_households",
                label="Devices / Households",
                description="How many devices or households does this project cover?",
                input_type="number",
                placeholder="e.g. 5000",
            ),
            ToolInput(
                name="baseline_fuel_consumption_kg_yr",
                label="Baseline Fuel Consumption (kg/yr per device)",
                description="How much fuel does each household consume per year under the baseline scenario?",
                input_type="number",
                placeholder="e.g. 2000",
            ),
        ]

    @property
    def optional_inputs(self) -> list[ToolInput]:
        return [
            ToolInput(
                name="project_fuel_consumption_kg_yr",
                label="Project Fuel Consumption (kg/yr per device)",
                description="How much fuel per household per year under the project scenario? If not provided, will be derived from efficiency ratio.",
                input_type="number",
                required=False,
                placeholder="e.g. 700",
            ),
            ToolInput(
                name="fnrb",
                label="fNRB (fraction of non-renewable biomass)",
                description="Fraction of non-renewable biomass. Default varies by methodology.",
                input_type="number",
                required=False,
                default=0.70,
            ),
            ToolInput(
                name="crediting_period_years",
                label="Crediting Period (years)",
                description="How many years is the crediting period?",
                input_type="number",
                required=False,
                default=10,
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
        method_pack: str | None = None,
        user_id: str | None = None,
        db: AsyncSession | None = None,
    ) -> dict[str, Any]:
        """Extract carbon inputs from raw conversation text via LLM."""
        client, is_byok = await get_openai_client(user_id, db)
        try:
            resp = await client.chat.completions.create(
                model=settings.openai_orchestration_model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a carbon project analyst specialising in emission reduction "
                            "methodologies. Extract any carbon-ER-relevant numeric inputs from "
                            "the conversation below. "
                            "Only include values that are explicitly stated or clearly implied. "
                            "Convert units where needed (e.g. tonnes → kg). "
                            "For rates (usage_rate, adoption_rate, fnrb, efficiencies), return as decimals (0-1). "
                            "Set method_pack based on the project type:\n"
                            "- 'cookstoves': improved biomass cookstoves replacing traditional stoves\n"
                            "- 'fuel_switch': switching from biomass to LPG, biogas, or ethanol\n"
                            "- 'safe_water': water purification/filtration replacing fuel-based boiling\n"
                            "- 'grid_renewable': grid-connected solar, wind, hydro, or geothermal power\n"
                            "- 'solar_home': off-grid solar home systems displacing kerosene/diesel\n"
                            "- 'biodigester': animal manure biodigesters (methane avoidance + cooking fuel)\n"
                            "- 'efficient_lighting': LED/CFL replacing incandescent lamps\n"
                            "Default to 'cookstoves' if unclear but the project involves cooking or stoves."
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

    async def extract_inputs_from_context(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        """Extract carbon inputs from DB-stored chat history and project context."""
        result = await db.execute(
            select(Initiative).where(Initiative.id == initiative_id)
        )
        initiative = result.scalar_one_or_none()
        if not initiative:
            return {}

        msgs_result = await db.execute(
            select(ChatMessage)
            .where(ChatMessage.initiative_id == initiative_id)
            .order_by(ChatMessage.created_at)
        )
        messages = list(msgs_result.scalars().all())

        conversation_text = "\n".join(
            f"{'User' if m.role == 'user' else 'Assistant'}: {m.content}"
            for m in messages[-20:]
        )

        project_context = (
            f"Project type: {initiative.project_type or 'Unknown'}\n"
            f"Description: {initiative.project_description or 'N/A'}\n"
            f"Geography: {initiative.geography or 'Not specified'}"
        )

        return await self.extract_inputs_from_text(
            f"PROJECT CONTEXT:\n{project_context}\n\nCONVERSATION:\n{conversation_text}",
            user_id=user_id,
            db=db,
        )

    async def execute(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        inputs: dict[str, Any],
        include_corpus: bool = True,
        alignment=None,
    ) -> ToolOutput:
        """Full carbon execution: extract → fill defaults → calculate → return structured output."""

        extracted = await self.extract_inputs_from_context(db, initiative_id)
        merged = {**extracted, **{k: v for k, v in inputs.items() if v is not None}}

        method_pack = merged.pop("method_pack", None) or merged.pop("methodology_variant", None)

        engine_inputs = CarbonEngine.build_default_inputs(
            method_pack=method_pack,
            known_values=merged,
        )

        missing = CarbonEngine.get_missing_essentials(engine_inputs)
        computable = CarbonEngine.is_computable(engine_inputs)

        result_data: dict[str, Any] = {
            "inputs": {k: v.to_dict() for k, v in engine_inputs.items()},
            "missing_essentials": missing,
            "computable": computable,
            "method_pack": method_pack,
        }

        if computable:
            try:
                carbon_result = CarbonEngine.calculate(engine_inputs)
                result_data["result"] = carbon_result.to_dict()

                sensitivity = CarbonEngine.run_sensitivity(engine_inputs)
                result_data["sensitivity"] = [s.to_dict() for s in sensitivity]
                result_data["is_unruly"] = CarbonEngine.is_unruly(engine_inputs)
            except (ValueError, ZeroDivisionError) as e:
                result_data["error"] = str(e)
                result_data["computable"] = False

        return ToolOutput(
            tool_id="carbon_model",
            output_type="carbon",
            title="Carbon Emissions Analysis",
            content=result_data,
        )

    async def execute_from_conversation(
        self,
        conversation_text: str,
        planner_args: dict | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> tuple[str, dict]:
        """Run carbon model from conversation text — unified path for both chat contexts."""

        async def _progress(msg: str) -> None:
            if on_progress:
                await on_progress(msg)

        planner_args = planner_args or {}
        method_pack = planner_args.get("method_pack")

        await _progress("Extracting carbon inputs from conversation...")
        extracted = await self.extract_inputs_from_text(conversation_text, method_pack)

        if not method_pack and extracted.get("method_pack"):
            method_pack = extracted.pop("method_pack", None)

        engine_inputs = CarbonEngine.build_default_inputs(
            method_pack=method_pack,
            known_values=extracted,
        )

        missing = CarbonEngine.get_missing_essentials(engine_inputs)
        computable = CarbonEngine.is_computable(engine_inputs)

        widget_data: dict = {
            "inputs": {k: v.to_dict() for k, v in engine_inputs.items()},
            "missing_essentials": missing,
            "computable": computable,
            "method_pack": method_pack,
        }

        if computable:
            await _progress("Calculating emission reductions...")
            result = CarbonEngine.calculate(engine_inputs)
            widget_data["result"] = result.to_dict()

            await _progress("Running sensitivity analysis...")
            sensitivity = CarbonEngine.run_sensitivity(engine_inputs)
            widget_data["sensitivity"] = [s.to_dict() for s in sensitivity]
            widget_data["is_unruly"] = CarbonEngine.is_unruly(engine_inputs)

            widget_type = "carbon_output"
            await _progress(
                f"Net ERs: {result.net_er_tco2e:,.2f} tCO₂e/yr "
                f"({result.assumption_count} assumptions, {result.quality_label} confidence)"
            )
        else:
            widget_type = "carbon_inputs"
            await _progress(f"Need {len(missing)} more inputs to compute — showing input table")

        return widget_type, widget_data

    async def recalculate(
        self,
        inputs_dict: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        """Recalculate from serialized CarbonInput dicts.

        Fast path for user edits — no LLM call, pure math.
        """
        engine_inputs = {
            k: CarbonInput.from_dict(v) for k, v in inputs_dict.items()
        }

        computable = CarbonEngine.is_computable(engine_inputs)
        missing = CarbonEngine.get_missing_essentials(engine_inputs)

        result_data: dict[str, Any] = {
            "inputs": inputs_dict,
            "missing_essentials": missing,
            "computable": computable,
        }

        if computable:
            try:
                carbon_result = CarbonEngine.calculate(engine_inputs)
                result_data["result"] = carbon_result.to_dict()

                sensitivity = CarbonEngine.run_sensitivity(engine_inputs)
                result_data["sensitivity"] = [s.to_dict() for s in sensitivity]
                result_data["is_unruly"] = CarbonEngine.is_unruly(engine_inputs)
            except (ValueError, ZeroDivisionError) as e:
                result_data["error"] = str(e)
                result_data["computable"] = False

        return result_data
