#!/usr/bin/env python3
"""Record live NREL PVWatts V8 responses for golden-test fixtures (dev-only).

Usage:
  cd backend && python3 scripts/record_pvwatts_fixtures.py
  cd backend && python3 scripts/record_pvwatts_fixtures.py --update-fixtures

Reads PVWATTS_API_KEY from repo-root .env via app Settings (same as production).
CI does not run this script.

After recording, update each fixture to:

  "source_type": "recorded_external_reference",
  "source": "recorded_nrel_pvwatts_v8_response"

Pass --update-fixtures to rewrite expect.result from the engine's to_dict() output.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

import httpx

BACKEND_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_ROOT.parent
FIXTURES_DIR = BACKEND_ROOT / "tests" / "fixtures" / "calculators" / "pvwatts"
RECORDED_DIR = FIXTURES_DIR / "recorded"

CASES = {
    "pvwatts_5mw_phnom_penh_response.json": {
        "fixture_id": "pvwatts_5mw_phnom_penh",
        "params": {
            "lat": 11.5564,
            "lon": 104.9282,
            "system_capacity": 5000,
            "module_type": 0,
            "assessment_type": 0,
            "array_type": 0,
            "tilt": 12,
            "azimuth": 180,
            "losses": 14,
            "dc_ac_ratio": 1.2,
            "inv_eff": 96,
            "gcr": 0.4,
        },
        "known_values": {
            "lat": 11.5564,
            "lon": 104.9282,
            "system_capacity": 5000,
            "array_type": 0,
            "_source_tilt": "user",
            "tilt": 12,
            "_source_azimuth": "user",
            "azimuth": 180,
        },
    },
    "pvwatts_50kw_distributed_response.json": {
        "fixture_id": "pvwatts_50kw_distributed",
        "params": {
            "lat": 40.7128,
            "lon": -74.0060,
            "system_capacity": 50,
            "module_type": 0,
            "assessment_type": 0,
            "array_type": 1,
            "tilt": 41,
            "azimuth": 180,
            "losses": 14,
            "dc_ac_ratio": 1.2,
            "inv_eff": 96,
            "gcr": 0.4,
        },
        "known_values": {
            "lat": 40.7128,
            "lon": -74.0060,
            "system_capacity": 50,
            "array_type": 1,
            "_source_tilt": "user",
            "tilt": 41,
            "_source_azimuth": "user",
            "azimuth": 180,
        },
    },
}


def _load_dotenv() -> None:
    env_path = REPO_ROOT / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _load_api_config() -> tuple[str, str]:
    _load_dotenv()
    os.chdir(BACKEND_ROOT)
    sys.path.insert(0, str(BACKEND_ROOT))
    from app.config import get_settings

    get_settings.cache_clear()
    settings = get_settings()
    api_key = (
        settings.pvwatts_api_key
        or os.environ.get("PVWATTS_API_KEY", "")
        or os.environ.get("NREL_API_KEY", "")
    )
    if not api_key:
        print(
            "PVWATTS_API_KEY not found in repo .env or environment. "
            "Add it to .env (see .env.example) or export PVWATTS_API_KEY.",
            file=sys.stderr,
        )
        sys.exit(1)
    return api_key, settings.pvwatts_base_url


def _expect_from_engine(recorded: dict, known_values: dict) -> dict:
    from app.domain.energy.services.pvwatts_engine import PVWattsEngine, PVWattsResult

    inputs = PVWattsEngine.build_default_inputs(known_values)
    outputs = recorded["outputs"]
    variable_count = sum(1 for i in inputs.values() if i.status == "assumed")
    quality = "high" if variable_count <= 2 else "moderate" if variable_count <= 5 else "low"
    result = PVWattsResult(
        ac_annual=outputs.get("ac_annual", 0),
        capacity_factor=outputs.get("capacity_factor", 0),
        ac_monthly=outputs.get("ac_monthly", [0] * 12),
        solrad_monthly=outputs.get("solrad_monthly", [0] * 12),
        solrad_annual=outputs.get("solrad_annual", 0),
        poa_monthly=outputs.get("poa_monthly", [0] * 12),
        dc_monthly=outputs.get("dc_monthly", [0] * 12),
        station_info=recorded.get("station_info", {}),
        variable_count=variable_count,
        quality_label=quality,
    )
    parsed = result.to_dict()
    return {
        "ac_annual": {"value": parsed["ac_annual"], "abs_tolerance": 0.05},
        "capacity_factor": {"value": parsed["capacity_factor"], "abs_tolerance": 0.001},
        "ac_monthly": {"values": parsed["ac_monthly"], "abs_tolerance": 0.05},
    }


async def record_case(
    name: str,
    case: dict,
    *,
    api_key: str,
    base_url: str,
    update_fixtures: bool,
) -> None:
    query = {**case["params"], "api_key": api_key, "timeframe": "monthly"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(base_url, params=query)
        resp.raise_for_status()
        data = resp.json()

    if data.get("errors"):
        raise RuntimeError(f"{name}: NREL errors: {data['errors']}")

    out_path = RECORDED_DIR / name
    out_path.write_text(json.dumps(data, indent=2) + "\n")
    outputs = data.get("outputs", {})
    print(f"Wrote {out_path.name}: ac_annual={outputs.get('ac_annual')} cf={outputs.get('capacity_factor')}")

    if update_fixtures:
        fixture_path = FIXTURES_DIR / f"{case['fixture_id']}.json"
        fixture = json.loads(fixture_path.read_text())
        fixture["description"] = fixture["description"].replace(
            "synthetic NREL PVWatts V8-format snapshot",
            "recorded NREL PVWatts V8 response",
        ).replace("recorded NREL PVWatts V8 snapshot", "recorded NREL PVWatts V8 response")
        fixture["source"] = "recorded_nrel_pvwatts_v8_response"
        fixture["source_type"] = "recorded_external_reference"
        fixture["methodology_notes"]["reference_type"] = "live_nrel_v8_api_response"
        fixture["expect"]["result"] = _expect_from_engine(data, case["known_values"])
        fixture_path.write_text(json.dumps(fixture, indent=2) + "\n")
        print(f"Updated {fixture_path.name}")


async def main(update_fixtures: bool) -> None:
    api_key, base_url = _load_api_config()
    RECORDED_DIR.mkdir(parents=True, exist_ok=True)
    for name, case in CASES.items():
        await record_case(name, case, api_key=api_key, base_url=base_url, update_fixtures=update_fixtures)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Record live NREL PVWatts V8 golden-test payloads.")
    parser.add_argument(
        "--update-fixtures",
        action="store_true",
        help="Rewrite fixture metadata and expect.result from recorded responses.",
    )
    args = parser.parse_args()
    asyncio.run(main(update_fixtures=args.update_fixtures))
