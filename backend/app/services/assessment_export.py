"""Shared assessment export orchestration: enrichment, cache, and iteration."""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.assessments.base import BaseAssessment
from app.models.assessment_instance import AssessmentInstance
from app.models.project_material import ProjectMaterial
from app.services.assessment_workflow_service import save_workflow_state

logger = logging.getLogger(__name__)

EXPORT_IN_PROGRESS_KEY = "export_in_progress"


class ExportInProgressError(RuntimeError):
    """Raised when another export is already running for this instance."""


def fingerprint_payload(payload: Any) -> str:
    """Stable SHA-256 fingerprint for JSON-serializable export inputs."""
    encoded = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _cached_writeup(state: dict[str, Any]) -> dict[str, Any]:
    cached_exports = state.get("cached_exports")
    if not isinstance(cached_exports, dict):
        return {}
    writeup = cached_exports.get("writeup")
    return writeup if isinstance(writeup, dict) else {}


def begin_export_lock(inst: AssessmentInstance, state: dict[str, Any]) -> None:
    """Mark export as in progress or raise if already locked."""
    if state.get(EXPORT_IN_PROGRESS_KEY):
        raise ExportInProgressError("Export already in progress")
    state[EXPORT_IN_PROGRESS_KEY] = True
    save_workflow_state(inst, state, increment_version=False, user_initiated=False)


def clear_export_lock(inst: AssessmentInstance, state: dict[str, Any]) -> None:
    """Clear the export-in-progress flag."""
    state[EXPORT_IN_PROGRESS_KEY] = False
    save_workflow_state(inst, state, increment_version=False, user_initiated=False)


async def resolve_writeup_content(
    *,
    assessment: BaseAssessment,
    inst: AssessmentInstance,
    state: dict[str, Any],
    confirmed_stages: dict[str, Any],
    context: dict[str, Any],
    db: AsyncSession,
    user_id: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Run enrichment, then return writeup content from cache or LLM.

    Returns ``(content, confirmed_stages)`` after enrichment injection.
    """
    confirmed_stages, enrichment_changed = await assessment.prepare_export_enrichment(
        state=state,
        confirmed_stages=confirmed_stages,
        context=context,
        db=db,
        project_id=inst.project_id,
        user_id=user_id,
    )
    if enrichment_changed:
        if state.get("cached_exports"):
            state["cached_exports"] = {}
        save_workflow_state(inst, state, increment_version=True, user_initiated=True)
        await db.commit()

    fingerprint = assessment.export_input_fingerprint(confirmed_stages, state)
    cached = _cached_writeup(state)
    cached_content = cached.get("content") if isinstance(cached.get("content"), dict) else None
    cache_valid = (
        bool(cached_content)
        and not cached.get("invalidated")
        and cached.get("fingerprint") == fingerprint
    )

    if cache_valid:
        logger.info("Returning cached write-up for instance %s", inst.id)
        return cached_content, confirmed_stages

    previous_content = cached_content
    previous_fingerprint = cached.get("fingerprint") if isinstance(cached.get("fingerprint"), str) else None
    change_summary = assessment.summarize_export_input_changes(
        previous_fingerprint,
        confirmed_stages,
        state,
    )

    try:
        content = await assessment.generate_writeup_content(
            confirmed_stages,
            context,
            previous_content=previous_content,
            change_summary=change_summary if previous_content else None,
        )
    except TypeError:
        # Older module signatures without iteration kwargs.
        content = await assessment.generate_writeup_content(confirmed_stages, context)

    if not isinstance(content, dict):
        content = {"title": assessment.definition.name}

    state.setdefault("cached_exports", {})["writeup"] = {
        "content": content,
        "fingerprint": fingerprint,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "invalidated": False,
        "iterated_from": previous_fingerprint if previous_content else None,
    }
    save_workflow_state(inst, state, increment_version=False, user_initiated=True)
    await db.commit()
    return content, confirmed_stages


async def generate_assessment_export_bytes(
    *,
    assessment: BaseAssessment,
    inst: AssessmentInstance,
    state: dict[str, Any],
    confirmed_stages: dict[str, Any],
    context: dict[str, Any],
    db: AsyncSession,
    user_id: str | None = None,
) -> bytes:
    """Produce export bytes with enrichment + writeup cache when supported."""
    if assessment.supports_cached_writeup():
        content, _stages = await resolve_writeup_content(
            assessment=assessment,
            inst=inst,
            state=state,
            confirmed_stages=confirmed_stages,
            context=context,
            db=db,
            user_id=user_id,
        )
        from app.services.docx_exporter import DocxExporterService

        return DocxExporterService().generate_assessment_docx(
            content=content,
            initiative_title=context.get("project_title", ""),
        )

    return await assessment.generate_export(confirmed_stages, context)


REPORT_MATERIAL_ID_KEY = "report_material_id"
MATERIAL_ORIGIN_GENERATED = "generated"
MATERIAL_ORIGIN_UPLOAD = "upload"


async def upsert_assessment_report_material(
    *,
    db: AsyncSession,
    inst: AssessmentInstance,
    state: dict[str, Any],
    content: bytes,
    filename: str,
    workspace_id: UUID,
) -> tuple[ProjectMaterial, bool]:
    """Create or replace the single project Files DOCX for this assessment instance.

    Returns ``(material, created)``. The material id is stored on workflow state so
    re-running Report updates the same Files row instead of creating duplicates.
    Generated reports are tagged ``origin=generated`` so Files lists them under
    Generated rather than Uploaded.
    """
    from sqlalchemy import select

    from app.core.filename_utils import deduplicate_filename
    from app.core.storage import get_uploads_storage
    from app.services.document_parser import DocumentParserService

    material: ProjectMaterial | None = None
    raw_id = state.get(REPORT_MATERIAL_ID_KEY)
    if raw_id:
        try:
            material_id = UUID(str(raw_id))
        except (TypeError, ValueError):
            material_id = None
        else:
            result = await db.execute(
                select(ProjectMaterial).where(ProjectMaterial.id == material_id)
            )
            candidate = result.scalar_one_or_none()
            if candidate is not None and candidate.project_id == inst.project_id:
                material = candidate

    storage = get_uploads_storage()
    folder = f"{inst.project_id}/materials"
    storage_path = await storage.save(content, filename, folder=folder)

    content_text = None
    try:
        content_text = DocumentParserService().parse_docx(content)
    except Exception:
        logger.warning("Could not extract text from assessment report %s", filename, exc_info=True)

    if material is not None:
        old_path = material.storage_path
        material.storage_path = storage_path
        material.file_size = len(content)
        material.file_type = "docx"
        material.content_text = content_text
        material.origin = MATERIAL_ORIGIN_GENERATED
        if old_path and old_path != storage_path:
            await storage.delete(old_path)
        await db.flush()
        return material, False

    unique_filename = await deduplicate_filename(db, inst.project_id, filename)
    material = ProjectMaterial(
        project_id=inst.project_id,
        workspace_id=workspace_id,
        filename=unique_filename,
        file_type="docx",
        storage_path=storage_path,
        file_size=len(content),
        content_text=content_text,
        origin=MATERIAL_ORIGIN_GENERATED,
    )
    db.add(material)
    await db.flush()
    state[REPORT_MATERIAL_ID_KEY] = str(material.id)
    save_workflow_state(inst, state, increment_version=False, user_initiated=True)
    return material, True
