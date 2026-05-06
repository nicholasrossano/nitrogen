"""Adapter wrapper for PVWatts engine."""

from __future__ import annotations

import time

from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.base import AdapterDefinition, AdapterResult, BaseAdapter
from app.core.execution_context import ExecutionContext
from app.mcp.exposure_policy import adapter_visibility
from app.domain.energy.services.pvwatts_engine import PVWattsEngine, PVWattsInput


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
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "title": "PVWattsInput",
                "description": "Inputs for the PVWatts production estimate adapter.",
                "type": "object",
                "properties": {
                    "known_values": {
                        "type": "object",
                        "description": "Known PVWatts input values keyed by engine field name.",
                    },
                    "serialized_inputs": {
                        "type": "object",
                        "description": "Previously serialized PVWatts inputs to restore before execution.",
                    },
                    "resolve_address": {
                        "type": "boolean",
                        "description": "Whether to geocode a provided address before calling PVWatts.",
                    },
                },
            },
            output_schema={
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "title": "PVWattsOutput",
                "description": "PVWatts estimate output and normalized engine inputs.",
                "type": "object",
                "properties": {
                    "inputs": {
                        "type": "object",
                        "description": "Normalized calculator inputs after defaults are applied.",
                    },
                    "missing_essentials": {
                        "type": "array",
                        "description": "Required fields still missing for a computable run.",
                        "items": {"type": "string"},
                    },
                    "computable": {
                        "type": "boolean",
                        "description": "Whether the provided inputs are sufficient for calculation.",
                    },
                    "result": {
                        "type": "object",
                        "description": "PVWatts API result when the estimate is computable.",
                    },
                    "geocode": {
                        "type": "object",
                        "description": "Resolved geocoding payload when address lookup is requested.",
                    },
                },
            },
            initiative_scope_required=False,
            visibility=adapter_visibility("pvwatts", "internal"),
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

