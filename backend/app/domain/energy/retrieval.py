"""Energy-domain external retrieval connectors and chat tools."""

from __future__ import annotations

from dataclasses import dataclass

from app.capabilities.registry import (
    CapabilityEntry,
    CapabilityKind,
    CapabilityRegistry,
    CapabilityRoute,
)
from app.domain.energy.services.iati import IATIService
from app.domain.energy.services.worldbank import (
    WorldBankDocumentService,
    WorldBankIndicatorService,
    WorldBankProjectService,
)


@dataclass(frozen=True)
class DomainRetrievalConnectors:
    worldbank_indicators: WorldBankIndicatorService
    worldbank_documents: WorldBankDocumentService
    worldbank_projects: WorldBankProjectService
    iati: IATIService


def get_retrieval_connectors() -> DomainRetrievalConnectors:
    return DomainRetrievalConnectors(
        worldbank_indicators=WorldBankIndicatorService(),
        worldbank_documents=WorldBankDocumentService(),
        worldbank_projects=WorldBankProjectService(),
        iati=IATIService(),
    )


def format_planning_retrieval_sources() -> str:
    return "\n".join(
        [
            "- search_country_indicators: World Bank Open Data indicators for country baselines",
            "- search_institutional_reports: World Bank Documents & Reports for institutional evidence",
            "- search_comparable_projects: World Bank Projects & Operations for precedent projects",
            "- search_funding_activity: IATI Datastore funding activity records",
        ]
    )


def format_planning_routing_guidelines() -> str:
    return "\n".join(
        [
            "- Country macro/market indicator baselines (electricity access, GDP, inflation, poverty, population) -> search_country_indicators",
            "- Institutional strategy, diagnostics, appraisal/completion documents -> search_institutional_reports",
            "- Comparable financed projects and precedent interventions -> search_comparable_projects",
            "- Funder landscape / who else is funding what -> search_funding_activity",
        ]
    )


def register_retrieval_tools(registry: CapabilityRegistry) -> None:
    """Register World Bank and IATI chat retrieval tools for the energy domain."""
    registry.register(
        CapabilityEntry(
            id="search_country_indicators",
            kind=CapabilityKind.INTERNAL_TOOL,
            name="Search Country Indicators",
            description="Query World Bank Open Data for country indicator values.",
            routes=[CapabilityRoute.STANDALONE_CHAT, CapabilityRoute.PROJECT_CHAT],
            openai_tool_def={
                "type": "function",
                "function": {
                    "name": "search_country_indicators",
                    "description": (
                        "Query World Bank Open Data for country-level indicators (electricity access, "
                        "clean cooking access, population, GDP per capita, inflation, poverty). "
                        "Use this when the user needs baseline market or macro assumptions for a country."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "Focused query for country indicator lookup (max 20 words).",
                            },
                            "reason": {
                                "type": "string",
                                "description": "One sentence explaining why country indicators are needed.",
                            },
                        },
                        "required": ["query", "reason"],
                    },
                },
            },
        )
    )

    registry.register(
        CapabilityEntry(
            id="search_institutional_reports",
            kind=CapabilityKind.INTERNAL_TOOL,
            name="Search Institutional Reports",
            description="Search World Bank Documents & Reports metadata.",
            routes=[CapabilityRoute.STANDALONE_CHAT, CapabilityRoute.PROJECT_CHAT],
            openai_tool_def={
                "type": "function",
                "function": {
                    "name": "search_institutional_reports",
                    "description": (
                        "Search World Bank Documents & Reports for diagnostics, strategies, project appraisal "
                        "documents, and implementation reports. Use this when institutional evidence is needed."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "Focused query for World Bank reports search (max 20 words).",
                            },
                            "reason": {
                                "type": "string",
                                "description": "One sentence explaining why institutional reports are needed.",
                            },
                        },
                        "required": ["query", "reason"],
                    },
                },
            },
        )
    )

    registry.register(
        CapabilityEntry(
            id="search_comparable_projects",
            kind=CapabilityKind.INTERNAL_TOOL,
            name="Search Comparable Projects",
            description="Search World Bank Projects & Operations for precedent projects.",
            routes=[CapabilityRoute.STANDALONE_CHAT, CapabilityRoute.PROJECT_CHAT],
            openai_tool_def={
                "type": "function",
                "function": {
                    "name": "search_comparable_projects",
                    "description": (
                        "Search World Bank Projects & Operations for comparable projects, intervention "
                        "patterns, and financing precedent by country or topic."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "Focused query for comparable projects search (max 20 words).",
                            },
                            "reason": {
                                "type": "string",
                                "description": "One sentence explaining why comparable projects are needed.",
                            },
                        },
                        "required": ["query", "reason"],
                    },
                },
            },
        )
    )

    registry.register(
        CapabilityEntry(
            id="search_funding_activity",
            kind=CapabilityKind.INTERNAL_TOOL,
            name="Search Funding Activity",
            description="Query IATI Datastore for reported development funding activity.",
            routes=[CapabilityRoute.STANDALONE_CHAT, CapabilityRoute.PROJECT_CHAT],
            openai_tool_def={
                "type": "function",
                "function": {
                    "name": "search_funding_activity",
                    "description": (
                        "Query IATI Datastore for reported development funding activity by geography, "
                        "sector, and intervention keywords. Use this for funder landscape questions."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "Focused query for funding activity search (max 20 words).",
                            },
                            "reason": {
                                "type": "string",
                                "description": "One sentence explaining why funding activity data is needed.",
                            },
                        },
                        "required": ["query", "reason"],
                    },
                },
            },
        )
    )
