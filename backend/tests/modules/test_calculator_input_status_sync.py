"""Ensure computed widgets preserve confirmed input row status/source metadata."""

from __future__ import annotations

import pytest

from app.modules.carbon_module import CarbonTool
from app.modules.lcoe_module import LCOETool
from app.modules.pvwatts_module import PVWattsTool


@pytest.mark.asyncio
async def test_lcoe_compute_stage_preserves_input_status_and_source(monkeypatch: pytest.MonkeyPatch) -> None:
    module = LCOETool()

    async def fake_recalculate_from_values(*, tech_type, known_values):
        _ = (tech_type, known_values)
        return {
            "inputs": {
                "net_capacity_kw": {
                    "field_name": "net_capacity_kw",
                    "value": 100,
                    "status": "assumed",
                    "source": "assumption",
                }
            }
        }

    monkeypatch.setattr(module, "recalculate_from_values", fake_recalculate_from_values)

    confirmed_stages = {
        "inputs": {
            "data": {
                "items": [
                    {
                        "content": {
                            "field_name": "net_capacity_kw",
                            "variable": "Net Capacity",
                            "value": 250,
                            "status": "validated",
                            "source": "user",
                        }
                    }
                ]
            }
        }
    }

    widget_data = await module.compute_stage("results", confirmed_stages, {})
    row = widget_data["inputs"]["net_capacity_kw"]
    assert row["value"] == 250
    assert row["status"] == "validated"
    assert row["source"] == "user"


@pytest.mark.asyncio
async def test_carbon_compute_stage_preserves_input_status_and_source(monkeypatch: pytest.MonkeyPatch) -> None:
    module = CarbonTool()

    async def fake_recalculate_from_values(*, method_pack, known_values):
        _ = (method_pack, known_values)
        return {
            "inputs": {
                "devices_households": {
                    "field_name": "devices_households",
                    "value": 1000,
                    "status": "assumed",
                    "source": "assumption",
                }
            }
        }

    monkeypatch.setattr(module, "recalculate_from_values", fake_recalculate_from_values)

    confirmed_stages = {
        "inputs": {
            "data": {
                "items": [
                    {
                        "content": {
                            "field_name": "devices_households",
                            "variable": "Devices / Households",
                            "value": 2000,
                            "status": "validated",
                            "source": "user",
                        }
                    }
                ]
            }
        }
    }

    widget_data = await module.compute_stage("results", confirmed_stages, {})
    row = widget_data["inputs"]["devices_households"]
    assert row["value"] == 2000
    assert row["status"] == "validated"
    assert row["source"] == "user"


@pytest.mark.asyncio
async def test_pvwatts_compute_external_preserves_input_status_and_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = PVWattsTool()

    class FakeAdapter:
        async def execute(self, ctx, db, inputs):
            _ = (ctx, db, inputs)

            class _Result:
                output = {
                    "inputs": {
                        "system_capacity": {
                            "field_name": "system_capacity",
                            "value": 12.0,
                            "status": "assumed",
                            "source": "assumption",
                        }
                    }
                }

            return _Result()

    class FakeRegistry:
        def get(self, adapter_id: str):
            if adapter_id == "pvwatts":
                return FakeAdapter()
            return None

    monkeypatch.setattr("app.modules.pvwatts_module.get_adapter_registry", lambda: FakeRegistry())

    confirmed_stages = {
        "inputs": {
            "data": {
                "items": [
                    {
                        "content": {
                            "field_name": "system_capacity",
                            "variable": "System Capacity",
                            "value": 22.5,
                            "status": "validated",
                            "source": "user",
                        }
                    }
                ]
            }
        }
    }

    widget_data = await module.compute_external("results", "pvwatts", confirmed_stages, {})
    row = widget_data["inputs"]["system_capacity"]
    assert row["value"] == 22.5
    assert row["status"] == "validated"
    assert row["source"] == "user"
