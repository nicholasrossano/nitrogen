"""Active domain registry facade."""

from __future__ import annotations

from app.domain.resolver import get_active_domain


def _energy_registry():
    if get_active_domain() != "energy":
        raise ValueError(f"Unsupported ACTIVE_DOMAIN '{get_active_domain()}'")
    from app.domain.energy import registry

    return registry


def _energy_catalog():
    if get_active_domain() != "energy":
        raise ValueError(f"Unsupported ACTIVE_DOMAIN '{get_active_domain()}'")
    from app.domain.energy import catalog

    return catalog


def _energy_exports():
    if get_active_domain() != "energy":
        raise ValueError(f"Unsupported ACTIVE_DOMAIN '{get_active_domain()}'")
    from app.domain.energy import exports

    return exports


def _energy_mcp():
    if get_active_domain() != "energy":
        raise ValueError(f"Unsupported ACTIVE_DOMAIN '{get_active_domain()}'")
    from app.domain.energy import mcp

    return mcp


def register_assessments(registry) -> None:
    _energy_registry().register_assessments(registry)


def register_adapters(registry) -> None:
    _energy_registry().register_adapters(registry)


def get_first_party_catalog():
    return _energy_catalog().get_first_party_catalog()


def get_tool_hint_action(tool_hint: str) -> tuple[str, str] | None:
    return _energy_catalog().get_tool_hint_action(tool_hint)


def format_assessment_selection_context() -> str:
    return _energy_catalog().format_assessment_selection_context()


def build_export_handlers(handlers: dict):
    return _energy_exports().build_export_handlers(handlers)


def exposed_adapter_ids():
    return _energy_mcp().EXPOSED_ADAPTER_IDS


def exposed_resource_types():
    return _energy_mcp().EXPOSED_RESOURCE_TYPES

