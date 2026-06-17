import pytest

from app.capabilities.registry import CapabilityRegistry, CapabilityRoute
from app.config import get_settings
from app.domain.registry import (
    format_planning_retrieval_sources,
    format_planning_routing_guidelines,
    get_retrieval_connectors,
    register_retrieval_tools,
)


@pytest.fixture
def active_domain(monkeypatch):
    def _set(domain: str):
        get_settings.cache_clear()
        monkeypatch.setenv("ACTIVE_DOMAIN", domain)

    yield _set
    get_settings.cache_clear()


def test_energy_domain_exposes_retrieval_connectors(active_domain):
    active_domain("energy")
    connectors = get_retrieval_connectors()
    assert connectors is not None
    assert connectors.worldbank_indicators is not None
    assert connectors.iati is not None


def test_non_energy_domain_hides_retrieval_connectors(active_domain):
    active_domain("finance")
    assert get_retrieval_connectors() is None
    assert format_planning_retrieval_sources() == ""
    assert format_planning_routing_guidelines() == ""


def test_register_retrieval_tools_respects_active_domain(active_domain):
    active_domain("energy")
    registry = CapabilityRegistry()
    register_retrieval_tools(registry)

    tool_names = {
        entry.openai_tool_def["function"]["name"]
        for entry in registry.list_for_route(CapabilityRoute.STANDALONE_CHAT)
        if entry.openai_tool_def is not None
    }
    assert "search_country_indicators" in tool_names
    assert "search_funding_activity" in tool_names

    active_domain("finance")
    other_registry = CapabilityRegistry()
    register_retrieval_tools(other_registry)
    assert other_registry.get("search_country_indicators") is None


@pytest.mark.asyncio
async def test_tiered_retrieval_skips_worldbank_when_domain_unavailable(active_domain):
    active_domain("finance")

    from app.services.tiered_retrieval import TieredRetrievalService

    service = TieredRetrievalService(db=None)  # type: ignore[arg-type]
    assert await service.search_worldbank_indicators("electricity access Kenya") == []
    assert await service.search_worldbank_documents("clean cooking strategy") == []
    assert await service.search_worldbank_projects("solar mini-grid") == []
    assert await service.search_iati("clean cooking funding") == []


def test_assumption_candidates_skip_worldbank_when_domain_unavailable(active_domain):
    active_domain("finance")
    from app.services.assumptions import suggest_assumption_candidates

    facts = [
        {
            "source_type": "worldbank_indicator",
            "chunk_id": "KEN:EG.ELC.ACCS.ZS:2022",
            "source_title": "Access to electricity (Kenya)",
            "content": "Access to electricity (EG.ELC.ACCS.ZS) for Kenya in 2022: 75.0.",
        }
    ]
    assert suggest_assumption_candidates(facts) == []
