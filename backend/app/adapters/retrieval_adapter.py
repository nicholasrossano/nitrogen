"""Adapter wrapper for TieredRetrievalService.retrieve()."""

from __future__ import annotations

import time
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.base import AdapterDefinition, AdapterResult, BaseAdapter
from app.core.execution_context import ExecutionContext
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
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "initiative_id": {"type": "string"},
                    "include_openalex": {"type": "boolean"},
                    "include_web_search": {"type": "boolean"},
                    "include_llm_fallback": {"type": "boolean"},
                    "require_citation": {"type": "boolean"},
                },
                "required": ["query"],
            },
            output_schema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "tiers_used": {"type": "array", "items": {"type": "string"}},
                    "facts": {"type": "array", "items": {"type": "object"}},
                },
            },
            initiative_scope_required=False,
            visibility="internal",
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

