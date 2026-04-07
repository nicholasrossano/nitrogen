"""Adapter wrapper for Carbon engine."""

from __future__ import annotations

import time

from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.base import AdapterDefinition, AdapterResult, BaseAdapter
from app.core.execution_context import ExecutionContext
from app.services.carbon_engine import CarbonEngine


class CarbonAdapter(BaseAdapter):
    @property
    def definition(self) -> AdapterDefinition:
        return AdapterDefinition(
            adapter_id="carbon",
            name="Carbon Adapter",
            description="Run carbon emissions reduction computation using existing engine.",
            provider="internal",
            adapter_type="python",
            input_schema={
                "type": "object",
                "properties": {
                    "method_pack": {"type": "string"},
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

        method_pack = inputs.get("method_pack")
        known_values = inputs.get("known_values", {})
        engine_inputs = CarbonEngine.build_default_inputs(
            method_pack=method_pack,
            known_values=known_values,
        )

        missing = CarbonEngine.get_missing_essentials(engine_inputs)
        computable = CarbonEngine.is_computable(engine_inputs)

        payload: dict = {
            "inputs": {k: v.to_dict() for k, v in engine_inputs.items()},
            "missing_essentials": missing,
            "computable": computable,
        }
        warnings: list[str] = []
        if computable:
            payload["result"] = CarbonEngine.calculate(engine_inputs).to_dict()
            payload["sensitivity"] = [p.to_dict() for p in CarbonEngine.run_sensitivity(engine_inputs)]
        else:
            warnings.append("Insufficient required inputs for carbon calculation.")

        return AdapterResult(
            output=payload,
            execution_meta={"duration_ms": int((time.perf_counter() - started) * 1000)},
            provenance=[],
            warnings=warnings,
            artifacts=None,
        )

