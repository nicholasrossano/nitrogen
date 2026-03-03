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
from app.models.chat import ChatMessage
from app.services.carbon_engine import (
    CarbonEngine,
    CarbonInput,
    CarbonResult,
    SensitivityPoint,
)

settings = get_settings()
logger = logging.getLogger(__name__)

INPUT_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "method_pack": {
            "type": "string",
            "description": "Methodology type: cookstoves, or other. Default to cookstoves if the project involves stoves, cooking, biomass fuel, etc.",
        },
        "devices_households": {
            "type": "number",
            "description": "Number of devices or households covered by the project",
        },
        "usage_rate": {
            "type": "number",
            "description": "Usage rate as a decimal (0-1). 1.0 means 100% of households use the device.",
        },
        "adoption_rate": {
            "type": "number",
            "description": "Adoption rate as a decimal (0-1). 1.0 means full adoption in year 1.",
        },
        "baseline_fuel_type": {
            "type": "string",
            "description": "Baseline fuel type (e.g. wood, charcoal, kerosene, dung)",
        },
        "baseline_fuel_consumption_kg_yr": {
            "type": "number",
            "description": "Baseline fuel consumption in kg per year per device/household",
        },
        "baseline_ncv_mj_kg": {
            "type": "number",
            "description": "Net calorific value of baseline fuel in MJ/kg",
        },
        "baseline_efficiency": {
            "type": "number",
            "description": "Thermal efficiency of baseline stove/device as a decimal (e.g. 0.10 for 10%)",
        },
        "project_fuel_type": {
            "type": "string",
            "description": "Project fuel type (e.g. improved_biomass, lpg, biogas, ethanol)",
        },
        "project_fuel_consumption_kg_yr": {
            "type": "number",
            "description": "Project fuel consumption in kg per year per device/household",
        },
        "project_ncv_mj_kg": {
            "type": "number",
            "description": "Net calorific value of project fuel in MJ/kg",
        },
        "project_efficiency": {
            "type": "number",
            "description": "Thermal efficiency of project stove/device as a decimal (e.g. 0.30 for 30%)",
        },
        "emission_factor_tco2_per_tj": {
            "type": "number",
            "description": "Emission factor in tCO2 per TJ for the fuel (NCV/TJ pathway)",
        },
        "emission_factor_kgco2_per_kg": {
            "type": "number",
            "description": "Emission factor in kgCO2 per kg of fuel (direct pathway, preferred). E.g. ~1.747 for wood.",
        },
        "fnrb": {
            "type": "number",
            "description": "Fraction of non-renewable biomass as a decimal (0-1)",
        },
        "fuel_savings_pct": {
            "type": "number",
            "description": "Percentage of fuel saved by the project as a decimal (0-1). E.g. 0.30 means 30% fuel savings.",
        },
        "project_is_biomass": {
            "type": "boolean",
            "description": "Whether the project technology still burns biomass. True for improved cookstoves, False for LPG/biogas switch.",
        },
        "leakage_factor": {
            "type": "number",
            "description": "Leakage factor as a decimal (0-1). 0 means no leakage.",
        },
        "crediting_period_years": {
            "type": "integer",
            "description": "Crediting period in years",
        },
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
            ],
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
    ) -> dict[str, Any]:
        """Extract carbon inputs from raw conversation text via LLM."""
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        try:
            resp = await client.chat.completions.create(
                model=settings.openai_orchestration_model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a carbon project analyst specialising in cookstove and "
                            "clean-cooking methodologies. Extract any carbon-ER-relevant "
                            "numeric inputs from the conversation below. "
                            "Only include values that are explicitly stated or clearly implied. "
                            "Convert units where needed (e.g. tonnes → kg). "
                            "For rates (usage_rate, adoption_rate, fnrb, efficiencies), return as decimals (0-1). "
                            "If the project clearly involves cookstoves, set method_pack to 'cookstoves'."
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
            f"PROJECT CONTEXT:\n{project_context}\n\nCONVERSATION:\n{conversation_text}"
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
