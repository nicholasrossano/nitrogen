# PVWatts golden fixtures

PVWatts (`solar_estimate`) calls the **NREL PVWatts V8 API**. Golden tests never hit the network in CI.

## Current fixture status

Fixtures are **live-recorded NREL PVWatts V8 responses** (`recorded_external_reference`), mocked via `httpx` in pytest.

They validate that our adapter/engine **parses real NREL API output** and **serializes results** (`ac_annual`, `capacity_factor`, `ac_monthly`).

Fixture metadata:

```json
"source_type": "recorded_external_reference",
"source": "recorded_nrel_pvwatts_v8_response"
```

## Layout

```
pvwatts/
  recorded/                          # Raw NREL JSON snapshots
    pvwatts_5mw_phnom_penh_response.json
    pvwatts_50kw_distributed_response.json
  pvwatts_5mw_phnom_penh.json        # Golden fixture envelope + expect
  pvwatts_50kw_distributed.json
```

## CI behavior

- `tests/calculators/test_pvwatts_golden.py` mocks `httpx.AsyncClient` and serves the paired `recorded/` JSON.
- No internet and no `PVWATTS_API_KEY` required in CI.

## Re-recording (dev-only)

Requires `PVWATTS_API_KEY` in repo-root `.env` (see `.env.example`):

```bash
cd backend && python3 scripts/record_pvwatts_fixtures.py --update-fixtures
```

This overwrites `recorded/*.json` and refreshes fixture `expect.result` from the engine's `to_dict()` output.

## Gotchas

- NREL V8 requires `module_type` (engine sends `0` = standard).
- Lock tilt/azimuth with `_source_tilt: "user"` / `_source_azimuth: "user"` unless testing location-derived defaults.
- Address geocoding uses Nominatim separately — not covered by these fixtures.
- Production base URL uses `developer.nrel.gov` (configured in `app/config.py`).
