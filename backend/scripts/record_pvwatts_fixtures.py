#!/usr/bin/env python3
"""Record live NREL PVWatts V8 responses for golden-test fixtures (dev-only).

Usage:
  cd backend && NREL_API_KEY=... python3 scripts/record_pvwatts_fixtures.py

CI does not run this script. Commit the generated JSON under
tests/fixtures/calculators/pvwatts/recorded/, then update each fixture to:

  "source_type": "recorded_external_reference",
  "source": "recorded_nrel_pvwatts_v8_response"

and refresh expect.result blocks if outputs change.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import httpx

BACKEND_ROOT = Path(__file__).resolve().parent.parent
FIXTURES_DIR = BACKEND_ROOT / "tests" / "fixtures" / "calculators" / "pvwatts" / "recorded"
NREL_URL = "https://developer.nrel.gov/api/pvwatts/v8.json"

CASES = {
    "pvwatts_5mw_phnom_penh_response.json": {
        "lat": 11.5564,
        "lon": 104.9282,
        "system_capacity": 5000,
        "assessment_type": 0,
        "array_type": 0,
        "tilt": 12,
        "azimuth": 180,
        "losses": 14,
        "dc_ac_ratio": 1.2,
        "inv_eff": 96,
        "gcr": 0.4,
    },
    "pvwatts_50kw_distributed_response.json": {
        "lat": 40.7128,
        "lon": -74.0060,
        "system_capacity": 50,
        "assessment_type": 0,
        "array_type": 1,
        "tilt": 41,
        "azimuth": 180,
        "losses": 14,
        "dc_ac_ratio": 1.2,
        "inv_eff": 96,
        "gcr": 0.4,
    },
}


async def record_case(name: str, params: dict[str, float | int]) -> None:
    api_key = os.environ.get("NREL_API_KEY") or os.environ.get("PVWATTS_API_KEY")
    if not api_key:
        print("Set NREL_API_KEY or PVWATTS_API_KEY to record live responses.", file=sys.stderr)
        sys.exit(1)

    query = {**params, "api_key": api_key, "timeframe": "monthly"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(NREL_URL, params=query)
        resp.raise_for_status()
        data = resp.json()

    if data.get("errors"):
        raise RuntimeError(f"{name}: NREL errors: {data['errors']}")

    out_path = FIXTURES_DIR / name
    out_path.write_text(json.dumps(data, indent=2) + "\n")
    outputs = data.get("outputs", {})
    print(f"Wrote {out_path.name}: ac_annual={outputs.get('ac_annual')} cf={outputs.get('capacity_factor')}")


async def main() -> None:
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    for name, params in CASES.items():
        await record_case(name, params)


if __name__ == "__main__":
    asyncio.run(main())
