"""Central MCP exposure policy for Nitrogen capabilities."""

from __future__ import annotations

from typing import Literal

from app.first_party.mcp import EXPOSED_ADAPTER_IDS, EXPOSED_RESOURCE_TYPES

AdapterVisibility = Literal["internal", "assessment_bound", "exposed"]
ResourceVisibility = Literal["internal", "exposed"]


def adapter_visibility(adapter_id: str, default: AdapterVisibility) -> AdapterVisibility:
    """Return the MCP visibility for a concrete adapter."""
    if adapter_id in EXPOSED_ADAPTER_IDS:
        return "exposed"
    return default


def resource_visibility(resource_type: str) -> ResourceVisibility:
    """Return the MCP visibility for a concrete resource type."""
    if resource_type in EXPOSED_RESOURCE_TYPES:
        return "exposed"
    return "internal"

