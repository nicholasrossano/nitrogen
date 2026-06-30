"""Resource registry and URI resolution."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Awaitable, Callable, Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.execution_context import ExecutionContext
from app.models.corpus import CorpusDocument
from app.models.evidence import EvidenceChunk, EvidenceDoc
from app.models.memo import MemoVersion
from app.models.assessment_instance import AssessmentInstance
from app.models.project_material import ProjectMaterial

ReadHandler = Callable[[str, AsyncSession, ExecutionContext], Awaitable[dict]]


@dataclass
class ResourceDefinition:
    uri_pattern: str
    resource_type: str
    name: str
    description: str
    mime_type: str
    project_scoped: bool
    read_handler: ReadHandler
    visibility: Literal["internal", "exposed"] = "internal"


class ResourceRegistry:
    def __init__(self) -> None:
        self._definitions: list[ResourceDefinition] = []
        self._compiled: list[tuple[ResourceDefinition, re.Pattern[str]]] = []

    def register(self, definition: ResourceDefinition) -> None:
        regex_pattern = re.escape(definition.uri_pattern)
        regex_pattern = re.sub(r"\\\{([a-zA-Z0-9_]+)\\\}", r"(?P<\1>[^/]+)", regex_pattern)
        compiled = re.compile(f"^{regex_pattern}$")
        self._definitions.append(definition)
        self._compiled.append((definition, compiled))

    def resolve(self, uri: str) -> tuple[ResourceDefinition, dict] | None:
        for definition, pattern in self._compiled:
            match = pattern.match(uri)
            if match:
                return definition, match.groupdict()
        return None

    def list_definitions(self) -> list[ResourceDefinition]:
        return list(self._definitions)

    async def list_for_project(self, project_id: UUID, db: AsyncSession) -> list[str]:
        uris: list[str] = [f"nitrogen://projects/{project_id}"]

        evidence_docs = (
            await db.execute(select(EvidenceDoc.id).where(EvidenceDoc.project_id == project_id))
        ).scalars().all()
        uris.extend(
            f"nitrogen://projects/{project_id}/evidence/docs/{doc_id}"
            for doc_id in evidence_docs
        )

        evidence_chunks = (
            await db.execute(
                select(EvidenceChunk.id)
                .join(EvidenceDoc, EvidenceDoc.id == EvidenceChunk.evidence_doc_id)
                .where(EvidenceDoc.project_id == project_id)
            )
        ).scalars().all()
        uris.extend(
            f"nitrogen://projects/{project_id}/evidence/chunks/{chunk_id}"
            for chunk_id in evidence_chunks
        )

        materials = (
            await db.execute(
                select(ProjectMaterial.id).where(ProjectMaterial.project_id == project_id)
            )
        ).scalars().all()
        uris.extend(
            f"nitrogen://projects/{project_id}/materials/{material_id}"
            for material_id in materials
        )

        memos = (
            await db.execute(select(MemoVersion.id).where(MemoVersion.project_id == project_id))
        ).scalars().all()
        uris.extend(
            f"nitrogen://projects/{project_id}/memos/{version_id}"
            for version_id in memos
        )

        instances = (
            await db.execute(
                select(AssessmentInstance.id).where(AssessmentInstance.project_id == project_id)
            )
        ).scalars().all()
        uris.extend(
            f"nitrogen://projects/{project_id}/assessments/{instance_id}"
            for instance_id in instances
        )
        uris.extend(
            f"nitrogen://projects/{project_id}/artifacts/{instance_id}"
            for instance_id in instances
        )

        corpus_docs = (await db.execute(select(CorpusDocument.id))).scalars().all()
        uris.extend(f"nitrogen://corpus/{doc_id}" for doc_id in corpus_docs)

        return uris


_registry: ResourceRegistry | None = None


def get_resource_registry() -> ResourceRegistry:
    global _registry
    if _registry is None:
        _registry = ResourceRegistry()
        from app.resources import register_all

        register_all(_registry)
    return _registry

