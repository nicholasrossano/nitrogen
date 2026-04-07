"""Adapter wrapper for RAG retrieval service."""

from __future__ import annotations

import time
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.base import AdapterDefinition, AdapterResult, BaseAdapter
from app.core.execution_context import ExecutionContext
from app.services.rag import RAGService


class RAGAdapter(BaseAdapter):
    @property
    def definition(self) -> AdapterDefinition:
        return AdapterDefinition(
            adapter_id="rag",
            name="RAG Adapter",
            description="Retrieve evidence/corpus chunks using vector similarity search.",
            provider="internal",
            adapter_type="python",
            input_schema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "initiative_id": {"type": "string"},
                    "sources": {"type": "array", "items": {"type": "string"}},
                    "evidence_top_k": {"type": "integer"},
                    "corpus_top_k": {"type": "integer"},
                },
                "required": ["query"],
            },
            output_schema={
                "type": "object",
                "properties": {
                    "chunks": {"type": "array", "items": {"type": "object"}},
                },
            },
            initiative_scope_required=True,
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
        rag = RAGService(db)

        initiative_id = inputs.get("initiative_id") or (str(ctx.initiative_id) if ctx.initiative_id else None)
        if initiative_id is None:
            raise ValueError("rag adapter requires initiative_id (input or context).")

        chunks = await rag.retrieve(
            query=inputs["query"],
            initiative_id=UUID(initiative_id),
            sources=inputs.get("sources", ["evidence", "corpus"]),
            evidence_top_k=inputs.get("evidence_top_k", 3),
            corpus_top_k=inputs.get("corpus_top_k", 5),
        )
        payload_chunks = [
            {
                "chunk_id": str(c.chunk_id),
                "content": c.content,
                "source_type": c.source_type,
                "source_doc_id": str(c.source_doc_id),
                "source_title": c.source_title,
                "similarity": c.similarity,
                "chunk_index": c.chunk_index,
            }
            for c in chunks
        ]
        provenance = [
            {
                "source_title": c.source_title,
                "chunk_id": str(c.chunk_id),
                "source_type": c.source_type,
                "similarity": c.similarity,
            }
            for c in chunks
        ]
        return AdapterResult(
            output={"chunks": payload_chunks},
            execution_meta={"duration_ms": int((time.perf_counter() - started) * 1000)},
            provenance=provenance,
            warnings=[],
            artifacts=None,
        )

