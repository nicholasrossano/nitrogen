"""Adapter wrapper for memo generation service."""

from __future__ import annotations

import time
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.base import AdapterDefinition, AdapterResult, BaseAdapter
from app.core.execution_context import ExecutionContext
from app.models.project import Project
from app.domain.energy.services.memo_generator import MemoGeneratorService


class MemoGenerationAdapter(BaseAdapter):
    @property
    def definition(self) -> AdapterDefinition:
        return AdapterDefinition(
            adapter_id="memo_generation",
            name="Memo Generation Adapter",
            description="Generate memo content with citations using existing memo generation service.",
            provider="internal",
            adapter_type="python",
            input_schema={
                "type": "object",
                "properties": {
                    "project_id": {"type": "string"},
                },
            },
            output_schema={
                "type": "object",
                "properties": {
                    "memo": {"type": "object"},
                    "citations": {"type": "array", "items": {"type": "object"}},
                },
            },
            project_scope_required=True,
            visibility="assessment_bound",
            capabilities=["async"],
        )

    async def execute(
        self,
        ctx: ExecutionContext,
        db: AsyncSession,
        inputs: dict,
    ) -> AdapterResult:
        started = time.perf_counter()

        project_id = inputs.get("project_id") or (str(ctx.project_id) if ctx.project_id else None)
        if project_id is None:
            raise ValueError("memo_generation adapter requires project_id (input or context).")

        initiative = (
            await db.execute(select(Project).where(Project.id == UUID(project_id)))
        ).scalar_one_or_none()
        if initiative is None:
            raise ValueError("Project not found for memo generation adapter.")

        service = MemoGeneratorService(db, user_id=ctx.user_id)
        memo, citations = await service.generate(initiative=initiative)
        citations_payload = [
            {
                "citation_number": c.citation_number,
                "section_name": c.section_name,
                "chunk_id": str(c.chunk_id) if c.chunk_id else None,
                "source_type": c.source_type,
                "excerpt": c.excerpt,
            }
            for c in citations
        ]
        return AdapterResult(
            output={"memo": memo.model_dump(), "citations": citations_payload},
            execution_meta={"duration_ms": int((time.perf_counter() - started) * 1000)},
            provenance=citations_payload,
            warnings=[],
            artifacts=None,
        )
