"""Central MCP exposure policy for Nitrogen capabilities."""

from __future__ import annotations

from typing import Literal

AdapterVisibility = Literal["internal", "module_bound", "exposed"]
ResourceVisibility = Literal["internal", "exposed"]

# Stable, low-state adapters that are safe to expose over MCP.
EXPOSED_ADAPTER_IDS = frozenset({
    "lcoe",
    "carbon",
    "pvwatts",
    "retrieval",
    "openalex",
    "rag",
})

# Readable resources that map cleanly to stable URIs.
EXPOSED_RESOURCE_TYPES = frozenset({
    "evidence_doc",
    "evidence_chunk",
    "corpus_doc",
    "memo_version",
})


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

