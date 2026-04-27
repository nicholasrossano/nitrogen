"""Catalog metadata for Nitrogen's shipped first-party modules.

This keeps current product defaults out of the platform registries while
preserving the existing module IDs, tool names, and recommendation behavior.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable


@dataclass(frozen=True)
class ModuleSelectionMetadata:
    module_id: str
    selection_description: str
    selection_triggers: tuple[str, ...] = ()
    required_context: tuple[str, ...] = ()
    capability_tool_name: str | None = None
    tool_hint_message: str | None = None
    domain_tags: tuple[str, ...] = ()


@dataclass(frozen=True)
class FirstPartyModuleCatalog:
    module_factories: tuple[Callable[[], object], ...]
    recommendation_keywords: dict[str, tuple[str, ...]]
    project_type_keywords: dict[str, tuple[str, ...]]
    selection_metadata: dict[str, ModuleSelectionMetadata] = field(default_factory=dict)


def get_first_party_catalog() -> FirstPartyModuleCatalog:
    """Return the shipped module catalog.

    Imports are intentionally local so registry construction does not create
    import cycles with concrete module implementations.
    """
    from app.modules.carbon_module import CarbonTool
    from app.modules.esmp import ESMPModule
    from app.modules.implementation_plan import ImplementationPlanModule
    from app.modules.landscape_mapping import LandscapeMappingModule
    from app.modules.lcoe_module import LCOETool
    from app.modules.mel_plan import MELPlanModule
    from app.modules.pvwatts_module import PVWattsTool
    from app.modules.risk_assessment import RiskAssessmentModule
    from app.modules.stakeholder_assessment import StakeholderAssessmentModule

    selection_metadata = {
        "lcoe_model": ModuleSelectionMetadata(
            module_id="lcoe_model",
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
        "carbon_model": ModuleSelectionMetadata(
            module_id="carbon_model",
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
        "solar_estimate": ModuleSelectionMetadata(
            module_id="solar_estimate",
            selection_description="Estimates solar production from location and system assumptions.",
            selection_triggers=("solar", "PV", "kWh", "irradiance", "production estimate"),
            required_context=("site or coordinates", "system capacity"),
            capability_tool_name="run_solar",
            tool_hint_message="Building your solar production estimate…",
            domain_tags=("energy", "solar", "calculator"),
        ),
        "generate_project_plan": ModuleSelectionMetadata(
            module_id="generate_project_plan",
            selection_description="Generates or updates the project plan.",
            selection_triggers=("project plan", "plan", "requirements", "deliverables"),
            capability_tool_name="generate_project_plan",
            tool_hint_message="Generating your project plan…",
            domain_tags=("planning",),
        ),
        "stakeholder_assessment": ModuleSelectionMetadata(
            module_id="stakeholder_assessment",
            selection_description="Maps and profiles stakeholders for a project.",
            selection_triggers=("stakeholders", "community", "partners", "engagement"),
            domain_tags=("planning", "engagement"),
        ),
        "landscape_mapping": ModuleSelectionMetadata(
            module_id="landscape_mapping",
            selection_description="Maps the ecosystem of actors, programs, and initiatives.",
            selection_triggers=("landscape", "ecosystem", "market map", "actors"),
            domain_tags=("planning", "research"),
        ),
        "implementation_plan": ModuleSelectionMetadata(
            module_id="implementation_plan",
            selection_description="Turns the project framework into a phased execution plan.",
            selection_triggers=("implementation", "roadmap", "workplan", "execution"),
            domain_tags=("planning", "delivery"),
        ),
        "esmp": ModuleSelectionMetadata(
            module_id="esmp",
            selection_description="Drafts an environmental and social management plan.",
            selection_triggers=("ESMP", "safeguards", "IFC", "environmental management"),
            domain_tags=("safeguards", "compliance"),
        ),
        "mel_plan": ModuleSelectionMetadata(
            module_id="mel_plan",
            selection_description="Builds a monitoring, evaluation, and learning plan.",
            selection_triggers=("MEL", "monitoring", "evaluation", "indicators", "logframe"),
            domain_tags=("measurement", "reporting"),
        ),
        "risk_assessment": ModuleSelectionMetadata(
            module_id="risk_assessment",
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

    return FirstPartyModuleCatalog(
        module_factories=(
            LCOETool,
            CarbonTool,
            PVWattsTool,
            StakeholderAssessmentModule,
            LandscapeMappingModule,
            ESMPModule,
            MELPlanModule,
            RiskAssessmentModule,
            ImplementationPlanModule,
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
            "esmp": ("esmp",),
            "environmental": ("esmp",),
            "safeguards": ("esmp",),
            "e&s": ("esmp",),
            "ifc": ("esmp",),
            "social impact": ("esmp",),
            "mitigation": ("esmp",),
            "resettlement": ("esmp",),
            "biodiversity": ("esmp",),
            "esia": ("esmp",),
            "mel": ("mel_plan",),
            "monitoring": ("mel_plan",),
            "evaluation": ("mel_plan",),
            "results framework": ("mel_plan",),
            "logframe": ("mel_plan",),
            "indicators": ("mel_plan",),
            "impact measurement": ("mel_plan",),
            "theory of change": ("mel_plan",),
            "iris": ("mel_plan",),
            "reporting": ("mel_plan",),
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


def format_module_selection_context() -> str:
    """Format module metadata for LLM routing prompts."""
    lines = [
        "## Available Modules",
        "Use these registered modules when the user asks for work that matches their purpose.",
    ]
    for metadata in get_first_party_catalog().selection_metadata.values():
        if metadata.module_id == "generate_project_plan":
            continue
        triggers = ", ".join(metadata.selection_triggers) or "None listed"
        required = ", ".join(metadata.required_context) or "No special context required"
        tool = metadata.capability_tool_name or "no direct tool"
        lines.append(
            f"- {metadata.module_id}: {metadata.selection_description} "
            f"Triggers: {triggers}. Required context: {required}. Tool: {tool}."
        )
    return "\n".join(lines)

