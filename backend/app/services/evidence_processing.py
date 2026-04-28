"""
Shared evidence processing helpers used by both the evidence upload endpoint
and the Google Drive import endpoint.
"""
import uuid
from dataclasses import dataclass

from sqlalchemy import select, func, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.filename_utils import deduplicate_filename
from app.core.storage import StorageBackend
from app.models.evidence import EvidenceChunk, EvidenceDoc, EvidenceDocStatus
from app.models.initiative import Initiative
from app.services.document_parser import DocumentParserService
from app.services.embeddings import EmbeddingsService
from app.services.pdf_visual_chunks import extract_pdf_visual_chunks


@dataclass
class EvidenceChunkPayload:
    content: str
    content_html: str | None = None
    page_number: int | None = None
    chunk_kind: str = "text"
    bbox: dict | None = None
    preview_image_path: str | None = None
    preview_mime_type: str | None = None


def parse_file_to_chunks(
    parser: DocumentParserService,
    file_bytes: bytes,
    file_type: str,
) -> list[tuple[str, str | None, int | None]]:
    """
    Parse file bytes into (plain_text, html_or_none, page_number_or_none) tuples.
    Supports: pdf, docx, xlsx/xls, text (txt/csv/rtf).
    """
    if file_type == "pdf":
        pages = parser.parse_pdf_pages(file_bytes)
        page_chunks = parser.chunk_pdf_pages(pages)
        return [(c, None, pg) for c, pg in page_chunks]
    elif file_type == "docx":
        html = parser.parse_docx_html(file_bytes)
        html_chunks = parser.chunk_html(html)
        return [(plain, h, None) for plain, h in html_chunks]
    elif file_type in ("xlsx", "xls"):
        html = parser.parse_xlsx_html(file_bytes)
        html_chunks = parser.chunk_html(html)
        return [(plain, h, None) for plain, h in html_chunks]
    elif file_type == "text":
        text = file_bytes.decode("utf-8", errors="replace")
        return [(c, None, None) for c in parser.chunk_text(text)]
    else:
        raise ValueError(f"Unsupported file_type for processing: {file_type}")


async def parse_file_to_chunk_payloads(
    parser: DocumentParserService,
    file_bytes: bytes,
    file_type: str,
    *,
    storage: StorageBackend | None = None,
    preview_folder: str = "",
) -> list[EvidenceChunkPayload]:
    """Parse bytes into chunk payloads, including visual PDF crops when possible."""

    base_chunks = [
        EvidenceChunkPayload(
            content=plain,
            content_html=html,
            page_number=page_number,
        )
        for plain, html, page_number in parse_file_to_chunks(parser, file_bytes, file_type)
    ]

    if file_type != "pdf" or storage is None:
        return base_chunks

    visual_chunks = []
    for idx, visual in enumerate(extract_pdf_visual_chunks(file_bytes)):
        path = await storage.save(
            visual.image_bytes,
            f"visual-chunk-{idx}.png",
            folder=preview_folder,
        )
        visual_chunks.append(
            EvidenceChunkPayload(
                content=visual.content,
                page_number=visual.page_number,
                chunk_kind="visual",
                bbox=visual.bbox,
                preview_image_path=path,
                preview_mime_type=visual.mime_type,
            )
        )

    return base_chunks + visual_chunks


async def create_uploaded_doc(
    db: AsyncSession,
    *,
    initiative: Initiative | None = None,
    workspace_id: uuid.UUID | None = None,
    filename: str,
    file_type: str,
    storage_path: str | None,
    file_size: int | None,
) -> EvidenceDoc:
    """Fast-path: persist an EvidenceDoc in the ``uploaded`` state.

    Does *not* parse, chunk, or embed.  Callers are responsible for
    scheduling background processing via
    :func:`app.services.evidence_processor.schedule_processing`.
    """

    if initiative is None and workspace_id is None:
        raise ValueError("initiative or workspace_id is required")
    resolved_workspace_id = initiative.workspace_id if initiative is not None else workspace_id
    filename = await deduplicate_filename(
        db,
        initiative.id if initiative is not None else None,
        filename or "Untitled",
        workspace_id=resolved_workspace_id,
    )

    evidence_doc = EvidenceDoc(
        initiative_id=initiative.id if initiative is not None else None,
        workspace_id=resolved_workspace_id,
        filename=filename,
        file_type=file_type,
        storage_path=storage_path,
        file_size=file_size,
        processing_status=EvidenceDocStatus.UPLOADED.value,
        processing_attempts=0,
    )
    db.add(evidence_doc)
    if initiative is not None:
        initiative.touch()
    await db.commit()
    await db.refresh(evidence_doc)
    return evidence_doc


async def store_evidence_doc(
    db: AsyncSession,
    initiative: Initiative,
    file_bytes: bytes,
    filename: str,
    file_type: str,
    storage_path: str | None,
    file_size: int | None,
) -> tuple[EvidenceDoc, int]:
    """
    Synchronous fallback: parse, chunk, embed, and persist an evidence document
    in one shot.  Still used by the Google Drive import/sync path, which runs
    in its own long-lived handler and benefits from deterministic completion.
    The interactive upload endpoint now uses ``create_uploaded_doc`` +
    background processing instead.
    """
    parser = DocumentParserService()
    embeddings_service = EmbeddingsService()

    from app.core.storage import get_uploads_storage

    storage = get_uploads_storage()
    chunk_payloads = await parse_file_to_chunk_payloads(
        parser,
        file_bytes,
        file_type,
        storage=storage,
        preview_folder=f"{initiative.id}/previews",
    )

    filename = await deduplicate_filename(db, initiative.id, filename or "Untitled")

    evidence_doc = EvidenceDoc(
        initiative_id=initiative.id,
        workspace_id=initiative.workspace_id,
        filename=filename,
        file_type=file_type,
        storage_path=storage_path,
        file_size=file_size,
        processing_status=EvidenceDocStatus.PROCESSING.value,
        processing_attempts=1,
    )
    db.add(evidence_doc)
    await db.commit()
    await db.refresh(evidence_doc)

    plain_texts = [payload.content for payload in chunk_payloads]
    embeddings = await embeddings_service.embed_texts(plain_texts)

    for i, (payload, embedding) in enumerate(zip(chunk_payloads, embeddings)):
        chunk = EvidenceChunk(
            evidence_doc_id=evidence_doc.id,
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
        db.add(chunk)

    evidence_doc.processing_status = EvidenceDocStatus.INDEXED.value
    initiative.evidence_ready = True
    initiative.touch()
    await db.commit()

    chunk_count_result = await db.execute(
        select(func.count(EvidenceChunk.id)).where(
            EvidenceChunk.evidence_doc_id == evidence_doc.id
        )
    )
    chunk_count = chunk_count_result.scalar() or 0

    return evidence_doc, chunk_count


async def delete_evidence_doc_chunks(
    db: AsyncSession, evidence_doc_id: uuid.UUID
) -> None:
    """Delete all chunks for an evidence doc (called before re-indexing on sync)."""
    await db.execute(
        sql_delete(EvidenceChunk).where(
            EvidenceChunk.evidence_doc_id == evidence_doc_id
        )
    )
    await db.commit()
