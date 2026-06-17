"""Async evidence document processor.

Decouples the (expensive) parse → chunk → embed pipeline from the HTTP upload
handler.  Uploads now return immediately once the bytes are safely stored on
disk; this assessment advances the :class:`EvidenceDoc` through a small state
machine:

    uploaded → processing → lightweight_ready → indexed
                         ↘ failed

It uses its own DB session per job so the request-scoped session tied to the
upload endpoint can be closed right away.  The ``reclaim_stale_jobs`` helper
makes the processor restart-safe: on startup (or any time an admin calls it),
it re-enqueues anything stuck in ``processing``/``uploaded`` so a crashed
worker never leaves documents in limbo.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.storage import get_uploads_storage, load_upload
from app.models.evidence import EvidenceChunk, EvidenceDoc, EvidenceDocStatus
from app.models.initiative import Initiative
from app.services.document_parser import DocumentParserService
from app.services.embeddings import EmbeddingsService
from app.services.assumptions import AssumptionActor, extract_assumptions_from_sources
from app.services.evidence_processing import parse_file_to_chunk_payloads

logger = logging.getLogger(__name__)


MAX_PROCESSING_ATTEMPTS = 3
PREVIEW_CHAR_LIMIT = 800
STALE_JOB_THRESHOLD = timedelta(minutes=10)

# Onboarding assessment-proposal gating: how long we wait for at least one uploaded
# doc to reach the lightweight milestone before falling through to proposal
# anyway.  30 s covers typical parse times for mid-sized PDFs/DOCX without
# stalling the user flow if something is stuck.
LIGHTWEIGHT_READY_TIMEOUT_SECONDS = 30.0
LIGHTWEIGHT_READY_POLL_SECONDS = 0.5


# ---------------------------------------------------------------------------
# Lightweight extraction
# ---------------------------------------------------------------------------


def _extract_preview(
    parser: DocumentParserService, file_bytes: bytes, file_type: str
) -> str | None:
    """Return a short preview string for onboarding-level signal.

    Best-effort: any parsing failure returns ``None`` — we'd rather have a
    weak filename/type-only signal than deadlock onboarding on one bad doc.
    """
    try:
        if file_type == "pdf":
            pages = parser.parse_pdf_pages(file_bytes)
            if not pages:
                return None
            first_page_text, _ = pages[0]
            return (first_page_text or "").strip()[:PREVIEW_CHAR_LIMIT] or None
        if file_type == "docx":
            text = parser.parse_docx(file_bytes)
            return (text or "").strip()[:PREVIEW_CHAR_LIMIT] or None
        if file_type == "pptx":
            text = parser.parse_pptx(file_bytes)
            return (text or "").strip()[:PREVIEW_CHAR_LIMIT] or None
        if file_type in ("xlsx", "xls"):
            text = parser.parse_xlsx(file_bytes)
            return (text or "").strip()[:PREVIEW_CHAR_LIMIT] or None
        if file_type == "text":
            text = file_bytes.decode("utf-8", errors="replace")
            return text.strip()[:PREVIEW_CHAR_LIMIT] or None
    except Exception as exc:  # noqa: BLE001 — preview is best-effort.
        logger.warning(
            "Preview extraction failed for file_type=%s: %s", file_type, exc
        )
    return None


# ---------------------------------------------------------------------------
# Core processing pipeline (runs in its own DB session)
# ---------------------------------------------------------------------------


async def _load_doc(db: AsyncSession, doc_id: UUID) -> EvidenceDoc | None:
    result = await db.execute(
        select(EvidenceDoc).where(EvidenceDoc.id == doc_id)
    )
    return result.scalar_one_or_none()


async def _load_initiative(
    db: AsyncSession, initiative_id: UUID
) -> Initiative | None:
    result = await db.execute(
        select(Initiative).where(Initiative.id == initiative_id)
    )
    return result.scalar_one_or_none()


async def _mark_failed(
    db: AsyncSession, doc: EvidenceDoc, error: str
) -> None:
    doc.processing_status = EvidenceDocStatus.FAILED.value
    doc.processing_error = error[:2000]
    doc.processing_completed_at = datetime.now(timezone.utc)
    await db.commit()


async def process_evidence_doc(
    doc_id: UUID, *, user_id: str | None = None
) -> None:
    """Run the full parse → chunk → embed pipeline for one evidence doc.

    Designed to be called from a FastAPI ``BackgroundTasks`` queue or from
    ``reclaim_stale_jobs``.  Always uses its own DB session so it is safe
    to run after the originating request has returned.
    """

    async with AsyncSessionLocal() as db:
        doc = await _load_doc(db, doc_id)
        if doc is None:
            logger.warning("Evidence doc %s not found — skipping processing", doc_id)
            return

        if doc.is_indexed:
            logger.info(
                "Evidence doc %s already indexed — skipping re-processing", doc_id
            )
            return

        initiative = None
        if doc.initiative_id is not None:
            initiative = await _load_initiative(db, doc.initiative_id)
            if initiative is None:
                await _mark_failed(db, doc, "Initiative not found")
                return

        doc.processing_status = EvidenceDocStatus.PROCESSING.value
        doc.processing_attempts = (doc.processing_attempts or 0) + 1
        doc.processing_started_at = datetime.now(timezone.utc)
        doc.processing_error = None
        await db.commit()

        storage = get_uploads_storage()
        parser = DocumentParserService()

        try:
            if not doc.storage_path:
                raise ValueError("Evidence doc missing storage_path")
            file_bytes = await load_upload(doc.storage_path)
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "Failed to load evidence doc %s bytes: %s", doc_id, exc, exc_info=True
            )
            await _mark_failed(db, doc, f"Failed to load file: {exc}")
            return

        file_type = doc.file_type or ""

        # --- Lightweight milestone --------------------------------------
        try:
            preview = _extract_preview(parser, file_bytes, file_type)
        except Exception:  # defensive — _extract_preview already handles errors
            preview = None
        doc.preview_text = preview
        doc.processing_status = EvidenceDocStatus.LIGHTWEIGHT_READY.value
        await db.commit()

        # --- Full indexing ----------------------------------------------
        try:
            chunk_payloads = await parse_file_to_chunk_payloads(
                parser,
                file_bytes,
                file_type,
                storage=storage,
                preview_folder=(
                    f"{initiative.id}/previews"
                    if initiative is not None
                    else f"workspaces/{doc.workspace_id}/previews"
                ),
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "Parsing failed for evidence doc %s: %s", doc_id, exc, exc_info=True
            )
            await _mark_failed(db, doc, f"Parsing failed: {exc}")
            return

        try:
            embeddings_service = EmbeddingsService(user_id=user_id, db=db)
            plain_texts = [payload.content for payload in chunk_payloads]
            embeddings = await embeddings_service.embed_texts(plain_texts)

            for i, (payload, embedding) in enumerate(zip(chunk_payloads, embeddings)):
                db.add(
                    EvidenceChunk(
                        evidence_doc_id=doc.id,
                        chunk_index=i,
                        content=payload.content,
                        content_html=payload.content_html,
                        page_number=payload.page_number,
                        chunk_kind=payload.chunk_kind,
                        bbox=payload.bbox,
                        preview_image_path=payload.preview_image_path,
                        preview_mime_type=payload.preview_mime_type,
                        embedding=embedding,
                    )
                )

            doc.processing_status = EvidenceDocStatus.INDEXED.value
            doc.processing_completed_at = datetime.now(timezone.utc)
            doc.processing_error = None

            # Keep legacy flag in sync: "at least one doc is fully indexed".
            if initiative is not None:
                initiative.evidence_ready = True
                initiative.touch()
                await db.flush()
                try:
                    await extract_assumptions_from_sources(
                        db,
                        initiative,
                        actor=AssumptionActor(user_id=user_id, email=user_id),
                    )
                except Exception:
                    logger.warning("Could not refresh assumptions after evidence processing", exc_info=True)
            await db.commit()
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "Embedding/index failed for evidence doc %s: %s",
                doc_id,
                exc,
                exc_info=True,
            )
            await db.rollback()
            # Re-fetch doc in the fresh transaction to mark failure.
            doc = await _load_doc(db, doc_id)
            if doc is not None:
                await _mark_failed(db, doc, f"Indexing failed: {exc}")


def schedule_processing(
    doc_id: UUID, *, user_id: str | None = None
) -> asyncio.Task:
    """Fire-and-forget the processor for a single doc.

    Returns the scheduled task so callers/tests can await it if they want
    deterministic behaviour.  Exceptions are logged via ``process_evidence_doc``
    itself — we don't want them to crash the event loop.
    """

    async def _runner() -> None:
        try:
            await process_evidence_doc(doc_id, user_id=user_id)
        except Exception:  # noqa: BLE001 — safety net; individual steps already log.
            logger.exception("Unhandled error while processing evidence doc %s", doc_id)

    return asyncio.create_task(_runner())


# ---------------------------------------------------------------------------
# Onboarding readiness helpers
# ---------------------------------------------------------------------------


async def _count_docs_by_state(
    db: AsyncSession, initiative_id: UUID
) -> tuple[int, int]:
    """Return (pending, lightweight_ready_or_better) doc counts for an initiative.

    ``pending`` counts docs that are still between upload and the lightweight
    milestone.  Failed docs aren't counted as pending — they can't block
    onboarding.
    """
    from sqlalchemy import func

    result = await db.execute(
        select(EvidenceDoc.processing_status, func.count()).where(
            EvidenceDoc.initiative_id == initiative_id
        ).group_by(EvidenceDoc.processing_status)
    )
    pending = 0
    ready = 0
    for status_value, count in result.all():
        if status_value in (
            EvidenceDocStatus.UPLOADED.value,
            EvidenceDocStatus.PROCESSING.value,
        ):
            pending += count
        elif status_value in (
            EvidenceDocStatus.LIGHTWEIGHT_READY.value,
            EvidenceDocStatus.INDEXED.value,
        ):
            ready += count
    return pending, ready


async def await_lightweight_readiness(
    initiative_id: UUID,
    *,
    timeout_seconds: float = LIGHTWEIGHT_READY_TIMEOUT_SECONDS,
    poll_seconds: float = LIGHTWEIGHT_READY_POLL_SECONDS,
) -> bool:
    """Wait until at least one evidence doc for ``initiative_id`` is ready.

    "Ready" means :attr:`EvidenceDoc.processing_status` has reached the
    lightweight milestone (or full indexing).  Returns ``True`` if we saw a
    ready doc, ``False`` on timeout.  When the initiative has no pending docs
    at all — e.g. the user chose "I don't have any documents" — returns
    immediately with ``True`` so the caller can proceed.

    Uses its own short-lived sessions so the caller's session isn't held open
    while we poll.
    """

    deadline = asyncio.get_event_loop().time() + timeout_seconds

    while True:
        async with AsyncSessionLocal() as db:
            pending, ready = await _count_docs_by_state(db, initiative_id)

        if ready > 0:
            return True
        if pending == 0:
            # No docs in flight — nothing to wait for.
            return True
        if asyncio.get_event_loop().time() >= deadline:
            logger.warning(
                "await_lightweight_readiness timed out for initiative %s "
                "(pending=%d, ready=%d)",
                initiative_id,
                pending,
                ready,
            )
            return False
        await asyncio.sleep(poll_seconds)


# ---------------------------------------------------------------------------
# Restart-safe reclaim
# ---------------------------------------------------------------------------


async def reclaim_stale_jobs() -> int:
    """Re-enqueue any docs stuck in uploaded/processing beyond the threshold.

    Runs on app startup (or on demand).  Docs that exceeded
    ``MAX_PROCESSING_ATTEMPTS`` are marked failed instead of retried so they
    don't loop forever.  Returns the number of docs rescheduled.
    """

    cutoff = datetime.now(timezone.utc) - STALE_JOB_THRESHOLD
    rescheduled = 0

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(EvidenceDoc).where(
                EvidenceDoc.processing_status.in_(
                    [
                        EvidenceDocStatus.UPLOADED.value,
                        EvidenceDocStatus.PROCESSING.value,
                        EvidenceDocStatus.LIGHTWEIGHT_READY.value,
                    ]
                ),
                EvidenceDoc.created_at < cutoff,
            )
        )
        stale = result.scalars().all()

        for doc in stale:
            if (doc.processing_attempts or 0) >= MAX_PROCESSING_ATTEMPTS:
                doc.processing_status = EvidenceDocStatus.FAILED.value
                doc.processing_error = (
                    doc.processing_error
                    or "Exceeded maximum processing attempts"
                )
                doc.processing_completed_at = datetime.now(timezone.utc)
                continue
            rescheduled += 1

        await db.commit()

        for doc in stale:
            if doc.processing_status != EvidenceDocStatus.FAILED.value:
                schedule_processing(doc.id)

    if rescheduled:
        logger.info("Rescheduled %d stale evidence doc jobs", rescheduled)
    return rescheduled
