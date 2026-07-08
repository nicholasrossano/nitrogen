# Calculator Golden Set Reference

Validation-first golden tests for `lcoe_model` and `carbon_model`. Expected values come from documented methodology — **not** from running the current engine unless `source_type` is `regression_snapshot`.

## Core rules

| `source_type` | `expect` derived from | Directory |
|---|---|---|
| `validated_independent` | Hand calculation / external methodology formula | `lcoe/`, `carbon/` |
| `validated_internal_methodology` | Hand calculation vs internal screening spec | `carbon/` (e.g. biodigester) |
| `verified_spreadsheet` | Spreadsheet | `lcoe/`, `carbon/` |
| `methodology_worksheet` | External methodology (e.g. NREL recorded response) | `pvwatts/` (future) |
| `regression_snapshot` | Engine output at capture time | `regression/lcoe/`, `regression/carbon/` |

**Never** change validation `expect` values to make CI green when the engine diverges from methodology. Failures indicate engine/spec alignment gaps.

## Tolerances

| Metric | Tolerance |
|---|---|
| LCOE `lcoe` | `abs_tolerance: 0.000001` |
| LCOE NPV / lifetime energy | `pct_tolerance: 0.00001` (0.001%) |
| Carbon tCO₂e totals | `pct_tolerance: 0.00001` |
| Zero leakage | `abs_tolerance: 0.000001` |

`pct_tolerance >= 0.01` requires `tolerance_exception` on the metric.

## LCOE validation methodology

```
LCOE = NPV(costs) / NPV(energy)

year_1_energy_kwh = net_capacity_kw × 8760 × capacity_factor
energy_kwh_for_operational_year_n = year_1_energy_kwh × (1 - degradation_rate)^(n - 1)

npv_total_costs = total_capex + Σ (annual_costs_n / (1 + r)^n)   for n = 1 .. project_life_years
npv_total_energy = Σ (energy_n / (1 + r)^n)                       for n = 1 .. project_life_years
lifetime_energy_kwh = Σ energy_n (undiscounted)
```

**Engine behavior (aligned with validation):**

- When `construction_years` is **omitted or 0**: full `total_capex` at t = 0; `project_life_years` = operating years only; costs/energy discounted at `(1+r)^n` for operating year `n = 1..life`.
- When `construction_years > 0` is **explicitly provided**: capex spread equally across construction years; operating phase follows for `project_life_years`.
- Tech defaults **do not** inject `construction_years` — only user-provided values apply.
- Year 1 production is undegraded (`(1-deg)^(n-1)` with n=1 → exponent 0).
- LCOE output uses 10 decimal places; `lcoe` must equal `npv_total_costs / npv_total_energy` under the same inputs.

**Fixture note:** `wind_100mw_baseline` `lcoe` expect was corrected to `0.0485069979` — the prior value (`0.0485096352`) was inconsistent with the fixture's own NPV totals under this DCF spec.

## Carbon global conventions

- `net_er_tco2e` = **year-1 annual** tCO₂e (schedule row `yr=1`), not lifetime total
- Fuel consumption fields are **per household/device**, not project totals
- Validation fixtures default `leakage_factor = 0`, `usage_rate = 1.0`, `adoption_rate = 1.0`
- `active_units = int(base_count × yr_adopt)` (truncates toward zero)
- If `adoption_rate < 1.0`: `yr_adopt = min(adoption_rate × yr, 1.0)`; else `yr_adopt = adoption_rate`

## Carbon pack summary

| Pack | Validation status | Fixtures |
|---|---|---|
| `cookstoves` | **Ready** | `cookstoves_1000hh_tj_efficiency_derived.json` |
| `fuel_switch` | **Ready** | `fuel_switch_5000hh_biomass_to_lpg.json` |
| `grid_renewable` | **Ready** | `grid_renewable_5mw_grid_export.json` |
| `solar_home` | **Ready** | `solar_home_20000_kerosene_liters.json`, `solar_home_10000_pv_kwh.json` |
| `efficient_lighting` | **Ready** | `efficient_lighting_100k_led_ams.json` |
| `safe_water` | **Ready** | `safe_water_50000_ceramic_filter.json` |
| `biodigester` | **Ready (screening)** | `biodigester_500_dairy_screening.json` |

Screening/estimation tools — not audit-grade Verra/GS engines. User choices: `generation_model`, `displacement_mode` only where they reflect real project distinctions.

---

## cookstoves

### Validation status
**Ready for validation: yes**

Use one EF path per fixture; set `leakage_factor: 0` for baseline validation cases.

### Year-1 formula

**Step 1 — Per-household specific emissions (tCO₂e/HH/yr), before device count:**

If `emission_factor_kgco2_per_kg > 0`:
```
bl_specific = baseline_fuel_kg_yr × emission_factor_kgco2_per_kg / 1000
pj_specific = project_fuel_kg_yr × emission_factor_kgco2_per_kg / 1000
```
Else (TJ + NCV path):
```
bl_specific = (baseline_fuel_kg_yr × baseline_ncv_mj_kg / 1e6) × emission_factor_tco2_per_tj
pj_specific = (project_fuel_kg_yr × project_ncv_mj_kg / 1e6) × emission_factor_tco2_per_tj
```

**Step 2 — Apply fNRB (biomass-to-biomass; both baseline and project):**
```
bl_specific *= fnrb
pj_specific *= fnrb
```

**Step 3 — Year 1 totals:**
```
active_devices = int(devices_households × yr_adopt)
baseline_emissions_tco2e = active_devices × usage_rate × bl_specific
project_emissions_tco2e  = active_devices × usage_rate × pj_specific
leakage_tco2e          = leakage_factor × max(baseline - project, 0)
net_er_tco2e             = baseline - project - leakage
```

### Inputs and units

| Field | Unit | Basis | Required? | Default | Notes |
|---|---|---|---|---|---|
| `method_pack` | — | — | Yes | `cookstoves` | |
| `devices_households` | count | total project | **Yes** | — | Integer-truncated after adoption |
| `baseline_fuel_consumption_kg_yr` | kg/yr | **per device/HH** | **Yes** | — | Not total project fuel |
| `project_fuel_consumption_kg_yr` | kg/yr | **per device/HH** | Conditional | — | Required OR derive via savings/efficiency |
| `usage_rate` | fraction | multiplier | No | 1.0 | Scales both BL and PJ |
| `adoption_rate` | fraction | ramp | No | 1.0 | `<1` ramps over crediting years |
| `baseline_ncv_mj_kg` | MJ/kg | per fuel | No | 15.6 | TJ path only |
| `project_ncv_mj_kg` | MJ/kg | per fuel | No | 15.6 | TJ path only |
| `baseline_efficiency` | fraction | stove η | No | 0.10 | For derivation only |
| `project_efficiency` | fraction | stove η | No | 0.30 | For derivation only |
| `fuel_savings_pct` | fraction | savings | No | — | e.g. 0.30 = 30% savings |
| `emission_factor_tco2_per_tj` | tCO₂/TJ | — | No | 112.0 | TJ path |
| `emission_factor_kgco2_per_kg` | kgCO₂/kg fuel | — | No | **1.747** | **Takes priority if > 0** |
| `fnrb` | fraction | non-renewable biomass | No | 0.70 | Applied to **both** BL and PJ |
| `leakage_factor` | fraction | of gross ER | No | 0.0 (validation) | Engine field default 0.0 |
| `crediting_period_years` | years | schedule length | No | 10 | Top-level still year-1 only |

### Branching logic

1. **EF path:** if `emission_factor_kgco2_per_kg > 0` → kg path; **NCV and tCO₂/TJ ignored**. Else → TJ path.
2. **Project fuel (if `project_fuel_consumption_kg_yr` is 0/missing):**
   - If `fuel_savings_pct > 0`: `pj = bl × (1 - fuel_savings_pct)`
   - Else if `baseline_efficiency > 0` and `project_efficiency > 0`: `pj = bl × (bl_eff / pj_eff)`
   - Else: not computable
3. **`baseline_fuel_type` / `project_fuel_type`:** UI metadata only — engine does not auto-fill EF/NCV from fuel type.

### Defaults
- NCV: 15.6 MJ/kg (both)
- Efficiencies: 0.10 / 0.30
- EF: kg path 1.747 **or** TJ path 112 tCO₂/TJ (pick one per fixture; validation must zero kg EF for TJ path)
- fNRB: 0.70
- usage/adoption: 1.0
- leakage: 0.0 (validation)
- crediting: 10 years

### Known engine gaps / simplifications
- Default `emission_factor_kgco2_per_kg = 1.747` means **TJ path is never used unless kg EF zeroed** — validation fixtures must explicitly zero kg EF for TJ-path tests
- `FUEL_EF_DEFAULTS` in code is **not wired** into calculation from `baseline_fuel_type`
- fNRB applied to project side (biomass-to-biomass) — correct for this pack
- Device count uses `int()` truncation

---

## fuel_switch

### Validation status
**Ready for validation: yes**

Set `leakage_factor: 0` in validation fixtures (engine default is **0.10**).

### Year-1 formula

**Per-household specific (tCO₂e/HH/yr):**
```
bl_specific = baseline_fuel_kg_yr × (baseline_ncv_mj_kg / 1e6)
              × (fnrb × bl_ef_co2_tco2_per_tj + bl_ef_nonco2_tco2e_per_tj)

pj_specific = project_fuel_kg_yr × (project_ncv_mj_kg / 1e6)
              × (pj_ef_co2_tco2_per_tj + pj_ef_nonco2_tco2e_per_tj)
              # no fNRB on project fossil fuel
```

**Year 1:**
```
active_devices = int(devices_households × yr_adopt)
baseline_emissions_tco2e = active_devices × usage_rate × bl_specific
project_emissions_tco2e  = active_devices × usage_rate × pj_specific
leakage_tco2e          = leakage_factor × max(baseline - project, 0)
net_er_tco2e             = baseline - project - leakage
```

### Inputs and units

| Field | Unit | Basis | Required? | Default | Notes |
|---|---|---|---|---|---|
| `devices_households` | count | total project | **Yes** | — | |
| `baseline_fuel_consumption_kg_yr` | kg/yr | **per HH** | **Yes** | — | |
| `project_fuel_consumption_kg_yr` | kg/yr | **per HH** | **Yes** | — | Must be supplied directly |
| `baseline_ncv_mj_kg` | MJ/kg | — | No | 15.6 | |
| `project_ncv_mj_kg` | MJ/kg | — | No | 47.3 | LPG-like default |
| `bl_ef_co2_tco2_per_tj` | tCO₂/TJ | — | No | 112.0 | |
| `bl_ef_nonco2_tco2e_per_tj` | tCO₂e/TJ | — | No | 9.46 | |
| `pj_ef_co2_tco2_per_tj` | tCO₂/TJ | — | No | 63.1 | |
| `pj_ef_nonco2_tco2e_per_tj` | tCO₂e/TJ | — | No | 0.0 | |
| `fnrb` | fraction | baseline biomass only | No | 0.70 | **Not applied to project** |
| `usage_rate` | fraction | — | No | 1.0 | |
| `adoption_rate` | fraction | — | No | 1.0 | |
| `leakage_factor` | fraction | — | No | **0.10 engine** / **0 validation** | |
| `crediting_period_years` | years | — | No | 10 | |

### Branching logic
- No project-fuel derivation from efficiencies — **both fuel consumptions must be provided**
- fNRB only inside baseline term
- Non-biomass baseline: validation should document whether fNRB=1.0 or fNRB still applies

### Defaults
See table. Validation: `leakage_factor = 0`.

### Known engine gaps / simplifications
- Engine default leakage 0.10 will break validation unless overridden in fixture
- Fuel-type selects don't auto-populate EF/NCV from `FUEL_EF_DEFAULTS`

---

## safe_water

### Validation status
**Ready for validation: yes** — energy-based boiling displacement; `baseline_ncv_mj_kg` not used in calc.

Project emissions = total project `project_electricity_kwh_yr` × grid EF × (1 + T&D) — **not** scaled by adoption rate.

### Year-1 formula (as implemented in engine)

```
water_L_cap = min(water_per_person_day, 5.5)

specific_energy_kJ_per_L = 360.83 / baseline_stove_efficiency

ef_b_tco2_per_litre = (specific_energy_kJ_per_L / 1e9)
                      × (fnrb × bl_ef_co2 + bl_ef_nonco2)
                      # NOTE: baseline_ncv NOT used here

behaviour_factor = max(1 - proportion_already_safe - proportion_still_boiling, 0)

pe_electricity_total = project_electricity_kwh_yr × project_grid_ef_tco2_per_kwh
                       × (1 + project_tdl_pct)

active_people = int(people_served × yr_adopt)
Q_y_litres = active_people × water_L_cap × operational_days_yr × usage_rate

baseline_emissions_tco2e = ef_b_tco2_per_litre × behaviour_factor × Q_y × water_quality_modifier
project_emissions_tco2e  = pe_electricity_total × yr_adopt
leakage_tco2e          = leakage_factor × max(baseline - project, 0)
net_er_tco2e             = baseline - project - leakage
```

**Intended validation formula (not yet reconciled):** should chain 360.83 kJ/L → fuel mass → NCV → EF → fNRB explicitly.

### Inputs and units

| Field | Unit | Basis | Required? | Default | Notes |
|---|---|---|---|---|---|
| `people_served` | people | total project | **Yes** | — | |
| `water_per_person_day` | L/day | per person | No | 4.0 | Capped at 5.5 |
| `operational_days_yr` | days/yr | — | No | 347 | |
| `usage_rate` | fraction | — | No | 1.0 | Applies to Q_y |
| `adoption_rate` | fraction | — | No | 1.0 | Scales people |
| `baseline_stove_efficiency` | fraction | η | No | 0.10 | |
| `baseline_ncv_mj_kg` | MJ/kg | — | No | 15.6 | **Not used in engine calc** |
| `bl_ef_co2_tco2_per_tj` | tCO₂/TJ | — | No | 112.0 | |
| `bl_ef_nonco2_tco2e_per_tj` | tCO₂e/TJ | — | No | 9.46 | |
| `fnrb` | fraction | — | No | 0.70 | |
| `proportion_already_safe` | fraction | C_b | No | 0.0 | |
| `proportion_still_boiling` | fraction | X_cleanboil | No | 0.0 | |
| `water_quality_modifier` | fraction | M_q | No | 1.0 | |
| `project_electricity_kwh_yr` | kWh/yr | **total project** | No | 0.0 | Not per person |
| `project_grid_ef_tco2_per_kwh` | tCO₂/kWh | — | No | 0.001 | |
| `project_tdl_pct` | fraction | T&D on project elec | No | 0.20 | |
| `leakage_factor` | fraction | — | No | 0.05 | Validation should use 0 |
| `crediting_period_years` | years | — | No | 10 | |

### Branching logic
- No fuel-type auto EF
- `water_treatment_type`, `baseline_stove_type`, `baseline_fuel_type`: **metadata only** in engine

### Known engine gaps / simplifications
- NCV collected but not applied in baseline EF
- Project PE uses total project kWh, not per-person treatment energy
- **Regression snapshot only** until validation spec reconciled

---

## grid_renewable

### Validation status
**Ready for validation: yes**

User choice: `generation_model` = `grid_export` (default) | `end_use_displacement`

### Year-1 formula — `grid_export` (default)

```
gen_mwh = installed_capacity_kw × capacity_factor × 8760
          × (1 - auxiliary_consumption_pct)
          × (1 - annual_degradation)^(yr - 1) / 1000

baseline_emissions_tco2e = gen_mwh × grid_emission_factor
project_emissions_tco2e = 0
net_er_tco2e = baseline - leakage
```

**No T&D** applied in `grid_export` even if `td_losses_pct` is set.

### Year-1 formula — `end_use_displacement`

Same `gen_mwh`; then:

```
baseline_emissions_tco2e = gen_mwh × grid_emission_factor × (1 + td_losses_pct)
```

### Hand-calculated anchor (`grid_renewable_5mw_grid_export`)

Inputs: 5000 kW, CF 0.25, aux 0, deg 0.005 (yr-1 undegraded), grid EF 0.45 tCO₂/MWh, `td_losses_pct` 0.15 (ignored for grid_export), leakage 0.

```
gen_mwh = 5000 × 0.25 × 8760 / 1000 = 10,950 MWh
net_er  = 10,950 × 0.45 = 4,927.5 tCO₂e
```

---

## solar_home

### Validation status
**Ready for validation: yes**

User choice: `displacement_mode` = `kerosene_liters` (default) | `pv_kwh`

### Year-1 — `kerosene_liters`

```
net_er = num_systems × baseline_fuel_consumption_l_yr
         × baseline_fuel_ef_tco2_per_litre × usage_rate
```

### Year-1 — `pv_kwh`

```
kwh_per_system = system_capacity_wp × peak_sun_hours × 365 × system_efficiency / 1000
net_er = num_systems × kwh_per_system × displaced_ef_tco2_per_kwh × usage_rate
```

Hand-calculated: kerosene 20k × 120 L × 0.00249 = **5,976 tCO₂e**; PV 10k × 57.4875 kWh × 0.001 = **574.875 tCO₂e**.

### Inputs and units

| Field | Unit | Basis | Required? | Default | Notes |
|---|---|---|---|---|---|
| `num_systems` | count | total project | **Yes** | — | |
| `baseline_fuel_consumption_l_yr` | L/yr | **per HH/system** | No* | 0 | *If >0 triggers Path A |
| `baseline_fuel_ef_tco2_per_litre` | tCO₂/L | — | No | 0.00249 | Kerosene-like |
| `system_capacity_wp` | Wp | per system | No | 50 | Path B only |
| `peak_sun_hours` | h/day | — | No | 4.5 | Path B |
| `system_efficiency` | fraction | battery+inverter | No | 0.70 | Path B |
| `annual_degradation` | fraction/yr | — | No | 0.01 | |
| `usage_rate` | fraction | — | No | 1.0 | |
| `leakage_factor` | fraction | — | No | 0.0 | |
| `crediting_period_years` | years | — | No | 10 | |

### Branching logic
1. **If `baseline_fuel_consumption_l_yr > 0`** → kerosene path; PV fields ignored for baseline ER
2. **Else** → PV proxy path (validation: **blocked** until EF units fixed)
3. No adoption ramp on num_systems

### Known engine gaps / simplifications
- PV path uses tCO₂/**L** on **kWh** output
- **Regression snapshot only**

---

## biodigester

### Validation status
**Ready for validation: no**

Why: simplified Tier-1 AWMS; `awms_baseline_type` unused; thermal fuel label says "per HH" but code treats `baseline_fuel_consumption_kg_yr` as **per digester**; physical leakage hardcoded at 10%.

### Year-1 formula (as implemented)

```
ef_ch4 = LIVESTOCK_EF_CH4[livestock_type]    # kg CH4/head/yr

be_awms = GWP_CH4_AR5 × uf_b × usage_rate × num_animals × ef_ch4 / 1000    # tCO₂e per digester
pe_phys = 0.10 × GWP_CH4_AR5 × num_animals × ef_ch4 / 1000                 # tCO₂e per digester

bl_thermal = baseline_fuel_kg_yr × (baseline_ncv/1e6)
             × (fnrb × bl_ef_co2 + bl_ef_nonco2)                              # per digester

active_digesters = int(num_digesters × yr_adopt)

baseline_emissions = active × (be_awms + bl_thermal)
project_emissions  = active × pe_phys
leakage            = leakage_thermal_factor × max(bl_thermal × active, 0)
net_er               = baseline - project - leakage
```

GWP: **28 (IPCC AR5 GWP100)** — `GWP_CH4_AR5 = 28.0`.

**LIVESTOCK_EF_CH4 (kg CH4/head/yr):** dairy_cattle 48.0, other_cattle 1.0, swine 7.0, poultry 0.02, buffalo 2.0, sheep 0.19, goats 0.13

### Inputs and units

| Field | Unit | Basis | Required? | Default | Notes |
|---|---|---|---|---|---|
| `num_digesters` | count | total project | **Yes** | — | |
| `num_animals` | head | **per digester** | **Yes** | — | Not total herd |
| `livestock_type` | — | — | No | dairy_cattle | Sets CH4 EF |
| `usage_rate` | fraction | digester uptime | No | 0.90 | AWMS only |
| `adoption_rate` | fraction | — | No | 1.0 | |
| `uf_b` | fraction | uncertainty | No | 0.89 | |
| `baseline_fuel_consumption_kg_yr` | kg/yr | **per digester** (code) | No | 0 | Label says "per HH" — **ambiguous** |
| `baseline_ncv_mj_kg` | MJ/kg | — | No | 15.6 | Thermal |
| `bl_ef_co2_tco2_per_tj` | tCO₂/TJ | — | No | 112.0 | |
| `bl_ef_nonco2_tco2e_per_tj` | tCO₂e/TJ | — | No | 9.46 | |
| `fnrb` | fraction | thermal biomass | No | 0.70 | |
| `leakage_thermal_factor` | fraction | thermal only | No | 0.05 | Separate from AWMS leakage |
| `awms_baseline_type` | — | metadata | No | lagoon | **Not used in calc** |
| `crediting_period_years` | years | — | No | 10 | |

### Known engine gaps / simplifications
- Tier-1 proxy only; no VS/manure mass
- `awms_baseline_type` ignored
- Thermal fuel basis ambiguous (label vs code)
- **Regression snapshot only**

---

## efficient_lighting

### Validation status
**Ready for validation: yes** — AMS-II.J-style screening formula (LFR, NTG, T&D). No simple-vs-AMS user toggle.

### Year-1 formula

```
operating_h = min(operating_hours_per_day, 5.0)
ES_kwh_per_lamp_yr = (baseline_wattage - project_wattage) × operating_h × 365 / 1000
LFR = min(0.5 × yr × operating_h × 365 / rated_lamp_life_hours, 1.0)
NES_kwh = num_lamps × (1 - LFR) × ES × (1 / (1 - td_losses_pct)) × ntg_factor
net_er_tco2e = NES_kwh × grid_emission_factor / 1000
```

### Hand-calculated anchor (`efficient_lighting_100k_led_ams`)

100k lamps, 60→9 W, 3.5 h/day, grid EF 0.45, TD 10%, NTG 0.95 → **3,015.67 tCO₂e** (yr 1).

---

## Known engine gaps checklist

| Gap | Status | Notes |
|---|---|---|
| LCOE capex at t=0 when construction omitted | **Closed** | Engine pays full capex at t=0 |
| LCOE `project_life_years` = operating years | **Closed** | When construction_years=0 |
| LCOE construction not injected from tech defaults | **Closed** | Only explicit user values |
| LCOE degradation indexing | **Closed** | 0-based operational year; year 1 undegraded |
| Carbon unknown `method_pack` | **Closed** | Adapter rejects unknown packs |
| `grid_renewable` T&D on grid_export | **Closed** | T&D only when `generation_model=end_use_displacement` |
| `solar_home` displacement paths | **Closed** | `displacement_mode`; PV uses tCO₂/kWh |
| `efficient_lighting` AMS-II.J | **Closed** | Validation uses current AMS-style engine |
| `safe_water` energy chain | **Closed** | NCV not used; PE not scaled by adoption |
| `biodigester` screening spec | **Closed** | Documented as screening; labels per digester |

---

## PVWatts — deferred

See [`pvwatts/README.md`](pvwatts/README.md). Recorded NREL JSON + mocked HTTP; not hand-calculated validation.

## Fixture layout

```
fixtures/calculators/
  lcoe/                 # LCOE validation fixtures
  carbon/               # All 7 pack validation fixtures + negatives
  regression/lcoe/      # LCOE regression_snapshot (optional)
  regression/carbon/    # Optional engine snapshots (validation preferred)
  pvwatts/              # PVWatts deferred
```

## Test modules

| Module | Purpose |
|---|---|
| `test_lcoe_golden_validation.py` | Methodology-backed LCOE fixtures |
| `test_lcoe_golden_regression.py` | LCOE regression snapshots |
| `test_carbon_golden_validation.py` | Methodology-backed carbon fixtures |
| `test_carbon_golden_regression.py` | Carbon regression snapshots |

Run validation only:
```bash
cd backend && python3 -m pytest tests/calculators/test_*_validation.py -q
```

Run regression only (when fixtures exist):
```bash
cd backend && python3 -m pytest tests/calculators/test_*_regression.py -q
```

## How to verify

```bash
cd backend && python3 -m pytest tests/calculators/ -q
cd backend && ruff check tests/calculators/ app/domain/energy/services/lcoe_engine.py
```
