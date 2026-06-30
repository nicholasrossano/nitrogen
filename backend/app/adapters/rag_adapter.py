"""Adapter wrapper for RAG retrieval service."""

from __future__ import annotations

import time
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.base import AdapterDefinition, AdapterResult, BaseAdapter
from app.core.execution_context import ExecutionContext
from app.mcp.exposure_policy import adapter_visibility
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
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "title": "RAGInput",
                "description": "Inputs for Nitrogen's scoped RAG retrieval adapter.",
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Similarity-search query to run over evidence and corpus content.",
                    },
                    "project_id": {
                        "type": "string",
                        "description": "Project UUID used to scope evidence access and permissions.",
                    },
                    "sources": {
                        "type": "array",
                        "description": "Source collections to search, typically evidence and/or corpus.",
                        "items": {"type": "string"},
                    },
                    "evidence_top_k": {
                        "type": "integer",
                        "description": "Maximum number of initiative evidence chunks to return.",
                    },
                    "corpus_top_k": {
                        "type": "integer",
                        "description": "Maximum number of corpus chunks to return.",
                    },
                },
                "required": ["query", "project_id"],
            },
            output_schema={
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "title": "RAGOutput",
                "description": "Chunk-level vector retrieval results.",
                "type": "object",
                "properties": {
                    "chunks": {
                        "type": "array",
                        "description": "Retrieved chunks with provenance and similarity metadata.",
                        "items": {"type": "object"},
                    },
                },
            },
            project_scope_required=True,
            visibility=adapter_visibility("rag", "internal"),
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

        project_id = inputs.get("project_id") or (str(ctx.project_id) if ctx.project_id else None)
        if project_id is None:
            raise ValueError("rag adapter requires project_id (input or context).")

        chunks = await rag.retrieve(
            query=inputs["query"],
            project_id=UUID(project_id),
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

