"""Adapter registry loader."""

from app.adapters.base import (
    AdapterDefinition,
    AdapterRegistry,
    AdapterResult,
    BaseAdapter,
    get_adapter_registry,
)
from app.adapters.carbon_adapter import CarbonAdapter
from app.adapters.lcoe_adapter import LCOEAdapter
from app.adapters.memo_generation_adapter import MemoGenerationAdapter
from app.adapters.openalex_adapter import OpenAlexAdapter
from app.adapters.pvwatts_adapter import PVWattsAdapter
from app.adapters.rag_adapter import RAGAdapter
from app.adapters.retrieval_adapter import RetrievalAdapter


def register_all(registry: AdapterRegistry) -> None:
    registry.register(LCOEAdapter())
    registry.register(CarbonAdapter())
    registry.register(PVWattsAdapter())
    registry.register(RetrievalAdapter())
    registry.register(OpenAlexAdapter())
    registry.register(RAGAdapter())
    registry.register(MemoGenerationAdapter())


__all__ = [
    "AdapterDefinition",
    "AdapterRegistry",
    "AdapterResult",
    "BaseAdapter",
    "get_adapter_registry",
    "register_all",
]

