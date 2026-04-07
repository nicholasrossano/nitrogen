"""Adapter wrapper for LCOE engine."""

from __future__ import annotations

import time

from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.base import AdapterDefinition, AdapterResult, BaseAdapter
from app.core.execution_context import ExecutionContext
from app.services.lcoe_engine import LCOEEngine


class LCOEAdapter(BaseAdapter):
    @property
    def definition(self) -> AdapterDefinition:
        return AdapterDefinition(
            adapter_id="lcoe",
            name="LCOE Adapter",
            description="Run LCOE computation using existing internal engine.",
            provider="internal",
            adapter_type="python",
            input_schema={
                "type": "object",
                "properties": {
                    "tech_type": {"type": "string"},
                    "known_values": {"type": "object"},
                },
                "required": ["known_values"],
            },
            output_schema={
                "type": "object",
                "properties": {
                    "inputs": {"type": "object"},
                    "missing_essentials": {"type": "array", "items": {"type": "string"}},
                    "computable": {"type": "boolean"},
                    "result": {"type": "object"},
                    "sensitivity": {"type": "array", "items": {"type": "object"}},
                },
            },
            initiative_scope_required=False,
            visibility="internal",
            capabilities=["sync"],
        )

    async def execute(
        self,
        ctx: ExecutionContext,
        db: AsyncSession,
        inputs: dict,
    ) -> AdapterResult:
        _ = (ctx, db)
        started = time.perf_counter()

        tech_type = inputs.get("tech_type")
        known_values = inputs.get("known_values", {})
        engine_inputs = LCOEEngine.build_default_inputs(tech_type=tech_type, known_values=known_values)

        missing = LCOEEngine.get_missing_essentials(engine_inputs)
        computable = LCOEEngine.is_computable(engine_inputs)

        payload: dict = {
            "inputs": {k: v.to_dict() for k, v in engine_inputs.items()},
            "missing_essentials": missing,
            "computable": computable,
        }
        warnings: list[str] = []
        if computable:
            payload["result"] = LCOEEngine.calculate(engine_inputs).to_dict()
            payload["sensitivity"] = [p.to_dict() for p in LCOEEngine.run_sensitivity(engine_inputs)]
        else:
            warnings.append("Insufficient required inputs for LCOE calculation.")

        return AdapterResult(
            output=payload,
            execution_meta={"duration_ms": int((time.perf_counter() - started) * 1000)},
            provenance=[],
            warnings=warnings,
            artifacts=None,
        )

