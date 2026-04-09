"""Capability Registry — single source of truth for all callable capabilities."""

from dataclasses import dataclass, field
from enum import Enum


class CapabilityKind(str, Enum):
    MODULE = "module"
    ADAPTER = "adapter"
    RESOURCE = "resource"
    PROMPT = "prompt"
    INTERNAL_TOOL = "internal"


@dataclass
class CapabilityEntry:
    """One registered capability in the system."""

    id: str
    kind: CapabilityKind
    name: str
    description: str
    input_schema: dict | None = None
    output_schema: dict | None = None
    surfaces: list[str] = field(default_factory=lambda: ["both"])
    visibility: str = "public"  # "public" | "module_bound" | "internal"
    openai_tool_def: dict | None = None


class CapabilityRegistry:
    """Thread-safe registry for all capabilities in the system."""

    def __init__(self) -> None:
        self._entries: dict[str, CapabilityEntry] = {}

    def register(self, entry: CapabilityEntry) -> None:
        self._entries[entry.id] = entry

    def get(self, capability_id: str) -> CapabilityEntry | None:
        return self._entries.get(capability_id)

    def list_for_surface(self, surface: str) -> list[CapabilityEntry]:
        return [
            e
            for e in self._entries.values()
            if surface in e.surfaces or "both" in e.surfaces
        ]

    def list_by_kind(self, kind: CapabilityKind) -> list[CapabilityEntry]:
        return [e for e in self._entries.values() if e.kind == kind]

    def to_openai_tools(self, surface: str) -> list[dict]:
        return [
            e.openai_tool_def
            for e in self.list_for_surface(surface)
            if e.openai_tool_def is not None
        ]


_registry: CapabilityRegistry | None = None


def get_capability_registry() -> CapabilityRegistry:
    """Return the singleton CapabilityRegistry, loading defaults on first access."""
    global _registry
    if _registry is None:
        _registry = CapabilityRegistry()
        from app.capabilities.tool_definitions import register_all

        register_all(_registry)
    return _registry
