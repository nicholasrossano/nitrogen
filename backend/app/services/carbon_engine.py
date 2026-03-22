"""
Carbon Emissions Calculation Engine

Pure-math service for computing emission reductions (tCO₂e).
Seven methodology-specific calculation paths covering all Tier-1 avoidance types:

1. Cookstoves (GS TPDDTEC, biomass-to-biomass)
2. Fuel Switch (GS TPDDTEC, biomass-to-LPG/biogas/ethanol)
3. Safe Water (GS SWS v1.0)
4. Grid Renewable Energy (CDM AMS-I.D)
5. Solar Home Systems (CDM AMS-I.A, off-grid)
6. Biodigesters (GS Manure Mgmt v1.0 — AWMS + thermal displacement)
7. Efficient Lighting (CDM AMS-II.J)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from app.schemas.provenance import Derivation, ItemProvenance, ValidationStatus


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

InputStatus = Literal["confirmed", "inferred", "assumed", "missing"]
InputSource = Literal["chat", "doc", "user", "assumption"]
AppliesTo = Literal["baseline", "project", "leakage", "general"]


@dataclass
class CarbonInput:
    """A single input field with provenance tracking."""

    field_name: str
    label: str
    value: float | str | None
    unit: str
    source: InputSource
    status: InputStatus
    applies_to: AppliesTo = "general"
    notes: str = ""
    rationale: str = ""
    category: str = "general"
    provenance: dict | None = None
    validation_status: str = "unconfirmed"
    field_type: str = "number"  # "number", "text", "select", "boolean"
    options: list[str] | None = None  # for "select" fields

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "field_name": self.field_name,
            "label": self.label,
            "value": self.value,
            "unit": self.unit,
            "source": self.source,
            "status": self.status,
            "applies_to": self.applies_to,
            "notes": self.notes,
            "rationale": self.rationale,
            "category": self.category,
            "validation_status": self.validation_status,
            "field_type": self.field_type,
        }
        if self.provenance is not None:
            d["provenance"] = self.provenance
        if self.options is not None:
            d["options"] = self.options
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "CarbonInput":
        return cls(**{k: d[k] for k in cls.__dataclass_fields__ if k in d})


@dataclass
class ERScheduleRow:
    """One row in the emission-reduction schedule."""

    year: int
    devices_active: int
    baseline_emissions: float
    project_emissions: float
    leakage: float
    net_er: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "year": self.year,
            "devices_active": self.devices_active,
            "baseline_emissions": round(self.baseline_emissions, 4),
            "project_emissions": round(self.project_emissions, 4),
            "leakage": round(self.leakage, 4),
            "net_er": round(self.net_er, 4),
        }


@dataclass
class CarbonResult:
    """Top-level output of a carbon ER calculation."""

    baseline_emissions_tco2e: float
    project_emissions_tco2e: float
    leakage_tco2e: float
    net_er_tco2e: float

    period: str  # "annual" or "total"
    period_years: int

    baseline_share: float
    project_share: float
    leakage_share: float

    assumption_count: int
    quality_label: str  # "high", "moderate", "low"

    er_schedule: list[ERScheduleRow] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "baseline_emissions_tco2e": round(self.baseline_emissions_tco2e, 4),
            "project_emissions_tco2e": round(self.project_emissions_tco2e, 4),
            "leakage_tco2e": round(self.leakage_tco2e, 4),
            "net_er_tco2e": round(self.net_er_tco2e, 4),
            "period": self.period,
            "period_years": self.period_years,
            "baseline_share": round(self.baseline_share, 4),
            "project_share": round(self.project_share, 4),
            "leakage_share": round(self.leakage_share, 4),
            "assumption_count": self.assumption_count,
            "quality_label": self.quality_label,
            "er_schedule": [r.to_dict() for r in self.er_schedule],
        }


@dataclass
class SensitivityPoint:
    param_name: str
    param_label: str
    base_value: float
    test_value: float
    net_er: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "param_name": self.param_name,
            "param_label": self.param_label,
            "base_value": round(self.base_value, 4),
            "test_value": round(self.test_value, 4),
            "net_er": round(self.net_er, 4),
        }


# ---------------------------------------------------------------------------
# Project types & method-pack defaults
# ---------------------------------------------------------------------------

PROJECT_TYPE_OPTIONS: list[dict[str, str]] = [
    {"value": "cookstoves", "label": "Improved Cookstoves"},
    {"value": "fuel_switch", "label": "Fuel Switch (LPG / Biogas / Ethanol)"},
    {"value": "safe_water", "label": "Safe Water Supply"},
    {"value": "grid_renewable", "label": "Grid Renewable Energy"},
    {"value": "solar_home", "label": "Solar Home Systems (Off-Grid)"},
    {"value": "biodigester", "label": "Biodigesters (Manure Mgmt + Biogas)"},
    {"value": "efficient_lighting", "label": "Efficient Lighting"},
]

BASELINE_FUEL_OPTIONS = ["wood", "charcoal", "kerosene", "dung"]
PROJECT_FUEL_OPTIONS_BIOMASS = ["improved_biomass"]
PROJECT_FUEL_OPTIONS_SWITCH = ["lpg", "biogas", "ethanol"]
WATER_TECH_OPTIONS = ["ceramic_filter", "biosand_filter", "chlorination", "uv_treatment", "boiling_with_improved_stove"]
BASELINE_STOVE_OPTIONS = ["three_stone_fire", "conventional_stove", "improved_cookstove"]
RENEWABLE_TECH_OPTIONS = ["solar_pv", "wind", "small_hydro", "geothermal"]
BASELINE_LAMP_OPTIONS = ["incandescent", "cfl", "halogen"]
PROJECT_LAMP_OPTIONS = ["led", "cfl"]
LIVESTOCK_OPTIONS = ["dairy_cattle", "other_cattle", "swine", "poultry", "buffalo", "sheep", "goats"]
AWMS_OPTIONS = ["lagoon", "liquid_slurry", "solid_storage", "drylot", "pasture"]

# IPCC emission factors by fuel type
FUEL_EF_DEFAULTS: dict[str, dict[str, float]] = {
    "wood":     {"ef_co2_tco2_per_tj": 112.0, "ef_nonco2_tco2e_per_tj": 9.46, "ncv_mj_kg": 15.6, "ef_kgco2_per_kg": 1.747},
    "charcoal": {"ef_co2_tco2_per_tj": 165.22, "ef_nonco2_tco2e_per_tj": 44.83, "ncv_mj_kg": 29.5, "ef_kgco2_per_kg": 4.874},
    "kerosene": {"ef_co2_tco2_per_tj": 71.9, "ef_nonco2_tco2e_per_tj": 0.0, "ncv_mj_kg": 43.8, "ef_kgco2_per_kg": 3.149},
    "dung":     {"ef_co2_tco2_per_tj": 100.0, "ef_nonco2_tco2e_per_tj": 9.46, "ncv_mj_kg": 12.0, "ef_kgco2_per_kg": 1.200},
    "lpg":      {"ef_co2_tco2_per_tj": 63.1, "ef_nonco2_tco2e_per_tj": 0.0, "ncv_mj_kg": 47.3, "ef_kgco2_per_kg": 2.985},
    "biogas":   {"ef_co2_tco2_per_tj": 0.0, "ef_nonco2_tco2e_per_tj": 5.0, "ncv_mj_kg": 20.0, "ef_kgco2_per_kg": 0.0},
    "ethanol":  {"ef_co2_tco2_per_tj": 0.0, "ef_nonco2_tco2e_per_tj": 2.0, "ncv_mj_kg": 26.8, "ef_kgco2_per_kg": 0.0},
}

STOVE_EFFICIENCY_DEFAULTS: dict[str, float] = {
    "three_stone_fire": 0.10,
    "conventional_stove": 0.20,
    "improved_cookstove": 0.30,
}

# GS SWS v1.0: energy to obtain 1L of safe water after 5 min boiling (kJ/L)
SPECIFIC_ENERGY_KJ_PER_LITRE = 360.83

# GS SWS v1.0: default drinking water per person per day (litres) — WHO
WATER_PER_PERSON_DEFAULT = 4.0
WATER_PER_PERSON_CAP = 5.5


# IPCC Tier 1 CH₄ emission factors by livestock (kg CH₄/head/yr) — Table 10.14
LIVESTOCK_EF_CH4: dict[str, float] = {
    "dairy_cattle": 48.0, "other_cattle": 1.0, "swine": 7.0,
    "poultry": 0.02, "buffalo": 2.0, "sheep": 0.19, "goats": 0.13,
}

GWP_CH4_AR5 = 28.0


def _resolve_pack(method_pack: str | None) -> str:
    key = (method_pack or "").lower().replace(" ", "_").replace("-", "_")
    valid = {
        "cookstoves", "fuel_switch", "safe_water",
        "grid_renewable", "solar_home", "biodigester", "efficient_lighting",
    }
    return key if key in valid else "cookstoves"


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

class CarbonEngine:
    """Stateless carbon emissions calculator with per-methodology paths."""

    # -------------------------------------------------------------------
    #  Helpers
    # -------------------------------------------------------------------

    @staticmethod
    def _val(inputs: dict[str, CarbonInput], name: str, fallback: float = 0.0) -> float:
        inp = inputs.get(name)
        if inp is None or inp.value is None:
            return fallback
        return float(inp.value)

    @staticmethod
    def _str(inputs: dict[str, CarbonInput], name: str, fallback: str = "") -> str:
        inp = inputs.get(name)
        if inp is None or inp.value is None:
            return fallback
        return str(inp.value)

    @staticmethod
    def _build_result(
        schedule: list[ERScheduleRow],
        crediting_years: int,
        assumption_count: int,
    ) -> CarbonResult:
        yr1 = schedule[0] if schedule else ERScheduleRow(1, 0, 0, 0, 0, 0)
        denom = yr1.baseline_emissions if yr1.baseline_emissions > 0 else 1.0
        quality = "high"
        if assumption_count >= 5:
            quality = "low"
        elif assumption_count >= 2:
            quality = "moderate"
        return CarbonResult(
            baseline_emissions_tco2e=yr1.baseline_emissions,
            project_emissions_tco2e=yr1.project_emissions,
            leakage_tco2e=yr1.leakage,
            net_er_tco2e=yr1.net_er,
            period="annual",
            period_years=crediting_years,
            baseline_share=yr1.baseline_emissions / denom,
            project_share=yr1.project_emissions / denom,
            leakage_share=yr1.leakage / denom,
            assumption_count=assumption_count,
            quality_label=quality,
            er_schedule=schedule,
        )

    # -------------------------------------------------------------------
    #  Router
    # -------------------------------------------------------------------

    @staticmethod
    def calculate(inputs: dict[str, CarbonInput]) -> CarbonResult:
        pack = CarbonEngine._str(inputs, "method_pack", "cookstoves")
        pack = _resolve_pack(pack)
        _calculators = {
            "safe_water": CarbonEngine._calculate_safe_water,
            "fuel_switch": CarbonEngine._calculate_fuel_switch,
            "grid_renewable": CarbonEngine._calculate_grid_renewable,
            "solar_home": CarbonEngine._calculate_solar_home,
            "biodigester": CarbonEngine._calculate_biodigester,
            "efficient_lighting": CarbonEngine._calculate_efficient_lighting,
        }
        calc = _calculators.get(pack, CarbonEngine._calculate_cookstoves)
        return calc(inputs)

    # -------------------------------------------------------------------
    #  Cookstoves — GS TPDDTEC biomass-to-biomass
    # -------------------------------------------------------------------

    @staticmethod
    def _calculate_cookstoves(inputs: dict[str, CarbonInput]) -> CarbonResult:
        _v = CarbonEngine._val
        _s = CarbonEngine._str

        devices = _v(inputs, "devices_households")
        usage_rate = _v(inputs, "usage_rate", 1.0)
        adoption_rate = _v(inputs, "adoption_rate", 1.0)
        bl_fuel_kg = _v(inputs, "baseline_fuel_consumption_kg_yr")
        bl_ncv = _v(inputs, "baseline_ncv_mj_kg", 15.6)
        bl_eff = _v(inputs, "baseline_efficiency", 0.10)
        pj_fuel_kg = _v(inputs, "project_fuel_consumption_kg_yr")
        pj_ncv = _v(inputs, "project_ncv_mj_kg", 15.6)
        pj_eff = _v(inputs, "project_efficiency", 0.30)
        ef_tco2_per_tj = _v(inputs, "emission_factor_tco2_per_tj", 112.0)
        ef_kgco2_per_kg = _v(inputs, "emission_factor_kgco2_per_kg", 0.0)
        fnrb = _v(inputs, "fnrb", 0.70)
        leakage_factor = _v(inputs, "leakage_factor", 0.0)
        fuel_savings_pct = _v(inputs, "fuel_savings_pct", 0.0)
        crediting_years = int(_v(inputs, "crediting_period_years", 10))

        if devices <= 0:
            raise ValueError("Number of devices/households must be > 0")

        if pj_fuel_kg == 0 and bl_fuel_kg > 0:
            if fuel_savings_pct > 0:
                pj_fuel_kg = bl_fuel_kg * (1 - fuel_savings_pct)
            elif bl_eff > 0 and pj_eff > 0:
                pj_fuel_kg = bl_fuel_kg * (bl_eff / pj_eff)

        if ef_kgco2_per_kg > 0:
            bl_tco2 = bl_fuel_kg * ef_kgco2_per_kg / 1000
            pj_tco2 = pj_fuel_kg * ef_kgco2_per_kg / 1000
        else:
            bl_tco2 = (bl_fuel_kg * bl_ncv / 1e6) * ef_tco2_per_tj
            pj_tco2 = (pj_fuel_kg * pj_ncv / 1e6) * ef_tco2_per_tj

        assumption_count = sum(1 for i in inputs.values() if i.status == "assumed")
        schedule: list[ERScheduleRow] = []
        for yr in range(1, crediting_years + 1):
            yr_adopt = min(adoption_rate * yr, 1.0) if adoption_rate < 1.0 else adoption_rate
            active = int(devices * yr_adopt)
            yr_bl = active * usage_rate * bl_tco2 * fnrb
            yr_pj = active * usage_rate * pj_tco2 * fnrb  # same fNRB — biomass-to-biomass
            yr_lk = leakage_factor * max(yr_bl - yr_pj, 0)
            schedule.append(ERScheduleRow(yr, active, yr_bl, yr_pj, yr_lk, yr_bl - yr_pj - yr_lk))

        return CarbonEngine._build_result(schedule, crediting_years, assumption_count)

    # -------------------------------------------------------------------
    #  Fuel Switch — GS TPDDTEC biomass-to-LPG/biogas/ethanol
    #  Ref: TPDDTEC v3.1 Equations (3)+(5)+(7)
    # -------------------------------------------------------------------

    @staticmethod
    def _calculate_fuel_switch(inputs: dict[str, CarbonInput]) -> CarbonResult:
        _v = CarbonEngine._val

        devices = _v(inputs, "devices_households")
        usage_rate = _v(inputs, "usage_rate", 1.0)
        adoption_rate = _v(inputs, "adoption_rate", 1.0)
        bl_fuel_kg = _v(inputs, "baseline_fuel_consumption_kg_yr")
        bl_ef_co2 = _v(inputs, "bl_ef_co2_tco2_per_tj", 112.0)
        bl_ef_nonco2 = _v(inputs, "bl_ef_nonco2_tco2e_per_tj", 9.46)
        bl_ncv = _v(inputs, "baseline_ncv_mj_kg", 15.6)
        pj_fuel_kg = _v(inputs, "project_fuel_consumption_kg_yr")
        pj_ef_co2 = _v(inputs, "pj_ef_co2_tco2_per_tj", 63.1)
        pj_ef_nonco2 = _v(inputs, "pj_ef_nonco2_tco2e_per_tj", 0.0)
        pj_ncv = _v(inputs, "project_ncv_mj_kg", 47.3)
        fnrb = _v(inputs, "fnrb", 0.70)
        leakage_factor = _v(inputs, "leakage_factor", 0.10)
        crediting_years = int(_v(inputs, "crediting_period_years", 10))

        if devices <= 0:
            raise ValueError("Number of devices/households must be > 0")

        # TPDDTEC Eq (3): BE = B_bl × ((fNRB × EF_CO2) + EF_nonCO2) × NCV
        bl_tco2 = bl_fuel_kg * ((fnrb * bl_ef_co2) + bl_ef_nonco2) * (bl_ncv / 1e6)
        # TPDDTEC Eq (5): PE = B_pj × ((fNRB_pj × EF_pj_CO2) + EF_pj_nonCO2) × NCV_pj
        # For fossil project fuel, all CO2 is anthropogenic (no fNRB multiplier)
        pj_tco2 = pj_fuel_kg * (pj_ef_co2 + pj_ef_nonco2) * (pj_ncv / 1e6)

        assumption_count = sum(1 for i in inputs.values() if i.status == "assumed")
        schedule: list[ERScheduleRow] = []
        for yr in range(1, crediting_years + 1):
            yr_adopt = min(adoption_rate * yr, 1.0) if adoption_rate < 1.0 else adoption_rate
            active = int(devices * yr_adopt)
            yr_bl = active * usage_rate * bl_tco2
            yr_pj = active * usage_rate * pj_tco2
            yr_lk = leakage_factor * max(yr_bl - yr_pj, 0)
            schedule.append(ERScheduleRow(yr, active, yr_bl, yr_pj, yr_lk, yr_bl - yr_pj - yr_lk))

        return CarbonEngine._build_result(schedule, crediting_years, assumption_count)

    # -------------------------------------------------------------------
    #  Safe Water — GS SWS v1.0
    #  BE = EF_b × (1 − C_b − X_cleanboil) × Q_y × M_q
    #  EF_b = (SE_w / 1e9) × (fNRB × EF_CO2 + EF_nonCO2) × NCV_baseline
    #  SE_w = 360.83 / η_wb
    # -------------------------------------------------------------------

    @staticmethod
    def _calculate_safe_water(inputs: dict[str, CarbonInput]) -> CarbonResult:
        _v = CarbonEngine._val

        people_served = _v(inputs, "people_served")
        water_per_person_day = _v(inputs, "water_per_person_day", WATER_PER_PERSON_DEFAULT)
        water_per_person_day = min(water_per_person_day, WATER_PER_PERSON_CAP)
        usage_rate = _v(inputs, "usage_rate", 1.0)
        adoption_rate = _v(inputs, "adoption_rate", 1.0)
        operational_days = _v(inputs, "operational_days_yr", 347)

        baseline_stove_eff = _v(inputs, "baseline_stove_efficiency", 0.10)
        bl_ef_co2 = _v(inputs, "bl_ef_co2_tco2_per_tj", 112.0)
        bl_ef_nonco2 = _v(inputs, "bl_ef_nonco2_tco2e_per_tj", 9.46)
        _v(inputs, "baseline_ncv_mj_kg", 15.6)
        fnrb = _v(inputs, "fnrb", 0.70)

        prop_already_safe = _v(inputs, "proportion_already_safe", 0.0)
        prop_still_boiling = _v(inputs, "proportion_still_boiling", 0.0)
        water_quality_modifier = _v(inputs, "water_quality_modifier", 1.0)

        pj_electricity_kwh_yr = _v(inputs, "project_electricity_kwh_yr", 0.0)
        pj_grid_ef = _v(inputs, "project_grid_ef_tco2_per_kwh", 0.001)
        pj_tdl = _v(inputs, "project_tdl_pct", 0.20)

        leakage_factor = _v(inputs, "leakage_factor", 0.05)
        crediting_years = int(_v(inputs, "crediting_period_years", 10))

        if people_served <= 0:
            raise ValueError("Number of people served must be > 0")

        # GS SWS Eq (2): SE_w = 360.83 / η
        specific_energy = SPECIFIC_ENERGY_KJ_PER_LITRE / baseline_stove_eff

        # GS SWS Eq (1): EF_b = SE_w × ((fNRB × EF_CO2) + EF_nonCO2) × NCV / 1e9
        # Units: (kJ/L) × (tCO₂/TJ) × (MJ/kg) → need consistent units.
        # SE_w is kJ/L. NCV is MJ/kg. EF is tCO₂/TJ.
        # The formal eq divides by 10^9 to convert kJ→TJ alignment.
        # More precisely: EF_b (tCO₂e/L) = SE_w(kJ/L) / (η already embedded) ×
        #   Σ(x_f × (EF_CO2×fNRB + EF_nonCO2)) / 10^9
        # Simplified for single-fuel baseline:
        ef_b_tco2_per_litre = (specific_energy / 1e9) * ((fnrb * bl_ef_co2) + bl_ef_nonco2)

        # GS SWS Eq (3): BE = EF_b × (1 − C_b − X_cleanboil) × Q_y × M_q
        behaviour_factor = max(1.0 - prop_already_safe - prop_still_boiling, 0.0)

        # GS SWS Eq (8–10): PE = electricity + fossil fuel of project tech
        pe_electricity = pj_electricity_kwh_yr * pj_grid_ef * (1 + pj_tdl)

        assumption_count = sum(1 for i in inputs.values() if i.status == "assumed")
        schedule: list[ERScheduleRow] = []
        for yr in range(1, crediting_years + 1):
            yr_adopt = min(adoption_rate * yr, 1.0) if adoption_rate < 1.0 else adoption_rate
            active_people = int(people_served * yr_adopt)

            q_y = active_people * water_per_person_day * operational_days * usage_rate
            yr_bl = ef_b_tco2_per_litre * behaviour_factor * q_y * water_quality_modifier
            yr_pj = pe_electricity * yr_adopt
            yr_lk = leakage_factor * max(yr_bl - yr_pj, 0)
            yr_net = yr_bl - yr_pj - yr_lk

            schedule.append(ERScheduleRow(yr, active_people, yr_bl, yr_pj, yr_lk, yr_net))

        return CarbonEngine._build_result(schedule, crediting_years, assumption_count)

    # -------------------------------------------------------------------
    #  Grid Renewable Energy — AMS-I.D
    #  ER_y = EGPJ_y × EF_grid × (1 + TD_losses)
    #  EGPJ_y = capacity_kW × CF × 8760 × (1−aux) × (1−degradation)^(y−1) / 1000  (MWh)
    # -------------------------------------------------------------------

    @staticmethod
    def _calculate_grid_renewable(inputs: dict[str, CarbonInput]) -> CarbonResult:
        _v = CarbonEngine._val

        capacity_kw = _v(inputs, "installed_capacity_kw")
        cf = _v(inputs, "capacity_factor", 0.18)
        degradation = _v(inputs, "annual_degradation", 0.005)
        grid_ef = _v(inputs, "grid_emission_factor")
        aux = _v(inputs, "auxiliary_consumption_pct", 0.0)
        td_losses = _v(inputs, "td_losses_pct", 0.0)
        leakage_factor = _v(inputs, "leakage_factor", 0.0)
        crediting_years = int(_v(inputs, "crediting_period_years", 10))

        if capacity_kw <= 0:
            raise ValueError("Installed capacity must be > 0")
        if grid_ef <= 0:
            raise ValueError("Grid emission factor must be > 0")

        assumption_count = sum(1 for i in inputs.values() if i.status == "assumed")
        schedule: list[ERScheduleRow] = []
        for yr in range(1, crediting_years + 1):
            gen_mwh = capacity_kw * cf * 8760 * (1 - aux) * ((1 - degradation) ** (yr - 1)) / 1000
            yr_bl = gen_mwh * grid_ef * (1 + td_losses)
            yr_pj = 0.0
            yr_lk = leakage_factor * yr_bl
            schedule.append(ERScheduleRow(yr, 1, yr_bl, yr_pj, yr_lk, yr_bl - yr_pj - yr_lk))

        return CarbonEngine._build_result(schedule, crediting_years, assumption_count)

    # -------------------------------------------------------------------
    #  Solar Home Systems — AMS-I.A (off-grid)
    #  Two approaches: (a) from system output, (b) from displaced fuel
    #  We use displaced-fuel approach when fuel data is provided,
    #  otherwise estimate from PV output.
    #  ER_y = N × kWh_displaced × EF_fuel  (approach a)
    #  or ER_y = N × fuel_L × EF_tco2_per_L (approach b)
    # -------------------------------------------------------------------

    @staticmethod
    def _calculate_solar_home(inputs: dict[str, CarbonInput]) -> CarbonResult:
        _v = CarbonEngine._val

        num_systems = _v(inputs, "num_systems")
        system_wp = _v(inputs, "system_capacity_wp", 50)
        peak_sun = _v(inputs, "peak_sun_hours", 4.5)
        sys_eff = _v(inputs, "system_efficiency", 0.70)
        degradation = _v(inputs, "annual_degradation", 0.01)
        usage_rate = _v(inputs, "usage_rate", 1.0)
        bl_fuel_l_yr = _v(inputs, "baseline_fuel_consumption_l_yr", 0.0)
        bl_fuel_ef = _v(inputs, "baseline_fuel_ef_tco2_per_litre", 0.00249)
        leakage_factor = _v(inputs, "leakage_factor", 0.0)
        crediting_years = int(_v(inputs, "crediting_period_years", 10))

        if num_systems <= 0:
            raise ValueError("Number of systems must be > 0")

        assumption_count = sum(1 for i in inputs.values() if i.status == "assumed")
        schedule: list[ERScheduleRow] = []
        for yr in range(1, crediting_years + 1):
            deg_factor = (1 - degradation) ** (yr - 1)
            if bl_fuel_l_yr > 0:
                yr_bl = num_systems * usage_rate * bl_fuel_l_yr * bl_fuel_ef * deg_factor
            else:
                kwh_per_system = system_wp * peak_sun * 365 * sys_eff / 1000
                yr_bl = num_systems * usage_rate * kwh_per_system * bl_fuel_ef * deg_factor
            yr_pj = 0.0
            yr_lk = leakage_factor * yr_bl
            schedule.append(ERScheduleRow(yr, int(num_systems), yr_bl, yr_pj, yr_lk, yr_bl - yr_pj - yr_lk))

        return CarbonEngine._build_result(schedule, crediting_years, assumption_count)

    # -------------------------------------------------------------------
    #  Biodigesters — GS Manure Mgmt v1.0
    #  Two components summed:
    #  (A) AWMS: BE_AWMS = (tech_days/365) × GWP_CH4 × UF × U × Σ(N × EF) / 1000
    #      PE_phys = 10% × methane potential
    #  (B) Thermal: same as TPDDTEC fuel displacement with 5% leakage default
    # -------------------------------------------------------------------

    @staticmethod
    def _calculate_biodigester(inputs: dict[str, CarbonInput]) -> CarbonResult:
        _v = CarbonEngine._val
        _s = CarbonEngine._str

        num_digesters = _v(inputs, "num_digesters")
        usage_rate = _v(inputs, "usage_rate", 0.90)
        adoption_rate = _v(inputs, "adoption_rate", 1.0)
        livestock_type = _s(inputs, "livestock_type", "dairy_cattle")
        num_animals = _v(inputs, "num_animals")
        uf_b = _v(inputs, "uf_b", 0.89)

        bl_fuel_kg = _v(inputs, "baseline_fuel_consumption_kg_yr", 0.0)
        bl_ncv = _v(inputs, "baseline_ncv_mj_kg", 15.6)
        bl_ef_co2 = _v(inputs, "bl_ef_co2_tco2_per_tj", 112.0)
        bl_ef_nonco2 = _v(inputs, "bl_ef_nonco2_tco2e_per_tj", 9.46)
        fnrb = _v(inputs, "fnrb", 0.70)
        _v(inputs, "baseline_stove_efficiency", 0.10)
        leakage_thermal = _v(inputs, "leakage_thermal_factor", 0.05)
        crediting_years = int(_v(inputs, "crediting_period_years", 10))

        if num_digesters <= 0:
            raise ValueError("Number of biodigesters must be > 0")

        ef_ch4 = LIVESTOCK_EF_CH4.get(livestock_type, 1.0)

        # (A) AWMS Tier 1: BE = (tech_days/365) × GWP × UF × U × N_animals × EF_ch4 / 1000
        # Per-digester per year (tech_days = 365 → ratio=1)
        be_awms_per_digester = GWP_CH4_AR5 * uf_b * usage_rate * num_animals * ef_ch4 / 1000

        # PE physical leakage: 10% of methane potential
        pe_phys_per_digester = 0.10 * GWP_CH4_AR5 * num_animals * ef_ch4 / 1000

        # (B) Thermal fuel displacement per digester
        # Baseline specific emissions (tCO₂e per kg fuel per year, same as TPDDTEC)
        bl_thermal_tco2 = bl_fuel_kg * ((fnrb * bl_ef_co2) + bl_ef_nonco2) * (bl_ncv / 1e6)
        # Project thermal = 0 (biogas replaces cooking fuel entirely)
        pj_thermal_tco2 = 0.0

        assumption_count = sum(1 for i in inputs.values() if i.status == "assumed")
        schedule: list[ERScheduleRow] = []
        for yr in range(1, crediting_years + 1):
            yr_adopt = min(adoption_rate * yr, 1.0) if adoption_rate < 1.0 else adoption_rate
            active = int(num_digesters * yr_adopt)

            yr_bl = active * (be_awms_per_digester + bl_thermal_tco2)
            yr_pj = active * pe_phys_per_digester
            yr_thermal_lk = leakage_thermal * max(bl_thermal_tco2 * active - pj_thermal_tco2 * active, 0)
            yr_lk = yr_thermal_lk
            schedule.append(ERScheduleRow(yr, active, yr_bl, yr_pj, yr_lk, yr_bl - yr_pj - yr_lk))

        return CarbonEngine._build_result(schedule, crediting_years, assumption_count)

    # -------------------------------------------------------------------
    #  Efficient Lighting — AMS-II.J
    #  NES_y = Σ Q × (1−LFR_y) × ES × 1/(1−TD) × NTG
    #  ES = (P_BL − P_PJ) × O × 365 / 1000  (kWh/lamp/yr)
    #  LFR_y = 0.5 × y × X / L  where X = O × 365
    #  ER_y = NES_y × EF_grid / 1000  (tCO₂)
    # -------------------------------------------------------------------

    @staticmethod
    def _calculate_efficient_lighting(inputs: dict[str, CarbonInput]) -> CarbonResult:
        _v = CarbonEngine._val

        num_lamps = _v(inputs, "num_lamps")
        bl_watt = _v(inputs, "baseline_wattage", 60)
        pj_watt = _v(inputs, "project_wattage", 9)
        operating_h = min(_v(inputs, "operating_hours_per_day", 3.5), 5.0)
        rated_life_h = _v(inputs, "rated_lamp_life_hours", 25000)
        grid_ef = _v(inputs, "grid_emission_factor")
        td_pct = _v(inputs, "td_losses_pct", 0.10)
        ntg = _v(inputs, "ntg_factor", 0.95)
        crediting_years = int(_v(inputs, "crediting_period_years", 10))

        if num_lamps <= 0:
            raise ValueError("Number of lamps must be > 0")
        if grid_ef <= 0:
            raise ValueError("Grid emission factor must be > 0")

        # AMS-II.J Eq 2: ES per lamp (kWh/yr)
        es = (bl_watt - pj_watt) * operating_h * 365 / 1000
        # Annual operating hours
        x_hours = operating_h * 365

        assumption_count = sum(1 for i in inputs.values() if i.status == "assumed")
        schedule: list[ERScheduleRow] = []
        for yr in range(1, crediting_years + 1):
            # AMS-II.J Eq 3: Lamp Failure Rate
            lfr = min(0.5 * yr * x_hours / rated_life_h, 1.0) if rated_life_h > 0 else 0.0
            # AMS-II.J Eq 1: Net Electricity Savings (kWh)
            nes = num_lamps * (1 - lfr) * es * (1 / (1 - td_pct)) * ntg
            # ER in tCO₂ (EF is tCO₂/MWh, NES is kWh → divide by 1000)
            yr_bl = nes * grid_ef / 1000
            yr_pj = 0.0
            yr_lk = 0.0
            effective_lamps = int(num_lamps * (1 - lfr))
            schedule.append(ERScheduleRow(yr, effective_lamps, yr_bl, yr_pj, yr_lk, yr_bl - yr_pj - yr_lk))

        return CarbonEngine._build_result(schedule, crediting_years, assumption_count)

    # -------------------------------------------------------------------
    #  Sensitivity
    # -------------------------------------------------------------------

    @staticmethod
    def run_sensitivity(
        inputs: dict[str, CarbonInput],
        params: list[str] | None = None,
        delta: float = 0.20,
        steps: int = 5,
    ) -> list[SensitivityPoint]:
        if params is None:
            pack = CarbonEngine._str(inputs, "method_pack", "cookstoves")
            pack = _resolve_pack(pack)
            _default_sens: dict[str, list[str]] = {
                "safe_water": ["people_served", "fnrb", "water_per_person_day"],
                "fuel_switch": ["usage_rate", "fnrb", "baseline_fuel_consumption_kg_yr"],
                "grid_renewable": ["installed_capacity_kw", "capacity_factor", "grid_emission_factor"],
                "solar_home": ["num_systems", "peak_sun_hours", "baseline_fuel_ef_tco2_per_litre"],
                "biodigester": ["num_digesters", "num_animals", "fnrb"],
                "efficient_lighting": ["num_lamps", "grid_emission_factor", "operating_hours_per_day"],
            }
            params = _default_sens.get(pack, ["usage_rate", "fnrb", "baseline_fuel_consumption_kg_yr"])

        label_map = {
            "usage_rate": "Usage Rate",
            "fnrb": "fNRB",
            "baseline_fuel_consumption_kg_yr": "Baseline Fuel Consumption",
            "project_fuel_consumption_kg_yr": "Project Fuel Consumption",
            "devices_households": "Devices / Households",
            "people_served": "People Served",
            "water_per_person_day": "Water per Person (L/day)",
            "water_quality_modifier": "Water Quality Modifier",
            "proportion_already_safe": "Already With Safe Water",
            "proportion_still_boiling": "Still Boiling After Project",
            "baseline_stove_efficiency": "Baseline Stove Efficiency",
            "bl_ef_co2_tco2_per_tj": "Baseline CO₂ EF (tCO₂/TJ)",
            "pj_ef_co2_tco2_per_tj": "Project CO₂ EF (tCO₂/TJ)",
            "emission_factor_tco2_per_tj": "Emission Factor (tCO₂/TJ)",
            "emission_factor_kgco2_per_kg": "Emission Factor (kgCO₂/kg)",
            "fuel_savings_pct": "Fuel Savings %",
            "leakage_factor": "Leakage Factor",
            "baseline_efficiency": "Baseline Efficiency",
            "project_efficiency": "Project Efficiency",
            "adoption_rate": "Adoption Rate",
            "installed_capacity_kw": "Installed Capacity (kW)",
            "capacity_factor": "Capacity Factor",
            "grid_emission_factor": "Grid Emission Factor",
            "num_systems": "Number of SHS",
            "peak_sun_hours": "Peak Sun Hours",
            "baseline_fuel_ef_tco2_per_litre": "Fuel EF (tCO₂/L)",
            "num_digesters": "Number of Digesters",
            "num_animals": "Animals per Digester",
            "num_lamps": "Number of Lamps",
            "operating_hours_per_day": "Operating Hours/Day",
            "baseline_wattage": "Baseline Wattage",
            "project_wattage": "Project Wattage",
        }

        fraction_params = {
            "usage_rate", "fnrb", "fuel_savings_pct", "leakage_factor",
            "baseline_efficiency", "project_efficiency", "adoption_rate",
            "proportion_already_safe", "proportion_still_boiling",
            "water_quality_modifier", "baseline_stove_efficiency",
            "capacity_factor", "system_efficiency", "auxiliary_consumption_pct",
            "td_losses_pct", "ntg_factor", "leakage_thermal_factor",
        }

        points: list[SensitivityPoint] = []
        for param in params:
            base_input = inputs.get(param)
            if not base_input or base_input.value is None:
                continue
            base_val = float(base_input.value)
            if base_val == 0:
                continue

            low = base_val * (1 - delta)
            high = base_val * (1 + delta)
            if param in fraction_params:
                high = min(high, 1.0)
            total_steps = 2 * steps + 1
            step_size = (high - low) / max(total_steps - 1, 1)

            for i in range(total_steps):
                test_val = low + step_size * i
                if test_val < 0:
                    continue
                modified = dict(inputs)
                modified[param] = CarbonInput(
                    field_name=base_input.field_name,
                    label=base_input.label,
                    value=test_val,
                    unit=base_input.unit,
                    source=base_input.source,
                    status=base_input.status,
                    applies_to=base_input.applies_to,
                    notes=base_input.notes,
                    category=base_input.category,
                )
                try:
                    result = CarbonEngine.calculate(modified)
                    points.append(SensitivityPoint(
                        param_name=param,
                        param_label=label_map.get(param, param),
                        base_value=base_val,
                        test_value=test_val,
                        net_er=result.net_er_tco2e,
                    ))
                except (ValueError, ZeroDivisionError):
                    continue

        return points

    # -------------------------------------------------------------------
    #  Input builder — per-pack field definitions
    # -------------------------------------------------------------------

    @staticmethod
    def build_default_inputs(
        method_pack: str | None = None,
        known_values: dict[str, Any] | None = None,
    ) -> dict[str, CarbonInput]:
        """Build a full input set with genuinely different fields per methodology."""

        pack = _resolve_pack(method_pack)
        known = known_values or {}

        _field_builders = {
            "safe_water": CarbonEngine._safe_water_fields,
            "fuel_switch": CarbonEngine._fuel_switch_fields,
            "grid_renewable": CarbonEngine._grid_renewable_fields,
            "solar_home": CarbonEngine._solar_home_fields,
            "biodigester": CarbonEngine._biodigester_fields,
            "efficient_lighting": CarbonEngine._efficient_lighting_fields,
        }
        builder = _field_builders.get(pack, CarbonEngine._cookstoves_fields)
        fields = builder(pack)

        result: dict[str, CarbonInput] = {}
        for field_name, label, default_val, unit, category, applies_to, ftype, opts in fields:
            if field_name in known and known[field_name] is not None:
                prov = ItemProvenance(
                    derivation=Derivation.PROVIDED,
                    rationale="Extracted from project conversation",
                ).model_dump()
                result[field_name] = CarbonInput(
                    field_name=field_name, label=label, value=known[field_name],
                    unit=unit, source="chat", status="inferred",
                    applies_to=applies_to, category=category,
                    provenance=prov, validation_status=ValidationStatus.UNCONFIRMED,
                    field_type=ftype, options=opts,
                )
            elif default_val is not None:
                rationale = f"GS {pack} methodology default"
                prov = ItemProvenance(
                    derivation=Derivation.ASSUMED, rationale=rationale,
                ).model_dump()
                result[field_name] = CarbonInput(
                    field_name=field_name, label=label, value=default_val,
                    unit=unit, source="assumption", status="assumed",
                    rationale=rationale, applies_to=applies_to, category=category,
                    provenance=prov, validation_status=ValidationStatus.UNCONFIRMED,
                    field_type=ftype, options=opts,
                )
            else:
                result[field_name] = CarbonInput(
                    field_name=field_name, label=label, value=None,
                    unit=unit, source="assumption", status="missing",
                    applies_to=applies_to, category=category,
                    provenance=None, validation_status=ValidationStatus.MISSING,
                    field_type=ftype, options=opts,
                )
        return result

    # -- Per-pack field definitions --
    # Tuple: (field_name, label, default, unit, category, applies_to, field_type, options)

    @staticmethod
    def _cookstoves_fields(pack: str) -> list[tuple[str, str, Any, str, str, AppliesTo, str, list[str] | None]]:
        return [
            ("method_pack", "Project Type", pack, "", "general", "general", "text", None),
            ("devices_households", "Devices / Households", None, "units", "activity", "general", "number", None),
            ("usage_rate", "Usage Rate", 1.0, "", "activity", "general", "number", None),
            ("adoption_rate", "Adoption Rate", 1.0, "", "activity", "general", "number", None),
            ("baseline_fuel_type", "Baseline Fuel Type", "wood", "", "baseline", "baseline", "select", BASELINE_FUEL_OPTIONS),
            ("baseline_fuel_consumption_kg_yr", "Baseline Fuel Consumption", None, "kg/yr per device", "baseline", "baseline", "number", None),
            ("baseline_ncv_mj_kg", "Baseline NCV", 15.6, "MJ/kg", "baseline", "baseline", "number", None),
            ("baseline_efficiency", "Baseline Stove Efficiency", 0.10, "", "baseline", "baseline", "number", None),
            ("project_fuel_type", "Project Fuel Type", "improved_biomass", "", "project", "project", "select", PROJECT_FUEL_OPTIONS_BIOMASS),
            ("project_fuel_consumption_kg_yr", "Project Fuel Consumption", None, "kg/yr per device", "project", "project", "number", None),
            ("project_ncv_mj_kg", "Project NCV", 15.6, "MJ/kg", "project", "project", "number", None),
            ("project_efficiency", "Project Stove Efficiency", 0.30, "", "project", "project", "number", None),
            ("fuel_savings_pct", "Fuel Savings %", None, "", "project", "project", "number", None),
            ("emission_factor_tco2_per_tj", "Emission Factor (tCO₂/TJ)", 112.0, "tCO₂/TJ", "emissions", "general", "number", None),
            ("emission_factor_kgco2_per_kg", "Emission Factor (kgCO₂/kg)", 1.747, "kgCO₂/kg", "emissions", "general", "number", None),
            ("fnrb", "fNRB", 0.70, "", "emissions", "general", "number", None),
            ("leakage_factor", "Leakage Factor", 0.0, "", "leakage", "leakage", "number", None),
            ("crediting_period_years", "Crediting Period", 10, "years", "general", "general", "number", None),
        ]

    @staticmethod
    def _fuel_switch_fields(pack: str) -> list[tuple[str, str, Any, str, str, AppliesTo, str, list[str] | None]]:
        return [
            ("method_pack", "Project Type", pack, "", "general", "general", "text", None),
            ("devices_households", "Devices / Households", None, "units", "activity", "general", "number", None),
            ("usage_rate", "Usage Rate", 1.0, "", "activity", "general", "number", None),
            ("adoption_rate", "Adoption Rate", 1.0, "", "activity", "general", "number", None),
            # Baseline (biomass)
            ("baseline_fuel_type", "Baseline Fuel Type", "wood", "", "baseline", "baseline", "select", BASELINE_FUEL_OPTIONS),
            ("baseline_fuel_consumption_kg_yr", "Baseline Fuel Consumption", None, "kg/yr per HH", "baseline", "baseline", "number", None),
            ("baseline_ncv_mj_kg", "Baseline NCV", 15.6, "MJ/kg", "baseline", "baseline", "number", None),
            ("bl_ef_co2_tco2_per_tj", "Baseline CO₂ EF", 112.0, "tCO₂/TJ", "baseline", "baseline", "number", None),
            ("bl_ef_nonco2_tco2e_per_tj", "Baseline Non-CO₂ EF", 9.46, "tCO₂e/TJ", "baseline", "baseline", "number", None),
            # Project (non-biomass fossil)
            ("project_fuel_type", "Project Fuel Type", "lpg", "", "project", "project", "select", PROJECT_FUEL_OPTIONS_SWITCH),
            ("project_fuel_consumption_kg_yr", "Project Fuel Consumption", None, "kg/yr per HH", "project", "project", "number", None),
            ("project_ncv_mj_kg", "Project NCV", 47.3, "MJ/kg", "project", "project", "number", None),
            ("pj_ef_co2_tco2_per_tj", "Project CO₂ EF", 63.1, "tCO₂/TJ", "project", "project", "number", None),
            ("pj_ef_nonco2_tco2e_per_tj", "Project Non-CO₂ EF", 0.0, "tCO₂e/TJ", "project", "project", "number", None),
            # Shared
            ("fnrb", "fNRB (baseline only)", 0.70, "", "emissions", "general", "number", None),
            ("leakage_factor", "Leakage Factor", 0.10, "", "leakage", "leakage", "number", None),
            ("crediting_period_years", "Crediting Period", 10, "years", "general", "general", "number", None),
        ]

    @staticmethod
    def _safe_water_fields(pack: str) -> list[tuple[str, str, Any, str, str, AppliesTo, str, list[str] | None]]:
        return [
            ("method_pack", "Project Type", pack, "", "general", "general", "text", None),
            # Population & usage (GS SWS Eq 5–7)
            ("people_served", "People Served", None, "people", "activity", "general", "number", None),
            ("water_per_person_day", "Water per Person per Day", WATER_PER_PERSON_DEFAULT, "L/day", "activity", "general", "number", None),
            ("usage_rate", "Usage Rate", 1.0, "", "activity", "general", "number", None),
            ("adoption_rate", "Adoption Rate", 1.0, "", "activity", "general", "number", None),
            ("operational_days_yr", "Operational Days per Year", 347, "days", "activity", "general", "number", None),
            # Water treatment technology
            ("water_treatment_type", "Water Treatment Technology", "ceramic_filter", "", "project", "project", "select", WATER_TECH_OPTIONS),
            # Baseline boiling scenario (GS SWS Eq 1–2)
            ("baseline_fuel_type", "Baseline Fuel (for boiling)", "wood", "", "baseline", "baseline", "select", BASELINE_FUEL_OPTIONS),
            ("baseline_stove_type", "Baseline Stove Type", "three_stone_fire", "", "baseline", "baseline", "select", BASELINE_STOVE_OPTIONS),
            ("baseline_stove_efficiency", "Baseline Stove Efficiency", 0.10, "", "baseline", "baseline", "number", None),
            ("baseline_ncv_mj_kg", "Baseline Fuel NCV", 15.6, "MJ/kg", "baseline", "baseline", "number", None),
            ("bl_ef_co2_tco2_per_tj", "Baseline CO₂ EF", 112.0, "tCO₂/TJ", "baseline", "baseline", "number", None),
            ("bl_ef_nonco2_tco2e_per_tj", "Baseline Non-CO₂ EF (AR5)", 9.46, "tCO₂e/TJ", "baseline", "baseline", "number", None),
            ("fnrb", "fNRB", 0.70, "", "emissions", "general", "number", None),
            # Behaviour adjustments (GS SWS Eq 3)
            ("proportion_already_safe", "Already With Safe Water (C_b)", 0.0, "", "adjustments", "general", "number", None),
            ("proportion_still_boiling", "Still Boiling After Project (X_cleanboil)", 0.0, "", "adjustments", "general", "number", None),
            ("water_quality_modifier", "Water Quality Modifier (M_q)", 1.0, "", "adjustments", "general", "number", None),
            # Project emissions (GS SWS Eq 8–10)
            ("project_electricity_kwh_yr", "Project Electricity Use", 0.0, "kWh/yr", "project", "project", "number", None),
            ("project_grid_ef_tco2_per_kwh", "Grid Emission Factor", 0.001, "tCO₂/kWh", "project", "project", "number", None),
            ("project_tdl_pct", "T&D Losses", 0.20, "", "project", "project", "number", None),
            # Leakage & period
            ("leakage_factor", "Leakage Deduction", 0.05, "", "leakage", "leakage", "number", None),
            ("crediting_period_years", "Crediting Period", 10, "years", "general", "general", "number", None),
        ]

    # -- Grid Renewable Energy (AMS-I.D) --
    # ER_y = EGPJ_y × EF_grid   where EGPJ = capacity × CF × 8760 × (1-degradation)^(y-1)

    @staticmethod
    def _grid_renewable_fields(pack: str) -> list[tuple[str, str, Any, str, str, AppliesTo, str, list[str] | None]]:
        return [
            ("method_pack", "Project Type", pack, "", "general", "general", "text", None),
            ("renewable_tech", "Renewable Technology", "solar_pv", "", "project", "project", "select", RENEWABLE_TECH_OPTIONS),
            ("installed_capacity_kw", "Installed Capacity", None, "kW", "activity", "general", "number", None),
            ("capacity_factor", "Capacity Factor", 0.18, "", "activity", "general", "number", None),
            ("annual_degradation", "Annual Degradation", 0.005, "", "activity", "general", "number", None),
            ("grid_emission_factor", "Grid Emission Factor", None, "tCO₂/MWh", "baseline", "baseline", "number", None),
            ("auxiliary_consumption_pct", "Auxiliary / Parasitic Consumption", 0.0, "", "project", "project", "number", None),
            ("td_losses_pct", "T&D Losses (Avoided)", 0.0, "", "baseline", "baseline", "number", None),
            ("leakage_factor", "Leakage Factor", 0.0, "", "leakage", "leakage", "number", None),
            ("crediting_period_years", "Crediting Period", 10, "years", "general", "general", "number", None),
        ]

    # -- Solar Home Systems / Off-Grid (AMS-I.A) --
    # ER = N_systems × kWh_per_system_yr × EF_displaced
    # Displaces kerosene/diesel; EF from fuel, not grid.

    @staticmethod
    def _solar_home_fields(pack: str) -> list[tuple[str, str, Any, str, str, AppliesTo, str, list[str] | None]]:
        return [
            ("method_pack", "Project Type", pack, "", "general", "general", "text", None),
            ("num_systems", "Number of SHS Deployed", None, "units", "activity", "general", "number", None),
            ("system_capacity_wp", "System Capacity", 50, "Wp", "activity", "general", "number", None),
            ("peak_sun_hours", "Peak Sun Hours", 4.5, "h/day", "activity", "general", "number", None),
            ("system_efficiency", "System Efficiency (battery+inverter)", 0.70, "", "activity", "general", "number", None),
            ("annual_degradation", "Annual Degradation", 0.01, "", "activity", "general", "number", None),
            ("usage_rate", "Usage Rate", 1.0, "", "activity", "general", "number", None),
            ("baseline_fuel_type", "Baseline Fuel Displaced", "kerosene", "", "baseline", "baseline", "select", ["kerosene", "diesel"]),
            ("baseline_fuel_consumption_l_yr", "Baseline Fuel Consumption", None, "L/yr per HH", "baseline", "baseline", "number", None),
            ("baseline_fuel_ef_tco2_per_litre", "Baseline Fuel EF", 0.00249, "tCO₂/L", "baseline", "baseline", "number", None),
            ("leakage_factor", "Leakage Factor", 0.0, "", "leakage", "leakage", "number", None),
            ("crediting_period_years", "Crediting Period", 10, "years", "general", "general", "number", None),
        ]

    # -- Biodigesters (GS Manure Mgmt v1.0) --
    # Two components: AWMS (methane avoidance) + Thermal (fuel displacement)
    # AWMS Tier 1: BE = (N_tech_days/365) × GWP_CH4 × UF × U × Σ(N_LT × EF_LT) / 1000
    # Thermal: same as TPDDTEC fuel displacement
    # PE_physical_leakage = 10% of max methane potential

    @staticmethod
    def _biodigester_fields(pack: str) -> list[tuple[str, str, Any, str, str, AppliesTo, str, list[str] | None]]:
        return [
            ("method_pack", "Project Type", pack, "", "general", "general", "text", None),
            ("num_digesters", "Number of Biodigesters", None, "units", "activity", "general", "number", None),
            ("usage_rate", "Usage Rate", 0.90, "", "activity", "general", "number", None),
            ("adoption_rate", "Adoption Rate", 1.0, "", "activity", "general", "number", None),
            # Livestock / manure (AWMS)
            ("livestock_type", "Livestock Type", "dairy_cattle", "", "baseline", "baseline", "select", LIVESTOCK_OPTIONS),
            ("num_animals", "Number of Animals per Digester", None, "head", "baseline", "baseline", "number", None),
            ("awms_baseline_type", "Baseline Manure Mgmt System", "lagoon", "", "baseline", "baseline", "select", AWMS_OPTIONS),
            ("uf_b", "Model Uncertainty Factor (UF_b)", 0.89, "", "baseline", "baseline", "number", None),
            # Thermal (fuel displacement)
            ("baseline_fuel_type", "Baseline Fuel (cooking)", "wood", "", "baseline", "baseline", "select", BASELINE_FUEL_OPTIONS),
            ("baseline_fuel_consumption_kg_yr", "Baseline Fuel per HH", None, "kg/yr", "baseline", "baseline", "number", None),
            ("baseline_ncv_mj_kg", "Baseline NCV", 15.6, "MJ/kg", "baseline", "baseline", "number", None),
            ("bl_ef_co2_tco2_per_tj", "Baseline CO₂ EF", 112.0, "tCO₂/TJ", "baseline", "baseline", "number", None),
            ("bl_ef_nonco2_tco2e_per_tj", "Baseline Non-CO₂ EF", 9.46, "tCO₂e/TJ", "baseline", "baseline", "number", None),
            ("fnrb", "fNRB (baseline biomass only)", 0.70, "", "emissions", "general", "number", None),
            ("baseline_stove_efficiency", "Baseline Stove Efficiency", 0.10, "", "baseline", "baseline", "number", None),
            # Leakage
            ("leakage_thermal_factor", "Thermal Leakage Deduction", 0.05, "", "leakage", "leakage", "number", None),
            ("crediting_period_years", "Crediting Period", 10, "years", "general", "general", "number", None),
        ]

    # -- Efficient Lighting (AMS-II.J) --
    # NES_y = Σ Q_PJ_i × (1−LFR_i_y) × ES_i × 1/(1−TD) × NTG
    # ES_i = (P_BL − P_PJ) × O_i × 365 / 1000  (kWh/lamp/yr)
    # ER_y = NES_y × EF_grid / 1000  (tCO₂)

    @staticmethod
    def _efficient_lighting_fields(pack: str) -> list[tuple[str, str, Any, str, str, AppliesTo, str, list[str] | None]]:
        return [
            ("method_pack", "Project Type", pack, "", "general", "general", "text", None),
            ("num_lamps", "Number of Project Lamps", None, "units", "activity", "general", "number", None),
            ("baseline_lamp_type", "Baseline Lamp Type", "incandescent", "", "baseline", "baseline", "select", BASELINE_LAMP_OPTIONS),
            ("baseline_wattage", "Baseline Lamp Wattage", 60, "W", "baseline", "baseline", "number", None),
            ("project_lamp_type", "Project Lamp Type", "led", "", "project", "project", "select", PROJECT_LAMP_OPTIONS),
            ("project_wattage", "Project Lamp Wattage", 9, "W", "project", "project", "number", None),
            ("operating_hours_per_day", "Daily Operating Hours", 3.5, "h/day", "activity", "general", "number", None),
            ("rated_lamp_life_hours", "Rated Lamp Life", 25000, "hours", "project", "project", "number", None),
            ("grid_emission_factor", "Grid Emission Factor", None, "tCO₂/MWh", "baseline", "baseline", "number", None),
            ("td_losses_pct", "T&D Losses", 0.10, "", "baseline", "baseline", "number", None),
            ("ntg_factor", "Net-to-Gross Factor (NTG)", 0.95, "", "adjustments", "general", "number", None),
            ("crediting_period_years", "Crediting Period", 10, "years", "general", "general", "number", None),
        ]

    # -------------------------------------------------------------------
    #  Computability checks — pack-aware
    # -------------------------------------------------------------------

    _ESSENTIAL_FIELDS: dict[str, list[str]] = {
        "safe_water": ["people_served"],
        "fuel_switch": ["devices_households", "baseline_fuel_consumption_kg_yr", "project_fuel_consumption_kg_yr"],
        "grid_renewable": ["installed_capacity_kw", "grid_emission_factor"],
        "solar_home": ["num_systems"],
        "biodigester": ["num_digesters", "num_animals"],
        "efficient_lighting": ["num_lamps", "grid_emission_factor"],
        "cookstoves": ["devices_households", "baseline_fuel_consumption_kg_yr"],
    }

    @staticmethod
    def get_missing_essentials(inputs: dict[str, CarbonInput]) -> list[str]:
        pack = CarbonEngine._str(inputs, "method_pack", "cookstoves")
        pack = _resolve_pack(pack)
        essentials = CarbonEngine._ESSENTIAL_FIELDS.get(pack, CarbonEngine._ESSENTIAL_FIELDS["cookstoves"])
        return [f for f in essentials if not inputs.get(f) or inputs[f].value is None]

    @staticmethod
    def is_computable(inputs: dict[str, CarbonInput]) -> bool:
        pack = CarbonEngine._str(inputs, "method_pack", "cookstoves")
        pack = _resolve_pack(pack)
        essentials = CarbonEngine._ESSENTIAL_FIELDS.get(pack, CarbonEngine._ESSENTIAL_FIELDS["cookstoves"])

        for f in essentials:
            inp = inputs.get(f)
            if not inp or inp.value is None:
                return False
            if isinstance(inp.value, (int, float)) and inp.value <= 0:
                return False

        if pack == "cookstoves":
            pj_inp = inputs.get("project_fuel_consumption_kg_yr")
            if pj_inp and pj_inp.value is not None and float(pj_inp.value) > 0:
                return True
            savings_inp = inputs.get("fuel_savings_pct")
            if savings_inp and savings_inp.value is not None and float(savings_inp.value) > 0:
                return True
            bl_eff = inputs.get("baseline_efficiency")
            pj_eff = inputs.get("project_efficiency")
            return bool(
                bl_eff and bl_eff.value and float(bl_eff.value) > 0
                and pj_eff and pj_eff.value and float(pj_eff.value) > 0
            )

        return True

    @staticmethod
    def is_unruly(inputs: dict[str, CarbonInput]) -> bool:
        inp = inputs.get("crediting_period_years")
        if inp and inp.value:
            return int(inp.value) > 15
        return False
