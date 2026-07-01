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


def get_default_status_categories():
    if get_active_domain() != "energy":
        raise ValueError(f"Unsupported ACTIVE_DOMAIN '{get_active_domain()}'")
    from app.domain.energy.status_defaults import get_default_status_categories as _get_defaults

    return _get_defaults()


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


def _optional_energy_retrieval():
    if get_active_domain() != "energy":
        return None
    from app.domain.energy import retrieval

    return retrieval


def get_retrieval_connectors():
    pack = _optional_energy_retrieval()
    if pack is None:
        return None
    return pack.get_retrieval_connectors()


def register_retrieval_tools(registry) -> None:
    pack = _optional_energy_retrieval()
    if pack is None:
        return
    pack.register_retrieval_tools(registry)


def format_planning_retrieval_sources() -> str:
    pack = _optional_energy_retrieval()
    if pack is None:
        return ""
    return pack.format_planning_retrieval_sources()


def format_planning_routing_guidelines() -> str:
    pack = _optional_energy_retrieval()
    if pack is None:
        return ""
    return pack.format_planning_routing_guidelines()

