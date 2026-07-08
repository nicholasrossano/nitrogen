# PVWatts golden fixtures

PVWatts (`solar_estimate`) calls the **NREL PVWatts V8 API**. Golden tests never hit the network in CI.

## Current fixture status

The committed PVWatts fixtures are **synthetic NREL v8-format snapshots**, not live NREL model output.

They verify that our adapter/engine **parses NREL-shaped PVWatts responses correctly** and **serializes results** (`ac_annual`, `capacity_factor`, `ac_monthly`). They do **not** yet validate against NREL's actual model output.

Fixture metadata today:

```json
"source_type": "synthetic_external_format_snapshot",
"source": "synthetic_nrel_pvwatts_v8_format_response"
```

## Layout

```
pvwatts/
  recorded/                          # NREL v8-format JSON payloads (synthetic for now)
    pvwatts_5mw_phnom_penh_response.json
    pvwatts_50kw_distributed_response.json
  pvwatts_5mw_phnom_penh.json        # Golden fixture envelope + expect
  pvwatts_50kw_distributed.json
```

## CI behavior

- `tests/calculators/test_pvwatts_golden.py` mocks `httpx.AsyncClient` and serves the paired `recorded/` JSON.
- No internet and no `NREL_API_KEY` required in CI.

## Converting to true recorded external references

To replace synthetic snapshots with live NREL responses:

```bash
cd backend && NREL_API_KEY=... python3 scripts/record_pvwatts_fixtures.py
```

Then for each fixture:

1. Update metadata to:

```json
"source_type": "recorded_external_reference",
"source": "recorded_nrel_pvwatts_v8_response"
```

2. Update `expect.result` to match the engine's rounded `to_dict()` output.
3. Rerun `pytest tests/calculators/test_pvwatts_golden.py` and ruff.

## Gotchas

- Lock tilt/azimuth with `_source_tilt: "user"` / `_source_azimuth: "user"` unless testing location-derived defaults.
- Address geocoding uses Nominatim separately — not covered by these fixtures.
- Assert only stable parsed fields (annual AC, capacity factor, monthly AC).
