from __future__ import annotations

from collections import defaultdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.llm_invoke import acompletion
from app.core.model_catalog import Complexity, ModelRole
from app.models.evidence import EvidenceChunk, EvidenceDoc
from app.models.project import Project
from app.models.project_material import ProjectMaterial

settings = get_settings()

MAX_SOURCES = 6
MAX_EXCERPT_CHARS = 1200
MAX_EVIDENCE_CHUNKS_PER_DOC = 3


def _clean_text(value: str | None, limit: int = MAX_EXCERPT_CHARS) -> str:
    if not value:
        return ""
    collapsed = " ".join(value.split())
    return collapsed[:limit].strip()


def _format_project_type(value: str | None) -> str | None:
    if not value:
        return None
    return value.replace("_", " ").strip().title()


def _build_overview_prompt(
    initiative: Project,
    source_summaries: list[dict[str, str]],
) -> tuple[str, str]:
    metadata_lines = [
        f"Title: {initiative.title or 'Untitled initiative'}",
    ]
    if initiative.geography:
        metadata_lines.append(f"Geography: {initiative.geography}")
    formatted_type = _format_project_type(initiative.project_type)
    if formatted_type:
        metadata_lines.append(f"Project type: {formatted_type}")
    if initiative.project_description:
        metadata_lines.append(f"Existing description: {_clean_text(initiative.project_description, 700)}")
    if initiative.goal:
        metadata_lines.append(f"Goal: {_clean_text(initiative.goal, 400)}")

    source_lines: list[str] = []
    for idx, source in enumerate(source_summaries, start=1):
        excerpt = source.get("excerpt") or "No text could be extracted from this file."
        source_lines.append(
            f"{idx}. [{source['source_type']}] {source['filename']}\n"
            f"   Excerpt: {excerpt}"
        )

    system_prompt = (
        "You write concise project overview summaries for a research workspace. "
        "Return a single short paragraph of 2-4 sentences. Be specific, grounded in the provided files, "
        "and avoid guessing details that are not supported by the source material. "
        "Mention the initiative's context and what the uploaded files suggest this project is about."
    )
    user_prompt = (
        "Create a lightweight overview summary for this initiative.\n\n"
        "Project context:\n" + "\n".join(metadata_lines) + "\n\n"
        "Uploaded files:\n" + "\n".join(source_lines)
    )
    return system_prompt, user_prompt


async def _load_source_summaries(db: AsyncSession, project_id) -> list[dict[str, str]]:
    material_result = await db.execute(
        select(ProjectMaterial)
        .where(ProjectMaterial.project_id == project_id)
        .order_by(ProjectMaterial.created_at.desc())
    )
    materials = material_result.scalars().all()

    evidence_result = await db.execute(
        select(EvidenceDoc)
        .where(
            EvidenceDoc.project_id == project_id,
            EvidenceDoc.storage_path.isnot(None),
        )
        .order_by(EvidenceDoc.created_at.desc())
    )
    evidence_docs = evidence_result.scalars().all()

    summaries: list[dict[str, str]] = []
    for material in materials:
        summaries.append(
            {
                "source_type": "material",
                "filename": material.filename,
                "excerpt": _clean_text(material.content_text),
            }
        )

    evidence_ids = [doc.id for doc in evidence_docs]
    chunk_map: dict[Any, list[str]] = defaultdict(list)
    if evidence_ids:
        chunk_result = await db.execute(
            select(EvidenceChunk)
            .where(EvidenceChunk.evidence_doc_id.in_(evidence_ids))
            .order_by(EvidenceChunk.evidence_doc_id, EvidenceChunk.chunk_index)
        )
        for chunk in chunk_result.scalars().all():
            entries = chunk_map[chunk.evidence_doc_id]
            if len(entries) < MAX_EVIDENCE_CHUNKS_PER_DOC:
                entries.append(chunk.content)

    for evidence in evidence_docs:
        excerpt = _clean_text(" ".join(chunk_map.get(evidence.id, [])))
        summaries.append(
            {
                "source_type": "evidence",
                "filename": evidence.filename or "Untitled",
                "excerpt": excerpt,
            }
        )

    trimmed = [summary for summary in summaries if summary.get("filename")]
    return trimmed[:MAX_SOURCES]


async def generate_project_overview(
    db: AsyncSession,
    initiative: Project,
    user_id: str | None,
) -> str:
    source_summaries = await _load_source_summaries(db, initiative.id)
    if not source_summaries:
        raise ValueError("Upload files to generate a project summary.")

    system_prompt, user_prompt = _build_overview_prompt(initiative, source_summaries)
    response = await acompletion(
        user_id,
        db,
        role=ModelRole.GENERATION,
        complexity=Complexity.STANDARD,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )

    content = (response.choices[0].message.content or "").strip()
    if not content:
        raise RuntimeError("Overview generation returned empty content.")
    return content
