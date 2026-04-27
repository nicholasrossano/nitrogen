"""Adapter registry loader."""

from app.adapters.base import (
    AdapterDefinition,
    AdapterRegistry,
    AdapterResult,
    BaseAdapter,
    get_adapter_registry,
)


def register_all(registry: AdapterRegistry) -> None:
    from app.first_party.registry import register_adapters

    register_adapters(registry)


__all__ = [
    "AdapterDefinition",
    "AdapterRegistry",
    "AdapterResult",
    "BaseAdapter",
    "get_adapter_registry",
    "register_all",
]

