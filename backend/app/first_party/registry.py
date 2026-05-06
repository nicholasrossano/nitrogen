"""Registration hooks for Nitrogen's shipped first-party content."""

from __future__ import annotations

from app.first_party.catalog import get_first_party_catalog


def register_assessments(registry) -> None:
    """Register shipped assessments with the platform assessment registry."""
    for factory in get_first_party_catalog().assessment_factories:
        registry.register(factory())


def register_adapters(registry) -> None:
    """Register shipped adapters with the platform adapter registry."""
    from app.domain.energy.adapters.carbon_adapter import CarbonAdapter
    from app.domain.energy.adapters.lcoe_adapter import LCOEAdapter
    from app.adapters.memo_generation_adapter import MemoGenerationAdapter
    from app.adapters.openalex_adapter import OpenAlexAdapter
    from app.domain.energy.adapters.pvwatts_adapter import PVWattsAdapter
    from app.adapters.rag_adapter import RAGAdapter
    from app.adapters.retrieval_adapter import RetrievalAdapter

    registry.register(LCOEAdapter())
    registry.register(CarbonAdapter())
    registry.register(PVWattsAdapter())
    registry.register(RetrievalAdapter())
    registry.register(OpenAlexAdapter())
    registry.register(RAGAdapter())
    registry.register(MemoGenerationAdapter())

