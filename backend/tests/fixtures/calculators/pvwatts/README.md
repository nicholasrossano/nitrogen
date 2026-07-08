# PVWatts golden fixtures (deferred)

PVWatts (`solar_estimate`) calls the live **NREL PVWatts V8 API**. Golden tests should not hit the network in CI.

## Planned approach

1. Record a fixed NREL JSON response once (with a valid `NREL_API_KEY`).
2. Store under `recorded/` (e.g. `phnom_penh_500kw_nrel_response.json`).
3. In pytest, mock `httpx` so `PVWattsEngine.call_pvwatts()` returns the recorded payload.
4. Assert adapter parse output against fixture `expect`.

## Fixture type

Use `source_type: methodology_worksheet` with `source` noting NREL PVWatts V8 capture date. These are **not** hand-calculated validation fixtures like LCOE/carbon — the external API response is the reference.

## Gotchas

- `build_default_inputs` may recompute tilt/azimuth from latitude unless inputs are marked validated.
- Address geocoding uses Nominatim separately — mock if testing address-based cases.
- API key required only for the one-time recording step, not CI runs.

Phase 1 implements LCOE + carbon validation only; PVWatts follows in a later phase.
