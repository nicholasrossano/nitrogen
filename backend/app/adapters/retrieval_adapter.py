"""Adapter wrapper for TieredRetrievalService.retrieve()."""

from __future__ import annotations

import time
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.base import AdapterDefinition, AdapterResult, BaseAdapter
from app.core.execution_context import ExecutionContext
from app.mcp.exposure_policy import adapter_visibility
from app.services.tiered_retrieval import TieredRetrievalService


class RetrievalAdapter(BaseAdapter):
    @property
    def definition(self) -> AdapterDefinition:
        return AdapterDefinition(
            adapter_id="retrieval",
            name="Retrieval Adapter",
            description="Run tiered retrieval across corpus, scholarly, web, and fallback tiers.",
            provider="internal",
            adapter_type="python",
            input_schema={
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "title": "RetrievalInput",
                "description": "Inputs for Nitrogen's tiered retrieval workflow.",
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Research question or retrieval query to execute.",
                    },
                    "initiative_id": {
                        "type": "string",
                        "description": "Initiative UUID used to scope project evidence and permissions.",
                    },
                    "include_openalex": {
                        "type": "boolean",
                        "description": "Whether to include the OpenAlex scholarly retrieval tier.",
                    },
                    "include_web_search": {
                        "type": "boolean",
                        "description": "Whether to include the web-search retrieval tier.",
                    },
                    "include_llm_fallback": {
                        "type": "boolean",
                        "description": "Whether to allow the LLM fallback tier when citations are scarce.",
                    },
                    "require_citation": {
                        "type": "boolean",
                        "description": "Whether to require citation-backed facts in the final result.",
                    },
                },
                "required": ["query", "initiative_id"],
            },
            output_schema={
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "title": "RetrievalOutput",
                "description": "Tiered retrieval result with the facts and tiers used.",
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The normalized retrieval query that was executed.",
                    },
                    "tiers_used": {
                        "type": "array",
                        "description": "Retrieval tiers that contributed to the response.",
                        "items": {"type": "string"},
                    },
                    "facts": {
                        "type": "array",
                        "description": "Retrieved fact payloads returned by the retrieval service.",
                        "items": {"type": "object"},
                    },
                },
            },
            initiative_scope_required=True,
            visibility=adapter_visibility("retrieval", "internal"),
            capabilities=["async"],
        )

    async def execute(
        self,
        ctx: ExecutionContext,
        db: AsyncSession,
        inputs: dict,
    ) -> AdapterResult:
        started = time.perf_counter()
        service = TieredRetrievalService(db, user_id=ctx.user_id)

        initiative_id = inputs.get("initiative_id")
        if initiative_id is None and ctx.initiative_id is not None:
            initiative_id = str(ctx.initiative_id)
        initiative_uuid = UUID(initiative_id) if initiative_id else None

        result = await service.retrieve(
            query=inputs["query"],
            initiative_id=initiative_uuid,
            include_openalex=inputs.get("include_openalex", True),
            include_web_search=inputs.get("include_web_search", True),
            include_llm_fallback=inputs.get("include_llm_fallback", True),
            require_citation=inputs.get("require_citation", False),
        )
        facts = [f.to_dict() for f in result.facts]

        return AdapterResult(
            output={
                "query": result.query,
                "tiers_used": result.tiers_used,
                "facts": facts,
            },
            execution_meta={"duration_ms": int((time.perf_counter() - started) * 1000)},
            provenance=facts,
            warnings=[],
            artifacts=None,
        )

