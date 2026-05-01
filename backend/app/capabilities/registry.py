"""Capability registry for chat, assessments, adapters, and resources."""

from dataclasses import dataclass, field
from enum import Enum


class CapabilityKind(str, Enum):
    MODULE = "assessment"
    ADAPTER = "adapter"
    RESOURCE = "resource"
    PROMPT = "prompt"
    INTERNAL_TOOL = "internal"


class CapabilityRoute(str, Enum):
    STANDALONE_CHAT = "standalone_chat"
    PROJECT_CHAT = "project_chat"
    PROJECT_ORCHESTRATION = "project_orchestration"


@dataclass(frozen=True)
class CapabilityToolContext:
    """Typed context for selecting OpenAI-callable tools."""

    route: CapabilityRoute
    initiative_id: str | None = None
    onboarding_mode: bool = False
    has_field_context: bool = False
    has_assessment_context: bool = False


@dataclass
class CapabilityEntry:
    """One registered capability in the system."""

    id: str
    kind: CapabilityKind
    name: str
    description: str
    input_schema: dict | None = None
    output_schema: dict | None = None
    routes: list[CapabilityRoute] = field(default_factory=list)
    requires_initiative: bool = False
    onboarding_only: bool = False
    requires_field_context: bool = False
    requires_assessment_context: bool = False
    visibility: str = "public"  # "public" | "assessment_bound" | "internal"
    openai_tool_def: dict | None = None


class CapabilityRegistry:
    """Thread-safe registry for all capabilities in the system."""

    def __init__(self) -> None:
        self._entries: dict[str, CapabilityEntry] = {}

    def register(self, entry: CapabilityEntry) -> None:
        self._entries[entry.id] = entry

    def get(self, capability_id: str) -> CapabilityEntry | None:
        return self._entries.get(capability_id)

    def list_for_route(self, route: CapabilityRoute) -> list[CapabilityEntry]:
        return [
            e
            for e in self._entries.values()
            if route in e.routes
        ]

    def list_by_kind(self, kind: CapabilityKind) -> list[CapabilityEntry]:
        return [e for e in self._entries.values() if e.kind == kind]

    def tools_for(self, context: CapabilityToolContext) -> list[dict]:
        return [
            e.openai_tool_def
            for e in self.list_for_route(context.route)
            if (not e.requires_initiative or context.initiative_id is not None)
            and (not e.onboarding_only or context.onboarding_mode)
            and (not e.requires_field_context or context.has_field_context)
            and (not e.requires_assessment_context or context.has_assessment_context)
            if e.openai_tool_def is not None
        ]

    def to_openai_tools(self, route: str | CapabilityRoute) -> list[dict]:
        """Compatibility helper for tests and legacy callers."""
        if isinstance(route, CapabilityRoute):
            route_enum = route
        else:
            route_aliases = {
                "standalone": CapabilityRoute.STANDALONE_CHAT,
                "project": CapabilityRoute.PROJECT_CHAT,
                "orchestration": CapabilityRoute.PROJECT_ORCHESTRATION,
            }
            route_enum = route_aliases[route] if route in route_aliases else CapabilityRoute(route)
        initiative_id = "context" if route_enum != CapabilityRoute.STANDALONE_CHAT else None
        return self.tools_for(
            CapabilityToolContext(
                route=route_enum,
                initiative_id=initiative_id,
                onboarding_mode=route_enum == CapabilityRoute.PROJECT_ORCHESTRATION,
            )
        )


_registry: CapabilityRegistry | None = None


def get_capability_registry() -> CapabilityRegistry:
    """Return the singleton CapabilityRegistry, loading defaults on first access."""
    global _registry
    if _registry is None:
        _registry = CapabilityRegistry()
        from app.capabilities.tool_definitions import register_all

        register_all(_registry)
    return _registry
