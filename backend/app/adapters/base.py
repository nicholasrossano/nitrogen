"""Adapter contract and registry."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.execution_context import ExecutionContext


@dataclass
class AdapterDefinition:
    adapter_id: str
    name: str
    description: str
    provider: str
    adapter_type: Literal["python", "api", "cli", "file", "mcp"]
    input_schema: dict
    output_schema: dict
    initiative_scope_required: bool
    visibility: Literal["internal", "module_bound", "exposed"]
    capabilities: list[str] = field(default_factory=list)


@dataclass
class AdapterResult:
    output: dict
    execution_meta: dict
    provenance: list[dict]
    warnings: list[str]
    artifacts: list[dict] | None = None


class BaseAdapter(ABC):
    @property
    @abstractmethod
    def definition(self) -> AdapterDefinition:
        raise NotImplementedError

    @abstractmethod
    async def execute(
        self,
        ctx: ExecutionContext,
        db: AsyncSession,
        inputs: dict,
    ) -> AdapterResult:
        raise NotImplementedError


class AdapterRegistry:
    def __init__(self) -> None:
        self._adapters: dict[str, BaseAdapter] = {}

    def register(self, adapter: BaseAdapter) -> None:
        self._adapters[adapter.definition.adapter_id] = adapter

    def get(self, adapter_id: str) -> BaseAdapter | None:
        return self._adapters.get(adapter_id)

    def list_all(self) -> list[BaseAdapter]:
        return list(self._adapters.values())


_registry: AdapterRegistry | None = None


def get_adapter_registry() -> AdapterRegistry:
    global _registry
    if _registry is None:
        _registry = AdapterRegistry()
        from app.adapters import register_all

        register_all(_registry)
    return _registry

