"""MCP exposure defaults for shipped first-party adapters/resources."""

EXPOSED_ADAPTER_IDS = frozenset({
    "lcoe",
    "carbon",
    "pvwatts",
    "retrieval",
    "openalex",
    "rag",
})

EXPOSED_RESOURCE_TYPES = frozenset({
    "evidence_doc",
    "evidence_chunk",
    "corpus_doc",
    "memo_version",
})

