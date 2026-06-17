"""Resource definitions and handlers."""

from __future__ import annotations

from urllib.parse import urlparse
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser
from app.core.execution_context import ExecutionContext
from app.core.permissions import get_initiative_with_role
from app.mcp.exposure_policy import resource_visibility
from app.models.corpus import CorpusDocument
from app.models.evidence import EvidenceChunk, EvidenceDoc
from app.models.project import Initiative, Project
from app.models.memo import MemoVersion
from app.models.assessment_instance import AssessmentInstance
from app.models.project_material import ProjectMaterial
from app.resources.registry import ResourceDefinition, ResourceRegistry, get_resource_registry


async def _ensure_initiative_access(
    db: AsyncSession,
    ctx: ExecutionContext,
    initiative_id: UUID,
) -> Initiative:
    user = AuthUser(uid=ctx.user_id, email=ctx.user_email)
    initiative, _role = await get_initiative_with_role(db, initiative_id, user)
    return initiative


async def _read_initiative(uri: str, db: AsyncSession, ctx: ExecutionContext) -> dict:
    initiative_id = UUID(uri.rsplit("/", 1)[-1])
    initiative = await _ensure_initiative_access(db, ctx, initiative_id)
    return {
        "uri": uri,
        "resource_type": "initiative",
        "data": {
            "id": str(initiative.id),
            "title": initiative.title,
            "project_description": initiative.project_description,
            "project_type": initiative.project_type,
            "geography": initiative.geography,
            "goal": initiative.goal,
            "stage": initiative.stage,
        },
    }


def _project_id_from_uri(uri: str) -> UUID:
    parsed = urlparse(uri)
    segments = [segment for segment in parsed.path.split("/") if segment]
    if parsed.netloc not in {"initiatives", "projects"} or not segments:
        raise ValueError(f"Invalid project-scoped URI: {uri}")
    return UUID(segments[0])


def _initiative_id_from_uri(uri: str) -> UUID:
    return _project_id_from_uri(uri)


async def _read_evidence_doc(uri: str, db: AsyncSession, ctx: ExecutionContext) -> dict:
    initiative_id = _initiative_id_from_uri(uri)
    doc_id = UUID(uri.rsplit("/", 1)[-1])
    await _ensure_initiative_access(db, ctx, initiative_id)
    doc = (
        await db.execute(
            select(EvidenceDoc).where(EvidenceDoc.id == doc_id, EvidenceDoc.initiative_id == initiative_id)
        )
    ).scalar_one_or_none()
    if doc is None:
        raise ValueError("EvidenceDoc not found.")
    return {
        "uri": uri,
        "resource_type": "evidence_doc",
        "data": {
            "id": str(doc.id),
            "initiative_id": str(doc.initiative_id),
            "filename": doc.filename,
            "file_type": doc.file_type,
            "storage_path": doc.storage_path,
            "created_at": doc.created_at.isoformat() if doc.created_at else None,
        },
    }


async def _read_evidence_chunk(uri: str, db: AsyncSession, ctx: ExecutionContext) -> dict:
    initiative_id = _initiative_id_from_uri(uri)
    chunk_id = UUID(uri.rsplit("/", 1)[-1])
    await _ensure_initiative_access(db, ctx, initiative_id)
    chunk = (
        await db.execute(
            select(EvidenceChunk)
            .join(EvidenceDoc, EvidenceDoc.id == EvidenceChunk.evidence_doc_id)
            .where(EvidenceChunk.id == chunk_id, EvidenceDoc.initiative_id == initiative_id)
        )
    ).scalar_one_or_none()
    if chunk is None:
        raise ValueError("EvidenceChunk not found.")
    return {
        "uri": uri,
        "resource_type": "evidence_chunk",
        "data": {
            "id": str(chunk.id),
            "evidence_doc_id": str(chunk.evidence_doc_id),
            "chunk_index": chunk.chunk_index,
            "content": chunk.content,
            "page_number": chunk.page_number,
            "created_at": chunk.created_at.isoformat() if chunk.created_at else None,
        },
    }


async def _read_corpus_doc(uri: str, db: AsyncSession, ctx: ExecutionContext) -> dict:
    _ = ctx
    doc_id = UUID(uri.rsplit("/", 1)[-1])
    doc = (await db.execute(select(CorpusDocument).where(CorpusDocument.id == doc_id))).scalar_one_or_none()
    if doc is None:
        raise ValueError("CorpusDocument not found.")
    return {
        "uri": uri,
        "resource_type": "corpus_doc",
        "data": {
            "id": str(doc.id),
            "title": doc.title,
            "source": doc.source,
            "metadata": doc.doc_metadata,
            "created_at": doc.created_at.isoformat() if doc.created_at else None,
        },
    }


async def _read_project_material(uri: str, db: AsyncSession, ctx: ExecutionContext) -> dict:
    initiative_id = _initiative_id_from_uri(uri)
    material_id = UUID(uri.rsplit("/", 1)[-1])
    await _ensure_initiative_access(db, ctx, initiative_id)
    material = (
        await db.execute(
            select(ProjectMaterial).where(
                ProjectMaterial.id == material_id,
                ProjectMaterial.initiative_id == initiative_id,
            )
        )
    ).scalar_one_or_none()
    if material is None:
        raise ValueError("ProjectMaterial not found.")
    return {
        "uri": uri,
        "resource_type": "project_material",
        "data": {
            "id": str(material.id),
            "initiative_id": str(material.initiative_id),
            "filename": material.filename,
            "file_type": material.file_type,
            "content_text": material.content_text,
            "created_at": material.created_at.isoformat() if material.created_at else None,
        },
    }


async def _read_memo_version(uri: str, db: AsyncSession, ctx: ExecutionContext) -> dict:
    initiative_id = _initiative_id_from_uri(uri)
    version_id = UUID(uri.rsplit("/", 1)[-1])
    await _ensure_initiative_access(db, ctx, initiative_id)
    memo = (
        await db.execute(
            select(MemoVersion).where(
                MemoVersion.id == version_id,
                MemoVersion.initiative_id == initiative_id,
            )
        )
    ).scalar_one_or_none()
    if memo is None:
        raise ValueError("MemoVersion not found.")
    return {
        "uri": uri,
        "resource_type": "memo_version",
        "data": {
            "id": str(memo.id),
            "initiative_id": str(memo.initiative_id),
            "content": memo.content,
            "export_path": memo.export_path,
            "created_at": memo.created_at.isoformat() if memo.created_at else None,
        },
    }


async def _read_assessment_instance(uri: str, db: AsyncSession, ctx: ExecutionContext) -> dict:
    initiative_id = _initiative_id_from_uri(uri)
    instance_id = UUID(uri.rsplit("/", 1)[-1])
    await _ensure_initiative_access(db, ctx, initiative_id)
    instance = (
        await db.execute(
            select(AssessmentInstance).where(
                AssessmentInstance.id == instance_id,
                AssessmentInstance.initiative_id == initiative_id,
            )
        )
    ).scalar_one_or_none()
    if instance is None:
        raise ValueError("AssessmentInstance not found.")
    return {
        "uri": uri,
        "resource_type": "assessment_instance",
        "data": {
            "id": str(instance.id),
            "initiative_id": str(instance.initiative_id),
            "assessment_id": instance.assessment_id,
            "status": instance.status,
            "alignment": instance.alignment,
            "deliverable": instance.deliverable,
            "workflow_state": instance.workflow_state,
            "updated_at": instance.updated_at.isoformat() if instance.updated_at else None,
        },
    }


async def _read_artifact(uri: str, db: AsyncSession, ctx: ExecutionContext) -> dict:
    instance_data = await _read_assessment_instance(uri.replace("/artifacts/", "/assessments/"), db, ctx)
    deliverable = (instance_data.get("data") or {}).get("deliverable") or {}
    return {
        "uri": uri,
        "resource_type": "artifact",
        "data": {
            "artifact_id": instance_data["data"]["id"],
            "assessment_id": instance_data["data"]["assessment_id"],
            "title": deliverable.get("title"),
            "output_type": deliverable.get("output_type"),
            "content": deliverable.get("content"),
            "generated_at": deliverable.get("generated_at"),
        },
    }


def register_all(registry: ResourceRegistry) -> None:
    registry.register(
        ResourceDefinition(
            uri_pattern="nitrogen://projects/{id}",
            resource_type="project",
            name="Project",
            description="Top-level project metadata.",
            mime_type="application/json",
            initiative_scoped=True,
            read_handler=_read_initiative,
            visibility=resource_visibility("initiative"),
        )
    )
    registry.register(
        ResourceDefinition(
            uri_pattern="nitrogen://initiatives/{id}",
            resource_type="initiative",
            name="Initiative",
            description="Top-level initiative/project metadata.",
            mime_type="application/json",
            initiative_scoped=True,
            read_handler=_read_initiative,
            visibility=resource_visibility("initiative"),
        )
    )
    registry.register(
        ResourceDefinition(
            uri_pattern="nitrogen://initiatives/{id}/evidence/docs/{doc_id}",
            resource_type="evidence_doc",
            name="Evidence Document",
            description="Uploaded evidence document metadata.",
            mime_type="application/json",
            initiative_scoped=True,
            read_handler=_read_evidence_doc,
            visibility=resource_visibility("evidence_doc"),
        )
    )
    registry.register(
        ResourceDefinition(
            uri_pattern="nitrogen://initiatives/{id}/evidence/chunks/{chunk_id}",
            resource_type="evidence_chunk",
            name="Evidence Chunk",
            description="Chunked text content from uploaded evidence docs.",
            mime_type="application/json",
            initiative_scoped=True,
            read_handler=_read_evidence_chunk,
            visibility=resource_visibility("evidence_chunk"),
        )
    )
    registry.register(
        ResourceDefinition(
            uri_pattern="nitrogen://corpus/{doc_id}",
            resource_type="corpus_doc",
            name="Corpus Document",
            description="Global corpus document metadata.",
            mime_type="application/json",
            initiative_scoped=False,
            read_handler=_read_corpus_doc,
            visibility=resource_visibility("corpus_doc"),
        )
    )
    registry.register(
        ResourceDefinition(
            uri_pattern="nitrogen://initiatives/{id}/materials/{material_id}",
            resource_type="project_material",
            name="Project Material",
            description="Project material file metadata and extracted text.",
            mime_type="application/json",
            initiative_scoped=True,
            read_handler=_read_project_material,
            visibility=resource_visibility("project_material"),
        )
    )
    registry.register(
        ResourceDefinition(
            uri_pattern="nitrogen://initiatives/{id}/memos/{version_id}",
            resource_type="memo_version",
            name="Memo Version",
            description="Generated memo version and export metadata.",
            mime_type="application/json",
            initiative_scoped=True,
            read_handler=_read_memo_version,
            visibility=resource_visibility("memo_version"),
        )
    )
    registry.register(
        ResourceDefinition(
            uri_pattern="nitrogen://initiatives/{id}/assessments/{instance_id}",
            resource_type="assessment_instance",
            name="Assessment Instance",
            description="Saved assessment instance state and output data.",
            mime_type="application/json",
            initiative_scoped=True,
            read_handler=_read_assessment_instance,
            visibility=resource_visibility("assessment_instance"),
        )
    )
    registry.register(
        ResourceDefinition(
            uri_pattern="nitrogen://initiatives/{id}/artifacts/{artifact_id}",
            resource_type="artifact",
            name="Artifact",
            description="Generated artifact data from a assessment instance deliverable.",
            mime_type="application/json",
            initiative_scoped=True,
            read_handler=_read_artifact,
            visibility=resource_visibility("artifact"),
        )
    )


__all__ = [
    "ResourceDefinition",
    "ResourceRegistry",
    "get_resource_registry",
    "register_all",
]

