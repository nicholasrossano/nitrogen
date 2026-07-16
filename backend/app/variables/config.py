from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


ValueType = Literal["number", "string", "boolean", "percent", "currency", "text"]


@dataclass(frozen=True)
class VariableDefinition:
    key: str
    label: str
    value_type: ValueType
    unit: str | None = None
    aliases: list[str] = field(default_factory=list)
    examples: list[str] = field(default_factory=list)
    used_in_assessments: list[str] = field(default_factory=list)
    required_for_assessments: list[str] = field(default_factory=list)
    assessment_field_keys: dict[str, list[str]] = field(default_factory=dict)
    common: bool = False


COMMON_VARIABLES: list[VariableDefinition] = [
    VariableDefinition(
        key="project_location",
        label="Project location",
        value_type="string",
        aliases=["location", "site", "geography", "country", "region"],
        examples=["Project location = Kenya", "Site: San Pedro, Belize"],
        common=True,
    ),
    VariableDefinition(
        key="system_size_kw",
        label="System size",
        value_type="number",
        unit="kW",
        aliases=["system size", "installed capacity", "project capacity", "capacity"],
        examples=["System size = 50 kW", "Installed capacity: 120 kW"],
        used_in_assessments=["solar_estimate", "lcoe_model", "carbon_model"],
        required_for_assessments=["solar_estimate", "lcoe_model"],
        assessment_field_keys={
            "solar_estimate": ["system_capacity"],
            "lcoe_model": ["net_capacity_kw"],
            "carbon_model": ["installed_capacity_kw", "system_capacity_wp"],
        },
        common=True,
    ),
    VariableDefinition(
        key="baseline_energy_source",
        label="Baseline energy source",
        value_type="string",
        aliases=["baseline source", "baseline fuel", "baseline energy", "current fuel"],
        examples=["Baseline energy source = diesel generator"],
        used_in_assessments=["carbon_model", "lcoe_model"],
        required_for_assessments=["carbon_model"],
        assessment_field_keys={"carbon_model": ["baseline_fuel_type"], "lcoe_model": ["annual_fuel_cost"]},
        common=True,
    ),
    VariableDefinition(
        key="operator_model",
        label="Operator model",
        value_type="string",
        aliases=["operator", "ownership model", "operating model", "management model"],
        examples=["Operator model = community cooperative"],
        used_in_assessments=["stakeholder_assessment", "implementation_plan"],
        common=True,
    ),
    VariableDefinition(
        key="collection_rate",
        label="Collection rate",
        value_type="percent",
        unit="%",
        aliases=["collection rate", "payment collection", "revenue collection"],
        examples=["Collection rate = 85%"],
        used_in_assessments=["lcoe_model"],
        common=True,
    ),
]


MODULE_VARIABLES: list[VariableDefinition] = [
    VariableDefinition(
        key="total_capex",
        label="Total CAPEX",
        value_type="currency",
        aliases=["capex", "capital cost", "capital expenditure", "total capital cost"],
        examples=["CAPEX = $180,000", "Total capital expenditure: USD 250,000"],
        used_in_assessments=["lcoe_model"],
        required_for_assessments=["lcoe_model"],
        assessment_field_keys={"lcoe_model": ["total_capex"]},
    ),
    VariableDefinition(
        key="annual_opex",
        label="Annual OPEX",
        value_type="currency",
        aliases=["opex", "annual o&m", "operations cost", "maintenance cost"],
        examples=["Annual OPEX = $12,000"],
        used_in_assessments=["lcoe_model"],
        required_for_assessments=["lcoe_model"],
        assessment_field_keys={"lcoe_model": ["annual_opex"]},
    ),
    VariableDefinition(
        key="capacity_factor",
        label="Capacity factor",
        value_type="percent",
        aliases=["capacity factor", "plant factor", "utilization factor"],
        examples=["Capacity factor = 22%"],
        used_in_assessments=["lcoe_model", "carbon_model"],
        assessment_field_keys={"lcoe_model": ["capacity_factor"], "carbon_model": ["capacity_factor"]},
    ),
    VariableDefinition(
        key="discount_rate",
        label="Discount rate",
        value_type="percent",
        aliases=["discount rate", "wacc", "cost of capital"],
        examples=["Discount rate = 8%"],
        used_in_assessments=["lcoe_model"],
        assessment_field_keys={"lcoe_model": ["discount_rate"]},
    ),
    VariableDefinition(
        key="project_life_years",
        label="Project lifetime",
        value_type="number",
        unit="years",
        aliases=["project life", "lifetime", "operational life", "asset life"],
        examples=["Project lifetime = 20 years"],
        used_in_assessments=["lcoe_model"],
        assessment_field_keys={"lcoe_model": ["project_life_years"]},
    ),
    VariableDefinition(
        key="devices_households",
        label="Devices or households",
        value_type="number",
        aliases=["households", "devices", "stoves", "systems distributed"],
        examples=["Devices/households = 10,000"],
        used_in_assessments=["carbon_model"],
        required_for_assessments=["carbon_model"],
        assessment_field_keys={"carbon_model": ["devices_households"]},
    ),
    VariableDefinition(
        key="baseline_fuel_consumption_kg_yr",
        label="Baseline fuel consumption",
        value_type="number",
        unit="kg/year",
        aliases=["baseline fuel consumption", "annual fuel use", "firewood consumption"],
        examples=["Baseline fuel consumption = 1,200 kg/year"],
        used_in_assessments=["carbon_model"],
        required_for_assessments=["carbon_model"],
        assessment_field_keys={"carbon_model": ["baseline_fuel_consumption_kg_yr"]},
    ),
    VariableDefinition(
        key="usage_rate",
        label="Usage rate",
        value_type="percent",
        aliases=["usage rate", "continued use", "utilization rate"],
        examples=["Usage rate = 75%"],
        used_in_assessments=["carbon_model"],
        assessment_field_keys={"carbon_model": ["usage_rate"]},
    ),
    VariableDefinition(
        key="adoption_rate",
        label="Adoption rate",
        value_type="percent",
        aliases=["adoption rate", "uptake rate"],
        examples=["Adoption rate = 85%"],
        used_in_assessments=["carbon_model"],
        assessment_field_keys={"carbon_model": ["adoption_rate"]},
    ),
    VariableDefinition(
        key="lat",
        label="Latitude",
        value_type="number",
        aliases=["latitude", "lat"],
        examples=["Latitude = -1.2921"],
        used_in_assessments=["solar_estimate"],
        assessment_field_keys={"solar_estimate": ["lat"]},
    ),
    VariableDefinition(
        key="lon",
        label="Longitude",
        value_type="number",
        aliases=["longitude", "lon", "lng"],
        examples=["Longitude = 36.8219"],
        used_in_assessments=["solar_estimate"],
        assessment_field_keys={"solar_estimate": ["lon"]},
    ),
    VariableDefinition(
        key="tilt",
        label="Array tilt",
        value_type="number",
        unit="degrees",
        aliases=["tilt", "panel tilt", "array tilt"],
        examples=["Tilt = 20 degrees"],
        used_in_assessments=["solar_estimate"],
        assessment_field_keys={"solar_estimate": ["tilt"]},
    ),
]


EXTERNAL_BASELINE_VARIABLES: list[VariableDefinition] = [
    VariableDefinition(
        key="electricity_access_total",
        label="Electricity access",
        value_type="percent",
        unit="%",
        aliases=["electricity access", "energy access", "electrification rate"],
        examples=["Electricity access = 15.6%"],
    ),
    VariableDefinition(
        key="electricity_access_rural",
        label="Rural electricity access",
        value_type="percent",
        unit="%",
        aliases=["rural electricity access", "rural electrification"],
        examples=["Rural electricity access = 8.2%"],
    ),
    VariableDefinition(
        key="electricity_access_urban",
        label="Urban electricity access",
        value_type="percent",
        unit="%",
        aliases=["urban electricity access", "urban electrification"],
        examples=["Urban electricity access = 62.4%"],
    ),
    VariableDefinition(
        key="clean_cooking_access",
        label="Clean cooking access",
        value_type="percent",
        unit="%",
        aliases=["clean cooking access", "access to clean fuels and technologies for cooking"],
        examples=["Clean cooking access = 5.1%"],
    ),
    VariableDefinition(
        key="population_total",
        label="Population",
        value_type="number",
        aliases=["population", "total population"],
        examples=["Population = 20,931,751"],
    ),
    VariableDefinition(
        key="gdp_per_capita",
        label="GDP per capita",
        value_type="currency",
        unit="USD",
        aliases=["gdp per capita", "income per capita"],
        examples=["GDP per capita = 650 USD"],
    ),
    VariableDefinition(
        key="inflation",
        label="Inflation",
        value_type="percent",
        unit="%",
        aliases=["inflation", "consumer price inflation"],
        examples=["Inflation = 28.8%"],
    ),
    VariableDefinition(
        key="poverty_headcount",
        label="Poverty headcount",
        value_type="percent",
        unit="%",
        aliases=["poverty headcount", "extreme poverty"],
        examples=["Poverty headcount = 70.1%"],
    ),
]


ALL_VARIABLES = COMMON_VARIABLES + MODULE_VARIABLES + EXTERNAL_BASELINE_VARIABLES
VARIABLE_BY_KEY = {definition.key: definition for definition in ALL_VARIABLES}


def expected_variables_for_assessments(assessment_ids: list[str] | None) -> list[VariableDefinition]:
    assessments = set(assessment_ids or [])
    if not assessments:
        return list(COMMON_VARIABLES)
    return [
        definition
        for definition in ALL_VARIABLES
        if definition.common
        or bool(assessments.intersection(definition.used_in_assessments))
        or bool(assessments.intersection(definition.required_for_assessments))
    ]
