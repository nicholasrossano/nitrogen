"""
LCOE Tool — Levelized Cost of Energy modeling inside chat.

Orchestration flow:
1. Tool is invoked (by orchestration action or directly).
2. LLM extracts candidate inputs from chat history + uploaded docs.
3. Engine fills gaps with technology-appropriate defaults.
4. Inputs table widget is shown; user confirms / edits.
5. Engine calculates LCOE; outputs widget is shown.
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
from app.services.lcoe_engine import (
    LCOEEngine,
    LCOEInput,
    LCOEResult,
    SensitivityPoint,
)

settings = get_settings()
logger = logging.getLogger(__name__)

INPUT_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "technology_type": {
            "type": "string",
            "description": "Energy technology: solar_pv, wind, battery, mini_grid, clean_cooking, or other",
        },
        "net_capacity_kw": {
            "type": "number",
            "description": "Net installed capacity in kW",
        },
        "capacity_factor": {
            "type": "number",
            "description": "Capacity factor as a decimal (0-1)",
        },
        "total_capex": {
            "type": "number",
            "description": "Total capital expenditure in project currency",
        },
        "annual_opex": {
            "type": "number",
            "description": "Annual operations & maintenance cost",
        },
        "annual_fuel_cost": {
            "type": "number",
            "description": "Annual fuel cost (diesel, biomass, etc.) — 0 if N/A",
        },
        "discount_rate": {
            "type": "number",
            "description": "Discount rate / WACC as a decimal (e.g. 0.08 for 8%)",
        },
        "project_life_years": {
            "type": "integer",
            "description": "Project operational lifetime in years",
        },
        "degradation_rate": {
            "type": "number",
            "description": "Annual production degradation as a decimal",
        },
        "construction_years": {
            "type": "integer",
            "description": "Number of construction years before operation",
        },
        "currency": {
            "type": "string",
            "description": "Currency code (e.g. USD, EUR, KES)",
        },
        "location": {
            "type": "string",
            "description": "Project location / country / region if mentioned",
        },
    },
}


class LCOETool(BaseTool):
    """LCOE modeling tool for chat-based energy project economics."""

    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
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
        )

    @property
    def required_inputs(self) -> list[ToolInput]:
        return [
            ToolInput(
                name="net_capacity_kw",
                label="Net Capacity (kW)",
                description="What is the installed capacity of the project in kW?",
                input_type="number",
                placeholder="e.g. 500",
            ),
            ToolInput(
                name="total_capex",
                label="Total CAPEX",
                description="What is the total capital expenditure?",
                input_type="number",
                placeholder="e.g. 750000",
            ),
            ToolInput(
                name="annual_opex",
                label="Annual O&M Cost",
                description="What is the estimated annual operations & maintenance cost?",
                input_type="number",
                placeholder="e.g. 15000",
            ),
        ]

    @property
    def optional_inputs(self) -> list[ToolInput]:
        return [
            ToolInput(
                name="capacity_factor",
                label="Capacity Factor",
                description="Expected capacity factor (0-1). Will use technology default if not provided.",
                input_type="number",
                required=False,
                placeholder="e.g. 0.18",
            ),
            ToolInput(
                name="discount_rate",
                label="Discount Rate / WACC",
                description="Discount rate as a decimal. Default 8%.",
                input_type="number",
                required=False,
                default=0.08,
            ),
            ToolInput(
                name="project_life_years",
                label="Project Lifetime (years)",
                description="Operational lifetime in years. Default depends on technology.",
                input_type="number",
                required=False,
                default=25,
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
        tech_type: str | None = None,
    ) -> dict[str, Any]:
        """Extract LCOE inputs from raw conversation text via LLM."""
        client = AsyncOpenAI(api_key=settings.openai_api_key)
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
            tool_call = resp.choices[0].message.tool_calls[0]
            extracted = json.loads(tool_call.function.arguments)
            return {k: v for k, v in extracted.items() if v is not None}
        except Exception as e:
            logger.error(f"LCOE input extraction failed: {e}")
            return {}

    async def extract_inputs_from_context(
        self,
        db: AsyncSession,
        initiative_id: UUID,
    ) -> dict[str, Any]:
        """Extract LCOE inputs from DB-stored chat history and project context."""
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
        """Full LCOE execution: extract → fill defaults → calculate → return structured output."""

        extracted = await self.extract_inputs_from_context(db, initiative_id)
        merged = {**extracted, **{k: v for k, v in inputs.items() if v is not None}}

        tech_type = merged.pop("technology_type", None) or merged.pop("tech_type", None)
        merged.pop("location", None)

        engine_inputs = LCOEEngine.build_default_inputs(
            tech_type=tech_type,
            known_values=merged,
        )

        missing = LCOEEngine.get_missing_essentials(engine_inputs)
        computable = LCOEEngine.is_computable(engine_inputs)

        result_data: dict[str, Any] = {
            "inputs": {k: v.to_dict() for k, v in engine_inputs.items()},
            "missing_essentials": missing,
            "computable": computable,
            "technology_type": tech_type,
        }

        if computable:
            try:
                lcoe_result = LCOEEngine.calculate(engine_inputs)
                result_data["result"] = lcoe_result.to_dict()

                sensitivity = LCOEEngine.run_sensitivity(engine_inputs)
                result_data["sensitivity"] = [s.to_dict() for s in sensitivity]
                result_data["is_unruly"] = LCOEEngine.is_unruly(engine_inputs)
            except (ValueError, ZeroDivisionError) as e:
                result_data["error"] = str(e)
                result_data["computable"] = False

        return ToolOutput(
            tool_id="lcoe_model",
            output_type="lcoe",
            title="LCOE Analysis",
            content=result_data,
        )

    async def execute_from_conversation(
        self,
        conversation_text: str,
        planner_args: dict | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> tuple[str, dict]:
        """Run LCOE from conversation text — unified path for both chat contexts."""

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

        engine_inputs = LCOEEngine.build_default_inputs(
            tech_type=tech_type,
            known_values=extracted,
        )

        missing = LCOEEngine.get_missing_essentials(engine_inputs)
        computable = LCOEEngine.is_computable(engine_inputs)

        widget_data: dict = {
            "inputs": {k: v.to_dict() for k, v in engine_inputs.items()},
            "missing_essentials": missing,
            "computable": computable,
            "technology_type": tech_type,
        }

        if computable:
            await _progress("Calculating LCOE...")
            result = LCOEEngine.calculate(engine_inputs)
            widget_data["result"] = result.to_dict()

            await _progress("Running sensitivity analysis...")
            sensitivity = LCOEEngine.run_sensitivity(engine_inputs)
            widget_data["sensitivity"] = [s.to_dict() for s in sensitivity]
            widget_data["is_unruly"] = LCOEEngine.is_unruly(engine_inputs)

            widget_type = "lcoe_output"
            await _progress(
                f"LCOE: {result.currency} {result.lcoe:.4f}/kWh "
                f"({result.assumption_count} assumptions, {result.quality_label} confidence)"
            )
        else:
            widget_type = "lcoe_inputs"
            await _progress(f"Need {len(missing)} more inputs to compute — showing input table")

        return widget_type, widget_data

    async def recalculate(
        self,
        inputs_dict: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        """Recalculate from a dict of serialized LCOEInput dicts.

        This is the fast path used when the user edits a single value
        in the inputs table widget — no LLM call, pure math.
        """
        engine_inputs = {
            k: LCOEInput.from_dict(v) for k, v in inputs_dict.items()
        }

        computable = LCOEEngine.is_computable(engine_inputs)
        missing = LCOEEngine.get_missing_essentials(engine_inputs)

        result_data: dict[str, Any] = {
            "inputs": inputs_dict,
            "missing_essentials": missing,
            "computable": computable,
        }

        if computable:
            try:
                lcoe_result = LCOEEngine.calculate(engine_inputs)
                result_data["result"] = lcoe_result.to_dict()

                sensitivity = LCOEEngine.run_sensitivity(engine_inputs)
                result_data["sensitivity"] = [s.to_dict() for s in sensitivity]
                result_data["is_unruly"] = LCOEEngine.is_unruly(engine_inputs)
            except (ValueError, ZeroDivisionError) as e:
                result_data["error"] = str(e)
                result_data["computable"] = False

        return result_data
