"""Catalog metadata for Nitrogen's shipped first-party assessments.

This keeps current product defaults out of the platform registries while
preserving the existing assessment IDs, tool names, and recommendation behavior.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable


@dataclass(frozen=True)
class AssessmentSelectionMetadata:
    assessment_id: str
    selection_description: str
    selection_triggers: tuple[str, ...] = ()
    required_context: tuple[str, ...] = ()
    capability_tool_name: str | None = None
    tool_hint_message: str | None = None
    domain_tags: tuple[str, ...] = ()


@dataclass(frozen=True)
class FirstPartyAssessmentCatalog:
    assessment_factories: tuple[Callable[[], object], ...]
    recommendation_keywords: dict[str, tuple[str, ...]]
    project_type_keywords: dict[str, tuple[str, ...]]
    selection_metadata: dict[str, AssessmentSelectionMetadata] = field(default_factory=dict)


def get_first_party_catalog() -> FirstPartyAssessmentCatalog:
    """Return the shipped assessment catalog.

    Imports are intentionally local so registry construction does not create
    import cycles with concrete assessment implementations.
    """
    from app.assessments.carbon_assessment import CarbonTool
    from app.assessments.implementation_plan import ImplementationPlanAssessment
    from app.assessments.landscape_mapping import LandscapeMappingAssessment
    from app.assessments.lcoe_assessment import LCOETool
    from app.assessments.pvwatts_assessment import PVWattsTool
    from app.assessments.risk_assessment import RiskAssessment
    from app.assessments.stakeholder_assessment import StakeholderAssessment

    selection_metadata = {
        "lcoe_model": AssessmentSelectionMetadata(
            assessment_id="lcoe_model",
            selection_description="Models project economics and levelized cost of energy.",
            selection_triggers=(
                "LCOE",
                "cost per kWh",
                "project economics",
                "capex",
                "opex",
                "discount rate",
                "financial feasibility",
            ),
            required_context=("technology or energy asset", "geography or operating context"),
            capability_tool_name="run_lcoe",
            tool_hint_message="Building your LCOE model…",
            domain_tags=("energy", "finance", "calculator"),
        ),
        "carbon_model": AssessmentSelectionMetadata(
            assessment_id="carbon_model",
            selection_description="Estimates emissions reductions and carbon-credit potential.",
            selection_triggers=(
                "carbon credits",
                "emission reductions",
                "tCO2e",
                "baseline emissions",
                "Gold Standard",
                "cookstove methodology",
            ),
            required_context=("project activity", "baseline or fuel/emissions context"),
            capability_tool_name="run_carbon",
            tool_hint_message="Building your carbon emissions model…",
            domain_tags=("carbon", "impact", "calculator"),
        ),
        "solar_estimate": AssessmentSelectionMetadata(
            assessment_id="solar_estimate",
            selection_description="Estimates solar production from location and system assumptions.",
            selection_triggers=("solar", "PV", "kWh", "irradiance", "production estimate"),
            required_context=("site or coordinates", "system capacity"),
            capability_tool_name="run_solar",
            tool_hint_message="Building your solar production estimate…",
            domain_tags=("energy", "solar", "calculator"),
        ),
        "generate_project_plan": AssessmentSelectionMetadata(
            assessment_id="generate_project_plan",
            selection_description="Generates or updates the project plan.",
            selection_triggers=("project plan", "plan", "requirements", "deliverables"),
            capability_tool_name="generate_project_plan",
            tool_hint_message="Generating your project plan…",
            domain_tags=("planning",),
        ),
        "stakeholder_assessment": AssessmentSelectionMetadata(
            assessment_id="stakeholder_assessment",
            selection_description="Maps and profiles stakeholders for a project.",
            selection_triggers=("stakeholders", "community", "partners", "engagement"),
            domain_tags=("planning", "engagement"),
        ),
        "landscape_mapping": AssessmentSelectionMetadata(
            assessment_id="landscape_mapping",
            selection_description="Maps the ecosystem of actors, programs, and initiatives.",
            selection_triggers=("landscape", "ecosystem", "market map", "actors"),
            domain_tags=("planning", "research"),
        ),
        "implementation_plan": AssessmentSelectionMetadata(
            assessment_id="implementation_plan",
            selection_description="Turns the project framework into a phased execution plan.",
            selection_triggers=("implementation", "roadmap", "workplan", "execution"),
            domain_tags=("planning", "delivery"),
        ),
        "risk_assessment": AssessmentSelectionMetadata(
            assessment_id="risk_assessment",
            selection_description="Builds a structured project risk register with mitigations and ratings.",
            selection_triggers=(
                "risk",
                "risk register",
                "SORT",
                "diligence",
                "fiduciary",
                "residual risk",
                "risk mitigation",
            ),
            domain_tags=("risk", "diligence", "compliance"),
        ),
    }

    return FirstPartyAssessmentCatalog(
        assessment_factories=(
            LCOETool,
            CarbonTool,
            PVWattsTool,
            StakeholderAssessment,
            LandscapeMappingAssessment,
            RiskAssessment,
            ImplementationPlanAssessment,
        ),
        recommendation_keywords={
            "risk": ("risk_assessment",),
            "risk register": ("risk_assessment",),
            "sort": ("risk_assessment",),
            "diligence": ("risk_assessment",),
            "fiduciary": ("risk_assessment",),
            "residual risk": ("risk_assessment",),
            "project risk": ("risk_assessment",),
            "risk mitigation": ("risk_assessment",),
            "implementation plan": ("implementation_plan",),
            "implementation": ("implementation_plan",),
            "workplan": ("implementation_plan",),
            "execution plan": ("implementation_plan",),
            "roadmap": ("implementation_plan",),
            "lcoe": ("lcoe_model",),
            "levelized": ("lcoe_model",),
            "cost of energy": ("lcoe_model",),
            "cost per kwh": ("lcoe_model",),
            "economics": ("lcoe_model",),
            "feasibility": ("lcoe_model",),
            "capex": ("lcoe_model",),
            "opex": ("lcoe_model",),
            "wacc": ("lcoe_model",),
            "discount rate": ("lcoe_model",),
            "capacity factor": ("lcoe_model",),
            "tariff": ("lcoe_model",),
            "carbon": ("carbon_model",),
            "emissions": ("carbon_model",),
            "tco2": ("carbon_model",),
            "tco2e": ("carbon_model",),
            "emission reductions": ("carbon_model",),
            "carbon credits": ("carbon_model",),
            "fnrb": ("carbon_model",),
            "baseline emissions": ("carbon_model",),
            "er calculation": ("carbon_model",),
            "leakage": ("carbon_model",),
            "gold standard": ("carbon_model",),
            "emission factor": ("carbon_model",),
        },
        project_type_keywords={
            "energy_access": ("mini-grid", "minigrid", "micro-grid", "microgrid", "solar", "pv", "battery"),
            "clean_cooking": ("cookstove", "cooking", "lpg", "biogas", "ethanol", "fuel", "charcoal"),
            "agriculture": ("farm", "agriculture", "crop", "irrigation", "livestock"),
            "water_sanitation": ("water", "sanitation", "wash", "well", "pump"),
            "health": ("health", "clinic", "hospital", "medical"),
        },
        selection_metadata=selection_metadata,
    )


def get_tool_hint_action(tool_hint: str) -> tuple[str, str] | None:
    metadata = get_first_party_catalog().selection_metadata.get(tool_hint)
    if not metadata or not metadata.capability_tool_name:
        return None
    return (
        metadata.capability_tool_name,
        metadata.tool_hint_message or f"Starting {tool_hint.replace('_', ' ')}…",
    )


def format_assessment_selection_context() -> str:
    """Format assessment metadata for LLM routing prompts."""
    lines = [
        "## Available Assessments",
        "Use these registered assessments when the user asks for work that matches their purpose.",
    ]
    for metadata in get_first_party_catalog().selection_metadata.values():
        if metadata.assessment_id == "generate_project_plan":
            continue
        triggers = ", ".join(metadata.selection_triggers) or "None listed"
        required = ", ".join(metadata.required_context) or "No special context required"
        tool = metadata.capability_tool_name or "no direct tool"
        lines.append(
            f"- {metadata.assessment_id}: {metadata.selection_description} "
            f"Triggers: {triggers}. Required context: {required}. Tool: {tool}."
        )
    return "\n".join(lines)

