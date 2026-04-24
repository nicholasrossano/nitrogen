"""
Shared evidence processing helpers used by both the evidence upload endpoint
and the Google Drive import endpoint.
"""
import uuid

from sqlalchemy import select, func, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.filename_utils import deduplicate_filename
from app.models.evidence import EvidenceChunk, EvidenceDoc, EvidenceDocStatus
from app.models.initiative import Initiative
from app.services.document_parser import DocumentParserService
from app.services.embeddings import EmbeddingsService


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


async def create_uploaded_doc(
    db: AsyncSession,
    *,
    initiative: Initiative,
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

    filename = await deduplicate_filename(db, initiative.id, filename or "Untitled")

    evidence_doc = EvidenceDoc(
        initiative_id=initiative.id,
        filename=filename,
        file_type=file_type,
        storage_path=storage_path,
        file_size=file_size,
        processing_status=EvidenceDocStatus.UPLOADED.value,
        processing_attempts=0,
    )
    db.add(evidence_doc)
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

    chunk_tuples = parse_file_to_chunks(parser, file_bytes, file_type)

    filename = await deduplicate_filename(db, initiative.id, filename or "Untitled")

    evidence_doc = EvidenceDoc(
        initiative_id=initiative.id,
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

    plain_texts = [t[0] for t in chunk_tuples]
    embeddings = await embeddings_service.embed_texts(plain_texts)

    for i, ((plain, html_content, page_num), embedding) in enumerate(
        zip(chunk_tuples, embeddings)
    ):
        chunk = EvidenceChunk(
            evidence_doc_id=evidence_doc.id,
            chunk_index=i,
            content=plain,
            content_html=html_content,
            page_number=page_num,
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
