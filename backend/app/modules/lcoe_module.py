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

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

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


class LCOETool(BaseModule):
    """LCOE modeling tool for chat-based energy project economics."""

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
            primary_ui_object="lcoe_output",
            workspace_build_widget="lcoe_inputs",
            workspace_output_widget="lcoe_output",
            export_artifact_types=["xlsx"],
            adapter_bindings={"core_engine": "lcoe"},
            input_dependencies=["solar_estimate"],
            produced_outputs=["lcoe_kwh", "lcoe_sensitivity", "lcoe_inputs"],
            downstream_dependencies=[],
            assumptions_behavior="tracks",
            evidence_behavior="none",
        )

    def is_exportable(self, content: dict) -> bool:
        return bool(
            isinstance(content, dict)
            and content.get("computable", False)
            and content.get("inputs")
        )

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
            ModuleInput(
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
        user_id: str | None = None,
        db: AsyncSession | None = None,
    ) -> dict[str, Any]:
        """Extract LCOE inputs from raw conversation text via LLM."""
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

    async def extract_inputs_from_context(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        user_id: str | None = None,
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
    ) -> ModuleOutput:
        """Full LCOE execution: extract → fill defaults → calculate → return structured output."""

        extracted = await self.extract_inputs_from_context(db, initiative_id)
        merged = {**extracted, **{k: v for k, v in inputs.items() if v is not None}}

        tech_type = merged.pop("technology_type", None) or merged.pop("tech_type", None)
        merged.pop("location", None)
        adapter = get_adapter_registry().get("lcoe")
        if adapter is None:
            raise RuntimeError("lcoe adapter is not registered.")
        ctx = ExecutionContext(
            user_id=getattr(self, "user_id", None) or "system",
            user_email=None,
            initiative_id=initiative_id,
            initiative_role=None,
            ai_access_granted=True,
            is_byok=False,
            request_id=f"lcoe:{initiative_id}",
        )
        result = await adapter.execute(ctx, db, {"tech_type": tech_type, "known_values": merged})
        result_data: dict[str, Any] = dict(result.output)
        result_data["technology_type"] = tech_type

        return ModuleOutput(
            module_id="lcoe_model",
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
        adapter = get_adapter_registry().get("lcoe")
        if adapter is None:
            raise RuntimeError("lcoe adapter is not registered.")
        ctx = ExecutionContext(
            user_id=getattr(self, "user_id", None) or "system",
            user_email=None,
            initiative_id=None,
            initiative_role=None,
            ai_access_granted=True,
            is_byok=False,
            request_id="lcoe:conversation",
        )
        await _progress("Calculating LCOE...")
        result = await adapter.execute(ctx, None, {"tech_type": tech_type, "known_values": extracted})
        widget_data: dict[str, Any] = dict(result.output)
        widget_data["technology_type"] = tech_type
        if widget_data.get("computable"):
            widget_type = "lcoe_output"
            lcoe_result = (widget_data.get("result") or {})
            await _progress(
                f"LCOE: {lcoe_result.get('currency', '')} {lcoe_result.get('lcoe', 0):.4f}/kWh "
                f"({lcoe_result.get('assumption_count', 0)} assumptions, {lcoe_result.get('quality_label', 'unknown')} confidence)"
            )
        else:
            widget_type = "lcoe_inputs"
            await _progress(
                f"Need {len(widget_data.get('missing_essentials', []))} more inputs to compute — showing input table"
            )

        return widget_type, widget_data

    async def recalculate(
        self,
        inputs_dict: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        """Recalculate from a dict of serialized LCOEInput dicts.

        This is the fast path used when the user edits a single value
        in the inputs table widget — no LLM call, pure math.
        """
        known_values: dict[str, Any] = {}
        for key, value in inputs_dict.items():
            if isinstance(value, dict):
                known_values[key] = value.get("value")
            else:
                known_values[key] = value
        tech_type = known_values.pop("technology_type", None)

        adapter = get_adapter_registry().get("lcoe")
        if adapter is None:
            raise RuntimeError("lcoe adapter is not registered.")
        ctx = ExecutionContext(
            user_id=getattr(self, "user_id", None) or "system",
            user_email=None,
            initiative_id=None,
            initiative_role=None,
            ai_access_granted=True,
            is_byok=False,
            request_id="lcoe:recalculate",
        )
        result = await adapter.execute(ctx, None, {"tech_type": tech_type, "known_values": known_values})
        result_data = dict(result.output)
        result_data["technology_type"] = tech_type
        return result_data
