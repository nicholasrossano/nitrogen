"""Adapter wrapper for OpenAlex service."""

from __future__ import annotations

import time

from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.base import AdapterDefinition, AdapterResult, BaseAdapter
from app.core.execution_context import ExecutionContext
from app.mcp.exposure_policy import adapter_visibility
from app.services.openalex import OpenAlexService


class OpenAlexAdapter(BaseAdapter):
    @property
    def definition(self) -> AdapterDefinition:
        return AdapterDefinition(
            adapter_id="openalex",
            name="OpenAlex Adapter",
            description="Search peer-reviewed literature via OpenAlex.",
            provider="openalex",
            adapter_type="api",
            input_schema={
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "title": "OpenAlexInput",
                "description": "Inputs for scholarly literature search via OpenAlex.",
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query to run against OpenAlex.",
                    },
                    "per_page": {
                        "type": "integer",
                        "description": "Maximum number of works to return.",
                    },
                },
                "required": ["query"],
            },
            output_schema={
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "title": "OpenAlexOutput",
                "description": "OpenAlex work-search results.",
                "type": "object",
                "properties": {
                    "works": {
                        "type": "array",
                        "description": "Matching scholarly works returned by OpenAlex.",
                        "items": {"type": "object"},
                    },
                },
            },
            project_scope_required=False,
            visibility=adapter_visibility("openalex", "exposed"),
            capabilities=["async"],
        )

    async def execute(
        self,
        ctx: ExecutionContext,
        db: AsyncSession,
        inputs: dict,
    ) -> AdapterResult:
        _ = (ctx, db)
        started = time.perf_counter()

        service = OpenAlexService()
        works = await service.search_works(
            query=inputs["query"],
            per_page=inputs.get("per_page", 10),
        )
        works_payload = [w.__dict__ for w in works]

        provenance = [
            {"source_title": w.title, "source_url": w.doi_url, "publisher": w.source_name}
            for w in works
        ]
        return AdapterResult(
            output={"works": works_payload},
            execution_meta={"duration_ms": int((time.perf_counter() - started) * 1000)},
            provenance=provenance,
            warnings=[],
            artifacts=None,
        )

