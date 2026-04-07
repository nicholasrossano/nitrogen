"""Adapter wrapper for PVWatts engine."""

from __future__ import annotations

import time

from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.base import AdapterDefinition, AdapterResult, BaseAdapter
from app.core.execution_context import ExecutionContext
from app.services.pvwatts_engine import PVWattsEngine, PVWattsInput


class PVWattsAdapter(BaseAdapter):
    @property
    def definition(self) -> AdapterDefinition:
        return AdapterDefinition(
            adapter_id="pvwatts",
            name="PVWatts Adapter",
            description="Run PVWatts solar production estimate via existing engine and API call.",
            provider="pvwatts",
            adapter_type="api",
            input_schema={
                "type": "object",
                "properties": {
                    "known_values": {"type": "object"},
                    "serialized_inputs": {"type": "object"},
                    "resolve_address": {"type": "boolean"},
                },
            },
            output_schema={
                "type": "object",
                "properties": {
                    "inputs": {"type": "object"},
                    "missing_essentials": {"type": "array", "items": {"type": "string"}},
                    "computable": {"type": "boolean"},
                    "result": {"type": "object"},
                    "geocode": {"type": "object"},
                },
            },
            initiative_scope_required=False,
            visibility="internal",
            capabilities=["async"],
        )

    async def execute(
        self,
        ctx: ExecutionContext,
        db: AsyncSession,
        inputs: dict,
    ) -> AdapterResult:
        _ = (ctx, db)
        started = time.perf_counter()

        known_values = dict(inputs.get("known_values") or {})
        serialized_inputs = inputs.get("serialized_inputs")
        if serialized_inputs:
            engine_inputs = {
                field_name: PVWattsInput.from_dict(field_data)
                for field_name, field_data in serialized_inputs.items()
            }
            engine_inputs = PVWattsEngine.refresh_location_defaults(engine_inputs)
            known_values = {field_name: inp.value for field_name, inp in engine_inputs.items()}

        warnings: list[str] = []
        geocode_payload: dict | None = None
        should_resolve_address = bool(inputs.get("resolve_address"))
        address = known_values.get("address")
        if should_resolve_address and address and (known_values.get("lat") is None or known_values.get("lon") is None):
            try:
                geocode_payload = await PVWattsEngine.geocode_address(str(address))
                known_values["lat"] = geocode_payload["lat"]
                known_values["lon"] = geocode_payload["lon"]
                known_values["address"] = geocode_payload["display_name"]
            except Exception as exc:
                warnings.append(f"Geocoding failed for '{address}': {exc}")

        engine_inputs = PVWattsEngine.build_default_inputs(known_values=known_values)
        missing = PVWattsEngine.get_missing_essentials(engine_inputs)
        computable = PVWattsEngine.is_computable(engine_inputs)

        payload: dict = {
            "inputs": {k: v.to_dict() for k, v in engine_inputs.items()},
            "missing_essentials": missing,
            "computable": computable,
        }
        if geocode_payload is not None:
            payload["geocode"] = geocode_payload
        if computable:
            payload["result"] = (await PVWattsEngine.call_pvwatts(engine_inputs)).to_dict()
        else:
            warnings.append("Insufficient required inputs for PVWatts estimate.")

        return AdapterResult(
            output=payload,
            execution_meta={"duration_ms": int((time.perf_counter() - started) * 1000)},
            provenance=[],
            warnings=warnings,
            artifacts=None,
        )

