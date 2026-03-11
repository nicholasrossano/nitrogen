"""
Carbon Emissions Calculation Engine

Pure-math service for computing emission reductions (tCO₂e).
Handles: baseline vs project comparison, leakage, ER schedules, sensitivity.

General formula (Gold Standard simplified cookstoves, biomass-to-biomass):
  ER_y = (B_y − P_y) × fNRB × EF_fuel
  where B_y and P_y are fuel consumption in tonnes/year.

Dual emission-factor pathways:
  1. Direct: fuel_kg × EF_kgCO₂/kg  (preferred, aligns with GS formula)
  2. NCV chain: fuel_kg × NCV_MJ/kg ÷ 1e6 × EF_tCO₂/TJ  (fallback)

fNRB is applied symmetrically to both baseline and project when
project_is_biomass is True (default for cookstoves).

Designed as methodology-agnostic with swappable "method packs".
v1 ships with a cookstoves pack aligned to Gold Standard patterns.
"""

from __future__ import annotations

import math
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
]

BASELINE_FUEL_OPTIONS = ["wood", "charcoal", "kerosene", "dung"]
PROJECT_FUEL_OPTIONS_BIOMASS = ["improved_biomass"]
PROJECT_FUEL_OPTIONS_SWITCH = ["lpg", "biogas", "ethanol"]
PROJECT_FUEL_OPTIONS_WATER = ["purified_water"]

METHOD_PACK_DEFAULTS: dict[str, dict[str, Any]] = {
    "cookstoves": {
        "baseline_fuel_type": "wood",
        "baseline_fuel_consumption_kg_yr": None,     # must be provided
        "baseline_ncv_mj_kg": 15.6,                  # IPCC default for air-dried wood
        "baseline_efficiency": 0.10,                  # typical 3-stone fire ~10%
        "project_fuel_type": "improved_biomass",
        "project_fuel_consumption_kg_yr": None,       # must be provided or derived
        "project_ncv_mj_kg": 15.6,
        "project_efficiency": 0.30,                   # typical improved stove ~30%
        "emission_factor_tco2_per_tj": 112.0,         # IPCC default for wood fuel
        "emission_factor_kgco2_per_kg": 1.747,        # IPCC: 15.6 MJ/kg × 112 tCO₂/TJ
        "fnrb": 0.70,                                 # conservative default
        "leakage_factor": 0.0,
        "fuel_savings_pct": None,                     # derive from efficiency ratio if absent
        "project_is_biomass": True,                   # improved stoves still burn biomass
        "devices_households": None,                   # must be provided
        "usage_rate": 1.0,                            # 100% usage by default
        "adoption_rate": 1.0,                         # 100% adoption year-1
        "crediting_period_years": 10,
    },
    "fuel_switch": {
        "baseline_fuel_type": "wood",
        "baseline_fuel_consumption_kg_yr": None,
        "baseline_ncv_mj_kg": 15.6,
        "baseline_efficiency": 0.10,
        "project_fuel_type": "lpg",
        "project_fuel_consumption_kg_yr": None,
        "project_ncv_mj_kg": 47.3,                   # LPG NCV
        "project_efficiency": 0.55,                   # typical LPG stove ~55%
        "emission_factor_tco2_per_tj": 112.0,
        "emission_factor_kgco2_per_kg": 1.747,        # baseline fuel EF (wood)
        "fnrb": 0.70,
        "leakage_factor": 0.10,                       # GS default 10% leakage for fuel switch
        "fuel_savings_pct": None,
        "project_is_biomass": False,                   # LPG/biogas/ethanol are non-biomass
        "devices_households": None,
        "usage_rate": 1.0,
        "adoption_rate": 1.0,
        "crediting_period_years": 10,
    },
    "safe_water": {
        "baseline_fuel_type": "wood",
        "baseline_fuel_consumption_kg_yr": None,       # fuel used to boil water
        "baseline_ncv_mj_kg": 15.6,
        "baseline_efficiency": 0.10,                   # open-fire boiling
        "project_fuel_type": "purified_water",
        "project_fuel_consumption_kg_yr": 0,           # no fuel — purification replaces boiling
        "project_ncv_mj_kg": 0,
        "project_efficiency": 1.0,
        "emission_factor_tco2_per_tj": 112.0,
        "emission_factor_kgco2_per_kg": 1.747,
        "fnrb": 0.70,
        "leakage_factor": 0.0,
        "fuel_savings_pct": 1.0,                       # 100% fuel saved — no boiling needed
        "project_is_biomass": False,
        "devices_households": None,
        "usage_rate": 1.0,
        "adoption_rate": 1.0,
        "crediting_period_years": 10,
    },
    "default": {
        "baseline_fuel_type": "unknown",
        "baseline_fuel_consumption_kg_yr": None,
        "baseline_ncv_mj_kg": 15.6,
        "baseline_efficiency": 0.15,
        "project_fuel_type": "unknown",
        "project_fuel_consumption_kg_yr": None,
        "project_ncv_mj_kg": 15.6,
        "project_efficiency": 0.30,
        "emission_factor_tco2_per_tj": 112.0,
        "emission_factor_kgco2_per_kg": None,
        "fnrb": 0.50,
        "leakage_factor": 0.0,
        "fuel_savings_pct": None,
        "project_is_biomass": True,
        "devices_households": None,
        "usage_rate": 1.0,
        "adoption_rate": 1.0,
        "crediting_period_years": 10,
    },
}


def _get_pack_defaults(method_pack: str | None) -> dict[str, Any]:
    key = (method_pack or "").lower().replace(" ", "_").replace("-", "_")
    return METHOD_PACK_DEFAULTS.get(key, METHOD_PACK_DEFAULTS["default"])


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

class CarbonEngine:
    """Stateless carbon emissions calculator."""

    @staticmethod
    def calculate(inputs: dict[str, CarbonInput]) -> CarbonResult:
        """Run a full ER calculation from a resolved input set.

        Produces annualized results (year 1) plus a multi-year ER schedule.
        """

        def _val(name: str, fallback: float = 0.0) -> float:
            inp = inputs.get(name)
            if inp is None or inp.value is None:
                return fallback
            return float(inp.value)

        def _str(name: str, fallback: str = "") -> str:
            inp = inputs.get(name)
            if inp is None or inp.value is None:
                return fallback
            return str(inp.value)

        devices = _val("devices_households")
        usage_rate = _val("usage_rate", 1.0)
        adoption_rate = _val("adoption_rate", 1.0)

        bl_fuel_kg = _val("baseline_fuel_consumption_kg_yr")
        bl_ncv = _val("baseline_ncv_mj_kg", 15.6)
        bl_eff = _val("baseline_efficiency", 0.10)

        pj_fuel_kg = _val("project_fuel_consumption_kg_yr")
        pj_ncv = _val("project_ncv_mj_kg", 15.6)
        pj_eff = _val("project_efficiency", 0.30)

        ef_tco2_per_tj = _val("emission_factor_tco2_per_tj", 112.0)
        ef_kgco2_per_kg = _val("emission_factor_kgco2_per_kg", 0.0)
        fnrb = _val("fnrb", 0.70)
        leakage_factor = _val("leakage_factor", 0.0)
        fuel_savings_pct = _val("fuel_savings_pct", 0.0)
        crediting_years = int(_val("crediting_period_years", 10))

        project_is_biomass = _str("project_is_biomass", "true").lower() in (
            "true", "yes", "1",
        )

        if devices <= 0:
            raise ValueError("Number of devices/households must be > 0")
        if crediting_years <= 0:
            raise ValueError("Crediting period must be > 0")

        # Project fuel derivation priority:
        #   1. Explicit project_fuel_consumption_kg_yr (already set)
        #   2. fuel_savings_pct: pj = bl × (1 − savings%)
        #   3. Efficiency ratio: pj = bl × (bl_eff / pj_eff)
        if pj_fuel_kg == 0 and bl_fuel_kg > 0:
            if fuel_savings_pct > 0:
                pj_fuel_kg = bl_fuel_kg * (1 - fuel_savings_pct)
            elif bl_eff > 0 and pj_eff > 0:
                pj_fuel_kg = bl_fuel_kg * (bl_eff / pj_eff)

        # Emission factor: prefer direct kgCO₂/kg pathway (GS-aligned),
        # fall back to NCV/TJ chain.
        if ef_kgco2_per_kg > 0:
            bl_tco2_per_device = bl_fuel_kg * ef_kgco2_per_kg / 1000
            pj_tco2_per_device = pj_fuel_kg * ef_kgco2_per_kg / 1000
        else:
            bl_tco2_per_device = (bl_fuel_kg * bl_ncv / 1_000_000) * ef_tco2_per_tj
            pj_tco2_per_device = (pj_fuel_kg * pj_ncv / 1_000_000) * ef_tco2_per_tj

        # fNRB applies symmetrically when project fuel is also biomass;
        # for non-biomass project fuels, all emissions are anthropogenic (fNRB = 1).
        fnrb_project = fnrb if project_is_biomass else 1.0

        assumption_count = sum(1 for i in inputs.values() if i.status == "assumed")

        schedule: list[ERScheduleRow] = []
        total_bl = 0.0
        total_pj = 0.0
        total_leak = 0.0

        for yr in range(1, crediting_years + 1):
            yr_adoption = min(adoption_rate * yr, 1.0) if adoption_rate < 1.0 else adoption_rate
            active_devices = int(devices * yr_adoption)

            yr_baseline = active_devices * usage_rate * bl_tco2_per_device * fnrb
            yr_project = active_devices * usage_rate * pj_tco2_per_device * fnrb_project
            yr_leakage = leakage_factor * max(yr_baseline - yr_project, 0)
            yr_net = yr_baseline - yr_project - yr_leakage

            schedule.append(ERScheduleRow(
                year=yr,
                devices_active=active_devices,
                baseline_emissions=yr_baseline,
                project_emissions=yr_project,
                leakage=yr_leakage,
                net_er=yr_net,
            ))

            total_bl += yr_baseline
            total_pj += yr_project
            total_leak += yr_leakage

        total_net = total_bl - total_pj - total_leak

        yr1 = schedule[0] if schedule else ERScheduleRow(1, 0, 0, 0, 0, 0)

        bl_abs = yr1.baseline_emissions
        denom = bl_abs if bl_abs > 0 else 1.0

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

    @staticmethod
    def run_sensitivity(
        inputs: dict[str, CarbonInput],
        params: list[str] | None = None,
        delta: float = 0.20,
        steps: int = 5,
    ) -> list[SensitivityPoint]:
        """Run sensitivity sweeps on selected parameters."""

        if params is None:
            params = ["usage_rate", "fnrb", "baseline_fuel_consumption_kg_yr"]

        label_map = {
            "usage_rate": "Usage Rate",
            "fnrb": "fNRB",
            "baseline_fuel_consumption_kg_yr": "Baseline Fuel Consumption",
            "project_fuel_consumption_kg_yr": "Project Fuel Consumption",
            "devices_households": "Devices / Households",
            "emission_factor_tco2_per_tj": "Emission Factor (tCO₂/TJ)",
            "emission_factor_kgco2_per_kg": "Emission Factor (kgCO₂/kg)",
            "fuel_savings_pct": "Fuel Savings %",
            "leakage_factor": "Leakage Factor",
            "baseline_efficiency": "Baseline Efficiency",
            "project_efficiency": "Project Efficiency",
            "adoption_rate": "Adoption Rate",
        }

        # Parameters that are fractions (0–1); test values must not exceed 1.0
        fraction_params = {
            "usage_rate", "fnrb", "fuel_savings_pct", "leakage_factor",
            "baseline_efficiency", "project_efficiency", "adoption_rate",
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

    @staticmethod
    def build_default_inputs(
        method_pack: str | None = None,
        known_values: dict[str, Any] | None = None,
    ) -> dict[str, CarbonInput]:
        """Build a full input set, filling gaps with method-pack defaults."""

        defaults = _get_pack_defaults(method_pack)
        known = known_values or {}
        pack_key = (method_pack or "").lower().replace(" ", "_").replace("-", "_")

        # Resolve project fuel options based on project type
        if pack_key == "fuel_switch":
            project_fuel_opts = PROJECT_FUEL_OPTIONS_SWITCH
        elif pack_key == "safe_water":
            project_fuel_opts = PROJECT_FUEL_OPTIONS_WATER
        else:
            project_fuel_opts = PROJECT_FUEL_OPTIONS_BIOMASS

        # field_name, label, default, unit, category, applies_to, field_type, options
        fields: list[tuple[str, str, Any, str, str, AppliesTo, str, list[str] | None]] = [
            ("method_pack", "Project Type", method_pack or "default", "", "general", "general", "text", None),
            ("devices_households", "Devices / Households", defaults.get("devices_households"), "units", "activity", "general", "number", None),
            ("usage_rate", "Usage Rate", defaults.get("usage_rate", 1.0), "", "activity", "general", "number", None),
            ("adoption_rate", "Adoption Rate", defaults.get("adoption_rate", 1.0), "", "activity", "general", "number", None),
            ("baseline_fuel_type", "Baseline Fuel Type", defaults.get("baseline_fuel_type"), "", "baseline", "baseline", "select", BASELINE_FUEL_OPTIONS),
            ("baseline_fuel_consumption_kg_yr", "Baseline Fuel Consumption", defaults.get("baseline_fuel_consumption_kg_yr"), "kg/yr per device", "baseline", "baseline", "number", None),
            ("baseline_ncv_mj_kg", "Baseline NCV", defaults.get("baseline_ncv_mj_kg", 15.6), "MJ/kg", "baseline", "baseline", "number", None),
            ("baseline_efficiency", "Baseline Efficiency", defaults.get("baseline_efficiency", 0.10), "", "baseline", "baseline", "number", None),
            ("project_fuel_type", "Project Fuel Type", defaults.get("project_fuel_type"), "", "project", "project", "select", project_fuel_opts),
            ("project_fuel_consumption_kg_yr", "Project Fuel Consumption", defaults.get("project_fuel_consumption_kg_yr"), "kg/yr per device", "project", "project", "number", None),
            ("project_ncv_mj_kg", "Project NCV", defaults.get("project_ncv_mj_kg", 15.6), "MJ/kg", "project", "project", "number", None),
            ("project_efficiency", "Project Efficiency", defaults.get("project_efficiency", 0.30), "", "project", "project", "number", None),
            ("fuel_savings_pct", "Fuel Savings %", defaults.get("fuel_savings_pct"), "", "project", "project", "number", None),
            ("emission_factor_tco2_per_tj", "Emission Factor (tCO₂/TJ)", defaults.get("emission_factor_tco2_per_tj", 112.0), "tCO₂/TJ", "emissions", "general", "number", None),
            ("emission_factor_kgco2_per_kg", "Emission Factor (kgCO₂/kg)", defaults.get("emission_factor_kgco2_per_kg"), "kgCO₂/kg", "emissions", "general", "number", None),
            ("fnrb", "fNRB", defaults.get("fnrb", 0.50), "", "emissions", "general", "number", None),
            ("project_is_biomass", "Project Uses Biomass", defaults.get("project_is_biomass", True), "", "project", "project", "boolean", None),
            ("leakage_factor", "Leakage Factor", defaults.get("leakage_factor", 0.0), "", "leakage", "leakage", "number", None),
            ("crediting_period_years", "Crediting Period", defaults.get("crediting_period_years", 10), "years", "general", "general", "number", None),
        ]

        result: dict[str, CarbonInput] = {}

        for field_name, label, default_val, unit, category, applies_to, ftype, opts in fields:
            if field_name in known and known[field_name] is not None:
                prov = ItemProvenance(
                    derivation=Derivation.PROVIDED,
                    rationale="Extracted from project conversation",
                ).model_dump()
                result[field_name] = CarbonInput(
                    field_name=field_name,
                    label=label,
                    value=known[field_name],
                    unit=unit,
                    source="chat",
                    status="inferred",
                    applies_to=applies_to,
                    category=category,
                    provenance=prov,
                    validation_status=ValidationStatus.UNCONFIRMED,
                    field_type=ftype,
                    options=opts,
                )
            elif default_val is not None:
                rationale = ""
                if field_name in defaults:
                    rationale = f"Default for {method_pack or 'generic'} methodology"
                prov = ItemProvenance(
                    derivation=Derivation.ASSUMED,
                    rationale=rationale,
                ).model_dump()
                result[field_name] = CarbonInput(
                    field_name=field_name,
                    label=label,
                    value=default_val,
                    unit=unit,
                    source="assumption",
                    status="assumed",
                    rationale=rationale,
                    applies_to=applies_to,
                    category=category,
                    provenance=prov,
                    validation_status=ValidationStatus.UNCONFIRMED,
                    field_type=ftype,
                    options=opts,
                )
            else:
                result[field_name] = CarbonInput(
                    field_name=field_name,
                    label=label,
                    value=None,
                    unit=unit,
                    source="assumption",
                    status="missing",
                    applies_to=applies_to,
                    category=category,
                    provenance=None,
                    validation_status=ValidationStatus.MISSING,
                    field_type=ftype,
                    options=opts,
                )

        return result

    @staticmethod
    def get_missing_essentials(inputs: dict[str, CarbonInput]) -> list[str]:
        essentials = [
            "devices_households",
            "baseline_fuel_consumption_kg_yr",
        ]
        return [f for f in essentials if not inputs.get(f) or inputs[f].value is None]

    @staticmethod
    def is_computable(inputs: dict[str, CarbonInput]) -> bool:
        """Check if we have enough to produce an ER estimate.

        Minimum: devices + baseline fuel consumption + a way to determine
        project fuel (explicit value, fuel_savings_pct, or efficiency ratio).
        """
        required_numeric = ["devices_households", "baseline_fuel_consumption_kg_yr"]
        for f in required_numeric:
            inp = inputs.get(f)
            if not inp or inp.value is None:
                return False
            if isinstance(inp.value, (int, float)) and inp.value <= 0:
                return False

        pj_inp = inputs.get("project_fuel_consumption_kg_yr")
        pj_has_value = pj_inp and pj_inp.value is not None and float(pj_inp.value) > 0
        if not pj_has_value:
            # fuel_savings_pct pathway
            savings_inp = inputs.get("fuel_savings_pct")
            if savings_inp and savings_inp.value is not None and float(savings_inp.value) > 0:
                return True
            # Efficiency-ratio fallback
            bl_eff = inputs.get("baseline_efficiency")
            pj_eff = inputs.get("project_efficiency")
            can_derive = (
                bl_eff and bl_eff.value and float(bl_eff.value) > 0
                and pj_eff and pj_eff.value and float(pj_eff.value) > 0
            )
            if not can_derive:
                return False

        return True

    @staticmethod
    def is_unruly(inputs: dict[str, CarbonInput]) -> bool:
        """Heuristic: recommend Excel export for long crediting periods."""
        inp = inputs.get("crediting_period_years")
        if inp and inp.value:
            return int(inp.value) > 15
        return False
