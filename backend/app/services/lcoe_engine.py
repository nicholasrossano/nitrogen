"""
LCOE Calculation Engine

Pure-math service for computing Levelized Cost of Energy.
Handles: standard LCOE, cash flow tables, sensitivity analysis.

LCOE = NPV(total costs) / NPV(total energy produced)

Uses a discounted cash flow approach where both costs and energy
are discounted back to year 0 at the given discount rate.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from app.schemas.provenance import Derivation, ItemProvenance, ValidationStatus


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

InputStatus = Literal["validated", "inferred", "assumed", "missing"]
InputSource = Literal["chat", "doc", "user", "assumption"]


@dataclass
class LCOEInput:
    """A single input field with provenance tracking."""
    field_name: str
    label: str
    value: float | str | None
    unit: str
    source: InputSource
    status: InputStatus
    notes: str = ""
    rationale: str = ""
    category: str = "general"
    field_type: str = "number"  # "number" | "text" | "select"
    options: list[str] | None = None
    provenance: dict | None = None
    validation_status: str = "unconfirmed"

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "field_name": self.field_name,
            "label": self.label,
            "value": self.value,
            "unit": self.unit,
            "source": self.source,
            "status": self.status,
            "notes": self.notes,
            "rationale": self.rationale,
            "category": self.category,
            "field_type": self.field_type,
            "validation_status": self.validation_status,
        }
        if self.options is not None:
            d["options"] = self.options
        if self.provenance is not None:
            d["provenance"] = self.provenance
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "LCOEInput":
        payload = {k: d[k] for k in cls.__dataclass_fields__ if k in d}
        if payload.get("status") == "confirmed":
            payload["status"] = "validated"
        return cls(**payload)


@dataclass
class CashFlowRow:
    year: int
    capex: float
    opex: float
    fuel: float
    replacement: float
    total_cost: float
    energy_kwh: float
    discount_factor: float
    discounted_cost: float
    discounted_energy: float

    def to_dict(self) -> dict[str, Any]:
        return {k: round(v, 4) if isinstance(v, float) else v for k, v in self.__dict__.items()}


@dataclass
class LCOEResult:
    lcoe: float  # $/kWh (or local currency)
    currency: str
    npv_total_costs: float
    npv_total_energy: float

    capex_share: float  # fraction of NPV costs
    opex_share: float
    fuel_share: float
    replacement_share: float

    lifetime_energy_kwh: float
    assumption_count: int
    quality_label: str  # "high", "moderate", "low"

    cash_flows: list[CashFlowRow] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "lcoe": round(self.lcoe, 6),
            "currency": self.currency,
            "npv_total_costs": round(self.npv_total_costs, 2),
            "npv_total_energy": round(self.npv_total_energy, 2),
            "capex_share": round(self.capex_share, 4),
            "opex_share": round(self.opex_share, 4),
            "fuel_share": round(self.fuel_share, 4),
            "replacement_share": round(self.replacement_share, 4),
            "lifetime_energy_kwh": round(self.lifetime_energy_kwh, 2),
            "assumption_count": self.assumption_count,
            "quality_label": self.quality_label,
            "cash_flows": [r.to_dict() for r in self.cash_flows],
        }


@dataclass
class SensitivityPoint:
    param_name: str
    param_label: str
    base_value: float
    test_value: float
    lcoe: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "param_name": self.param_name,
            "param_label": self.param_label,
            "base_value": round(self.base_value, 4),
            "test_value": round(self.test_value, 4),
            "lcoe": round(self.lcoe, 6),
        }


# ---------------------------------------------------------------------------
# Default assumptions by technology
# ---------------------------------------------------------------------------

TECH_DEFAULTS: dict[str, dict[str, Any]] = {
    "solar_pv": {
        "capacity_factor": 0.18,
        "degradation_rate": 0.005,
        "project_life_years": 25,
        "opex_per_kw_year": 15,
        "discount_rate": 0.08,
        "construction_years": 1,
    },
    "wind": {
        "capacity_factor": 0.30,
        "degradation_rate": 0.002,
        "project_life_years": 25,
        "opex_per_kw_year": 30,
        "discount_rate": 0.08,
        "construction_years": 2,
    },
    "battery": {
        "capacity_factor": 0.15,
        "degradation_rate": 0.02,
        "project_life_years": 15,
        "opex_per_kw_year": 10,
        "discount_rate": 0.08,
        "construction_years": 1,
    },
    "mini_grid": {
        "capacity_factor": 0.20,
        "degradation_rate": 0.005,
        "project_life_years": 20,
        "opex_per_kw_year": 25,
        "discount_rate": 0.10,
        "construction_years": 1,
    },
    "clean_cooking": {
        "capacity_factor": 0.30,
        "degradation_rate": 0.01,
        "project_life_years": 10,
        "opex_per_kw_year": 5,
        "discount_rate": 0.10,
        "construction_years": 0,
    },
    "default": {
        "capacity_factor": 0.20,
        "degradation_rate": 0.005,
        "project_life_years": 25,
        "opex_per_kw_year": 20,
        "discount_rate": 0.08,
        "construction_years": 1,
    },
}

TECH_TYPE_OPTIONS = [k for k in TECH_DEFAULTS.keys() if k != "default"]


def _get_defaults(tech_type: str | None) -> dict[str, Any]:
    key = (tech_type or "").lower().replace(" ", "_").replace("-", "_")
    return TECH_DEFAULTS.get(key, TECH_DEFAULTS["default"])


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

class LCOEEngine:
    """Stateless LCOE calculator."""

    @staticmethod
    def calculate(inputs: dict[str, LCOEInput]) -> LCOEResult:
        """Run a full LCOE calculation from a resolved input set.

        Required keys in inputs dict (by field_name):
          - net_capacity_kw
          - capacity_factor
          - total_capex
          - annual_opex
          - discount_rate
          - project_life_years

        Optional:
          - degradation_rate
          - annual_fuel_cost
          - construction_years
          - currency
          - annual_replacement_cost
        """
        def _val(name: str, fallback: float = 0.0) -> float:
            inp = inputs.get(name)
            if inp is None or inp.value is None:
                return fallback
            return float(inp.value)

        capacity_kw = _val("net_capacity_kw")
        capacity_factor = _val("capacity_factor")
        total_capex = _val("total_capex")
        annual_opex = _val("annual_opex")
        discount_rate = _val("discount_rate")
        project_life = int(_val("project_life_years", 25))
        degradation = _val("degradation_rate", 0.005)
        annual_fuel = _val("annual_fuel_cost", 0.0)
        construction_years = int(_val("construction_years", 0))
        annual_replacement = _val("annual_replacement_cost", 0.0)
        currency = "USD"
        if "currency" in inputs and inputs["currency"].value:
            currency = str(inputs["currency"].value)

        if capacity_kw <= 0 or capacity_factor <= 0:
            raise ValueError("Net capacity and capacity factor must be > 0")
        if project_life <= 0:
            raise ValueError("Project life must be > 0")

        base_annual_energy = capacity_kw * capacity_factor * 8760  # kWh/yr
        assumption_count = sum(1 for i in inputs.values() if i.status == "assumed")

        # Spread capex over construction period (simple equal split)
        capex_per_year = total_capex / max(construction_years, 1)

        rows: list[CashFlowRow] = []
        npv_cost = 0.0
        npv_energy = 0.0
        sum_capex_disc = 0.0
        sum_opex_disc = 0.0
        sum_fuel_disc = 0.0
        sum_repl_disc = 0.0

        total_years = construction_years + project_life

        for year in range(total_years):
            df = 1.0 / ((1 + discount_rate) ** year) if discount_rate > 0 else 1.0

            is_construction = year < construction_years
            operational_year = year - construction_years  # 0-based operational year

            if is_construction:
                capex = capex_per_year
                opex = 0.0
                fuel = 0.0
                replacement = 0.0
                energy = 0.0
            else:
                capex = 0.0
                opex = annual_opex
                fuel = annual_fuel
                replacement = annual_replacement
                deg_factor = (1 - degradation) ** operational_year
                energy = base_annual_energy * deg_factor

            total_cost = capex + opex + fuel + replacement
            disc_cost = total_cost * df
            disc_energy = energy * df

            npv_cost += disc_cost
            npv_energy += disc_energy
            sum_capex_disc += capex * df
            sum_opex_disc += opex * df
            sum_fuel_disc += fuel * df
            sum_repl_disc += replacement * df

            rows.append(CashFlowRow(
                year=year,
                capex=round(capex, 2),
                opex=round(opex, 2),
                fuel=round(fuel, 2),
                replacement=round(replacement, 2),
                total_cost=round(total_cost, 2),
                energy_kwh=round(energy, 2),
                discount_factor=round(df, 6),
                discounted_cost=round(disc_cost, 2),
                discounted_energy=round(disc_energy, 2),
            ))

        if npv_energy == 0:
            raise ValueError("Total discounted energy is zero — cannot compute LCOE")

        lcoe = npv_cost / npv_energy

        quality = "high"
        if assumption_count >= 5:
            quality = "low"
        elif assumption_count >= 2:
            quality = "moderate"

        return LCOEResult(
            lcoe=lcoe,
            currency=currency,
            npv_total_costs=npv_cost,
            npv_total_energy=npv_energy,
            capex_share=sum_capex_disc / npv_cost if npv_cost else 0,
            opex_share=sum_opex_disc / npv_cost if npv_cost else 0,
            fuel_share=sum_fuel_disc / npv_cost if npv_cost else 0,
            replacement_share=sum_repl_disc / npv_cost if npv_cost else 0,
            lifetime_energy_kwh=sum(r.energy_kwh for r in rows),
            assumption_count=assumption_count,
            quality_label=quality,
            cash_flows=rows,
        )

    @staticmethod
    def run_sensitivity(
        inputs: dict[str, LCOEInput],
        params: list[str] | None = None,
        delta: float = 0.20,
        steps: int = 5,
    ) -> list[SensitivityPoint]:
        """Run sensitivity sweeps on selected parameters.

        Args:
            params: field_names to sweep. Defaults to discount_rate, total_capex, capacity_factor.
            delta: fractional range (0.2 = ±20%).
            steps: number of points per side (total = 2*steps + 1 per param).
        """
        if params is None:
            params = ["discount_rate", "total_capex", "capacity_factor"]

        label_map = {
            "discount_rate": "Discount Rate",
            "total_capex": "Total CAPEX",
            "capacity_factor": "Capacity Factor",
            "annual_opex": "Annual O&M",
            "annual_fuel_cost": "Annual Fuel Cost",
            "project_life_years": "Project Lifetime",
        }

        # Parameters that are fractions (0–1); test values must not exceed 1.0
        fraction_params = {"discount_rate", "capacity_factor"}

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
                if test_val <= 0:
                    continue

                modified = dict(inputs)
                modified[param] = LCOEInput(
                    field_name=base_input.field_name,
                    label=base_input.label,
                    value=test_val,
                    unit=base_input.unit,
                    source=base_input.source,
                    status=base_input.status,
                    notes=base_input.notes,
                    category=base_input.category,
                )

                try:
                    result = LCOEEngine.calculate(modified)
                    points.append(SensitivityPoint(
                        param_name=param,
                        param_label=label_map.get(param, param),
                        base_value=base_val,
                        test_value=test_val,
                        lcoe=result.lcoe,
                    ))
                except (ValueError, ZeroDivisionError):
                    continue

        return points

    @staticmethod
    def build_default_inputs(
        tech_type: str | None = None,
        known_values: dict[str, Any] | None = None,
    ) -> dict[str, LCOEInput]:
        """Build a full input set, filling gaps with technology-appropriate defaults.

        known_values: dict of field_name → value (from chat extraction / docs).
        Returns dict keyed by field_name.
        """
        defaults = _get_defaults(tech_type)
        known = known_values or {}

        fields = [
            ("technology_type", "Technology Type", tech_type or "default", "", "project", "select", TECH_TYPE_OPTIONS),
            ("net_capacity_kw", "Net Capacity", None, "kW", "energy", "number", None),
            ("capacity_factor", "Capacity Factor", defaults["capacity_factor"], "", "energy", "number", None),
            ("degradation_rate", "Annual Degradation", defaults["degradation_rate"], "%/yr", "energy", "number", None),
            ("total_capex", "Total CAPEX", None, "USD", "costs", "number", None),
            ("annual_opex", "Annual O&M", None, "USD/yr", "costs", "number", None),
            ("annual_fuel_cost", "Annual Fuel Cost", 0.0, "USD/yr", "costs", "number", None),
            ("annual_replacement_cost", "Replacement Cost", 0.0, "USD/yr", "costs", "number", None),
            ("discount_rate", "Discount Rate (WACC)", defaults["discount_rate"], "", "finance", "number", None),
            ("project_life_years", "Project Lifetime", defaults["project_life_years"], "years", "finance", "number", None),
            ("construction_years", "Construction Period", defaults["construction_years"], "years", "timing", "number", None),
            ("currency", "Currency", "USD", "", "general", "text", None),
        ]

        result: dict[str, LCOEInput] = {}

        for field_name, label, default_val, unit, category, field_type, options in fields:
            if field_name in known and known[field_name] is not None:
                prov = ItemProvenance(
                    derivation=Derivation.PROVIDED,
                    rationale="Extracted from project conversation",
                ).model_dump()
                result[field_name] = LCOEInput(
                    field_name=field_name,
                    label=label,
                    value=known[field_name],
                    unit=unit,
                    source="chat",
                    status="inferred",
                    category=category,
                    field_type=field_type,
                    options=options,
                    provenance=prov,
                    validation_status=ValidationStatus.UNCONFIRMED,
                )
            elif default_val is not None:
                rationale = ""
                if field_name in defaults:
                    rationale = f"Typical value for {tech_type or 'generic'} projects"
                prov = ItemProvenance(
                    derivation=Derivation.ASSUMED,
                    rationale=rationale,
                ).model_dump()
                result[field_name] = LCOEInput(
                    field_name=field_name,
                    label=label,
                    value=default_val,
                    unit=unit,
                    source="assumption",
                    status="assumed",
                    rationale=rationale,
                    category=category,
                    field_type=field_type,
                    options=options,
                    provenance=prov,
                    validation_status=ValidationStatus.UNCONFIRMED,
                )
            else:
                result[field_name] = LCOEInput(
                    field_name=field_name,
                    label=label,
                    value=None,
                    unit=unit,
                    source="assumption",
                    status="missing",
                    category=category,
                    field_type=field_type,
                    options=options,
                    provenance=None,
                    validation_status=ValidationStatus.MISSING,
                )

        return result

    @staticmethod
    def get_missing_essentials(inputs: dict[str, LCOEInput]) -> list[str]:
        """Return field_names of essential inputs that are still missing."""
        essentials = ["net_capacity_kw", "total_capex", "annual_opex"]
        return [f for f in essentials if not inputs.get(f) or inputs[f].value is None]

    @staticmethod
    def is_computable(inputs: dict[str, LCOEInput]) -> bool:
        """Check if we have enough to produce an LCOE."""
        required = ["net_capacity_kw", "capacity_factor", "total_capex",
                     "annual_opex", "discount_rate", "project_life_years"]
        for f in required:
            inp = inputs.get(f)
            if not inp or inp.value is None:
                return False
            if isinstance(inp.value, (int, float)) and inp.value <= 0:
                return False
        return True

    @staticmethod
    def is_unruly(inputs: dict[str, LCOEInput]) -> bool:
        """Heuristic: should we recommend Excel export instead of inline tables?"""
        life = 0
        inp = inputs.get("project_life_years")
        if inp and inp.value:
            life = int(inp.value)
        return life > 30
