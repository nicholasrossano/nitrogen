from fastapi import APIRouter, Depends, HTTPException, Request, status, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete as sql_delete
from uuid import UUID
from typing import Optional

from app.core.database import get_db
from app.core.auth import get_current_user, AuthUser
from app.core.permissions import require_editor, require_viewer
from app.core.storage import get_uploads_storage
from app.core.filename_utils import deduplicate_filename, safe_content_disposition, validate_file_magic
from app.models.evidence import EvidenceDoc, EvidenceChunk, EvidenceDocStatus
from app.schemas.evidence import (
    EvidenceTextInput,
    EvidenceDocResponse,
    EvidenceUploadResponse,
)
from app.services.evidence_processing import create_uploaded_doc
from app.services.evidence_processor import schedule_processing
from app.services.workspaces import require_workspace_member
from app.core.rate_limit import limiter

router = APIRouter()


_ALLOWED_UPLOAD_TYPES = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
}

_MAX_UPLOAD_BYTES = 50 * 1024 * 1024


async def _require_evidence_viewer(db: AsyncSession, evidence_doc: EvidenceDoc, user: AuthUser) -> None:
    if evidence_doc.initiative_id is not None:
        await require_viewer(db, evidence_doc.initiative_id, user)
        return
    await require_workspace_member(db, evidence_doc.workspace_id, user.uid)


async def _require_evidence_editor(db: AsyncSession, evidence_doc: EvidenceDoc, user: AuthUser) -> None:
    if evidence_doc.initiative_id is not None:
        await require_editor(db, evidence_doc.initiative_id, user)
        return
    await require_workspace_member(db, evidence_doc.workspace_id, user.uid)


@router.post("/initiatives/{initiative_id}/evidence", response_model=EvidenceUploadResponse)
@limiter.limit("120/minute")
async def upload_evidence(
    request: Request,
    initiative_id: str,
    file: Optional[UploadFile] = File(None),
    text_content: Optional[str] = Form(None),
    text_title: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Upload a file (or paste text) as evidence.

    This endpoint is fast by design: it validates, stores the bytes on disk,
    creates an :class:`EvidenceDoc` row in the ``uploaded`` state, and
    schedules background parsing/embedding.  Clients should watch the
    document's ``processing_status`` for the transition to
    ``lightweight_ready`` / ``indexed``.
    """

    initiative = await require_editor(db, initiative_id, user)

    if not file and not text_content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must provide either a file or text content",
        )

    storage = get_uploads_storage()

    if file:
        file_type = _ALLOWED_UPLOAD_TYPES.get(file.content_type or "")
        if not file_type:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File must be PDF, DOCX, or Excel (XLSX/XLS)",
            )

        content = await file.read()
        if len(content) > _MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="File size exceeds 50 MB limit",
            )
        if not validate_file_magic(content, file.content_type or ""):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File content does not match declared type",
            )

        storage_path = await storage.save(
            content, file.filename, folder=str(initiative.id)
        )

        evidence_doc = await create_uploaded_doc(
            db,
            initiative=initiative,
            filename=file.filename or "Untitled",
            file_type=file_type,
            storage_path=storage_path,
            file_size=len(content),
        )

        # Kick off the parse/embed pipeline in the background; the response
        # returns immediately.
        schedule_processing(evidence_doc.id, user_id=user.uid)

        return EvidenceUploadResponse(
            success=True,
            document=EvidenceDocResponse(
                id=evidence_doc.id,
                filename=evidence_doc.filename,
                file_type=evidence_doc.file_type,
                file_size=evidence_doc.file_size,
                created_at=evidence_doc.created_at,
                chunk_count=0,
                processing_status=evidence_doc.processing_status,
                processing_error=None,
            ),
            message="Upload received — processing in background",
            stage=initiative.stage,
            evidence_ready=initiative.evidence_ready,
        )

    # --- Text paste path -------------------------------------------------
    # Text pastes are small and synchronous — keep the legacy behaviour
    # (chunk + embed inline) so callers see the text immediately available.
    from app.services.document_parser import DocumentParserService
    from app.services.embeddings import EmbeddingsService

    parser = DocumentParserService()
    embeddings_service = EmbeddingsService(user_id=user.uid, db=db)

    text = text_content or ""
    filename = text_title or "Pasted text"
    file_type = "text"
    chunk_tuples = [(c, None, None) for c in parser.chunk_text(text)]

    filename = await deduplicate_filename(db, initiative.id, filename)

    evidence_doc = EvidenceDoc(
        initiative_id=initiative.id,
        workspace_id=initiative.workspace_id,
        filename=filename,
        file_type=file_type,
        storage_path=None,
        file_size=None,
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
        db.add(
            EvidenceChunk(
                evidence_doc_id=evidence_doc.id,
                chunk_index=i,
                content=plain,
                content_html=html_content,
                page_number=page_num,
                embedding=embedding,
            )
        )

    evidence_doc.processing_status = EvidenceDocStatus.INDEXED.value
    evidence_doc.preview_text = (text or "").strip()[:800] or None
    initiative.evidence_ready = True
    initiative.touch()
    await db.commit()

    return EvidenceUploadResponse(
        success=True,
        document=EvidenceDocResponse(
            id=evidence_doc.id,
            filename=evidence_doc.filename,
            file_type=evidence_doc.file_type,
            file_size=evidence_doc.file_size,
            created_at=evidence_doc.created_at,
            chunk_count=len(chunk_tuples),
            processing_status=evidence_doc.processing_status,
            processing_error=None,
        ),
        message=f"Evidence processed: {len(chunk_tuples)} chunks created",
        stage=initiative.stage,
        evidence_ready=initiative.evidence_ready,
    )


@router.post("/initiatives/{initiative_id}/evidence/text", response_model=EvidenceUploadResponse)
async def paste_evidence_text(
    request: Request,
    initiative_id: str,
    data: EvidenceTextInput,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Paste text as evidence (alternative to file upload)"""
    # Reuse upload endpoint logic with text
    return await upload_evidence(
        request=request,
        initiative_id=initiative_id,
        file=None,
        text_content=data.content,
        text_title=data.title,
        db=db,
        user=user,
    )


@router.post("/workspaces/{workspace_id}/evidence", response_model=EvidenceUploadResponse)
@limiter.limit("120/minute")
async def upload_workspace_evidence(
    request: Request,
    workspace_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Upload a file as workspace-level guidance/context."""
    await require_workspace_member(db, workspace_id, user.uid)

    file_type = _ALLOWED_UPLOAD_TYPES.get(file.content_type or "")
    if not file_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be PDF, DOCX, or Excel (XLSX/XLS)",
        )

    content = await file.read()
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File size exceeds 50 MB limit",
        )
    if not validate_file_magic(content, file.content_type or ""):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File content does not match declared type",
        )

    storage = get_uploads_storage()
    storage_path = await storage.save(
        content,
        file.filename,
        folder=f"workspaces/{workspace_id}",
    )
    evidence_doc = await create_uploaded_doc(
        db,
        workspace_id=workspace_id,
        filename=file.filename or "Untitled",
        file_type=file_type,
        storage_path=storage_path,
        file_size=len(content),
    )
    schedule_processing(evidence_doc.id, user_id=user.uid)

    return EvidenceUploadResponse(
        success=True,
        document=EvidenceDocResponse(
            id=evidence_doc.id,
            filename=evidence_doc.filename,
            file_type=evidence_doc.file_type,
            file_size=evidence_doc.file_size,
            created_at=evidence_doc.created_at,
            chunk_count=0,
            processing_status=evidence_doc.processing_status,
            processing_error=None,
        ),
        message="Upload received — processing in background",
        stage="workspace",
        evidence_ready=True,
    )


@router.get("/workspaces/{workspace_id}/evidence", response_model=list[EvidenceDocResponse])
async def list_workspace_evidence(
    workspace_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """List workspace-level evidence documents."""
    await require_workspace_member(db, workspace_id, user.uid)
    stmt = (
        select(
            EvidenceDoc,
            func.count(EvidenceChunk.id).label("chunk_count"),
        )
        .outerjoin(EvidenceChunk, EvidenceChunk.evidence_doc_id == EvidenceDoc.id)
        .where(
            EvidenceDoc.workspace_id == workspace_id,
            EvidenceDoc.initiative_id.is_(None),
        )
        .group_by(EvidenceDoc.id)
        .order_by(EvidenceDoc.created_at.desc())
    )
    rows = (await db.execute(stmt)).all()
    return [
        EvidenceDocResponse(
            id=doc.id,
            filename=doc.filename,
            file_type=doc.file_type,
            file_size=doc.file_size,
            created_at=doc.created_at,
            chunk_count=chunk_count,
            processing_status=doc.processing_status,
            processing_error=doc.processing_error,
        )
        for doc, chunk_count in rows
    ]


@router.get("/initiatives/{initiative_id}/evidence", response_model=list[EvidenceDocResponse])
async def list_evidence(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """List evidence documents for an initiative"""
    initiative = await require_viewer(db, initiative_id, user)

    # Get evidence docs with chunk counts in a single query
    stmt = (
        select(
            EvidenceDoc,
            func.count(EvidenceChunk.id).label("chunk_count"),
        )
        .outerjoin(EvidenceChunk, EvidenceChunk.evidence_doc_id == EvidenceDoc.id)
        .where(EvidenceDoc.initiative_id == initiative.id)
        .group_by(EvidenceDoc.id)
    )
    rows = (await db.execute(stmt)).all()

    return [
        EvidenceDocResponse(
            id=doc.id,
            filename=doc.filename,
            file_type=doc.file_type,
            file_size=doc.file_size,
            created_at=doc.created_at,
            chunk_count=chunk_count,
            processing_status=doc.processing_status,
            processing_error=doc.processing_error,
        )
        for doc, chunk_count in rows
    ]


@router.get("/evidence/{evidence_id}/content")
async def get_evidence_content(
    evidence_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Get the full content of an evidence document"""
    # Get evidence doc
    result = await db.execute(
        select(EvidenceDoc).where(EvidenceDoc.id == evidence_id)
    )
    evidence_doc = result.scalar_one_or_none()
    
    if not evidence_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence document not found",
        )

    await _require_evidence_viewer(db, evidence_doc, user)

    # Get only the columns we need (exclude embedding vectors)
    chunks_result = await db.execute(
        select(
            EvidenceChunk.content,
        )
        .where(EvidenceChunk.evidence_doc_id == evidence_id)
        .order_by(EvidenceChunk.chunk_index)
    )
    rows = chunks_result.all()

    full_content = "\n\n".join([row.content for row in rows])

    return {
        "id": str(evidence_doc.id),
        "filename": evidence_doc.filename,
        "file_type": evidence_doc.file_type,
        "content": full_content,
        "chunk_count": len(rows),
    }


@router.get("/evidence/{evidence_id}/chunks")
async def get_evidence_chunks(
    evidence_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Return individual chunks for a document, enabling scroll-to and highlighting."""
    result = await db.execute(
        select(EvidenceDoc).where(EvidenceDoc.id == evidence_id)
    )
    evidence_doc = result.scalar_one_or_none()

    if not evidence_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence document not found",
        )

    await _require_evidence_viewer(db, evidence_doc, user)

    chunks_result = await db.execute(
        select(
            EvidenceChunk.id,
            EvidenceChunk.chunk_index,
            EvidenceChunk.content,
            EvidenceChunk.content_html,
            EvidenceChunk.page_number,
            EvidenceChunk.chunk_kind,
            EvidenceChunk.bbox,
            EvidenceChunk.preview_image_path,
            EvidenceChunk.preview_mime_type,
        )
        .where(EvidenceChunk.evidence_doc_id == evidence_id)
        .order_by(EvidenceChunk.chunk_index)
    )
    chunks = chunks_result.all()

    return {
        "id": str(evidence_doc.id),
        "filename": evidence_doc.filename,
        "file_type": evidence_doc.file_type,
        "chunks": [
            {
                "id": str(c.id),
                "chunk_index": c.chunk_index,
                "content": c.content,
                "content_html": c.content_html,
                "page_number": c.page_number,
                "chunk_kind": c.chunk_kind,
                "bbox": c.bbox,
                "preview_image_url": (
                    f"/api/v1/evidence/{evidence_id}/chunks/{c.id}/preview"
                    if c.preview_image_path
                    else None
                ),
                "preview_mime_type": c.preview_mime_type,
            }
            for c in chunks
        ],
    }


@router.get("/evidence/{evidence_id}/chunks/{chunk_id}")
async def get_evidence_chunk(
    evidence_id: UUID,
    chunk_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Return one evidence chunk for lightweight citation previews."""
    result = await db.execute(
        select(EvidenceDoc).where(EvidenceDoc.id == evidence_id)
    )
    evidence_doc = result.scalar_one_or_none()

    if not evidence_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence document not found",
        )

    await _require_evidence_viewer(db, evidence_doc, user)

    chunk_result = await db.execute(
        select(
            EvidenceChunk.id,
            EvidenceChunk.chunk_index,
            EvidenceChunk.content,
            EvidenceChunk.content_html,
            EvidenceChunk.page_number,
            EvidenceChunk.chunk_kind,
            EvidenceChunk.bbox,
            EvidenceChunk.preview_image_path,
            EvidenceChunk.preview_mime_type,
        )
        .where(
            EvidenceChunk.evidence_doc_id == evidence_id,
            EvidenceChunk.id == chunk_id,
        )
    )
    chunk = chunk_result.first()
    if not chunk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence chunk not found",
        )

    return {
        "id": str(evidence_doc.id),
        "filename": evidence_doc.filename,
        "file_type": evidence_doc.file_type,
        "chunk": {
            "id": str(chunk.id),
            "chunk_index": chunk.chunk_index,
            "content": chunk.content,
            "content_html": chunk.content_html,
            "page_number": chunk.page_number,
            "chunk_kind": chunk.chunk_kind,
            "bbox": chunk.bbox,
            "preview_image_url": (
                f"/api/v1/evidence/{evidence_id}/chunks/{chunk.id}/preview"
                if chunk.preview_image_path
                else None
            ),
            "preview_mime_type": chunk.preview_mime_type,
        },
    }


@router.get("/evidence/{evidence_id}/chunks/{chunk_id}/preview")
async def download_evidence_chunk_preview(
    evidence_id: UUID,
    chunk_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Download a cropped visual preview image for an evidence chunk."""
    result = await db.execute(
        select(EvidenceDoc, EvidenceChunk)
        .join(EvidenceChunk, EvidenceChunk.evidence_doc_id == EvidenceDoc.id)
        .where(EvidenceDoc.id == evidence_id, EvidenceChunk.id == chunk_id)
    )
    row = result.first()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence chunk preview not found",
        )

    evidence_doc, chunk = row
    await _require_evidence_viewer(db, evidence_doc, user)

    if not chunk.preview_image_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence chunk preview not available",
        )

    storage = get_uploads_storage()
    try:
        preview_bytes = await storage.load(chunk.preview_image_path)
    except (FileNotFoundError, Exception) as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence chunk preview file not available",
        ) from exc

    return Response(
        content=preview_bytes,
        media_type=chunk.preview_mime_type or "image/png",
    )


EVIDENCE_CONTENT_TYPE_MAP = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xls": "application/vnd.ms-excel",
}


@router.get("/evidence/{evidence_id}/download")
async def download_evidence(
    evidence_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Download an uploaded evidence document."""
    result = await db.execute(
        select(EvidenceDoc).where(EvidenceDoc.id == evidence_id)
    )
    evidence_doc = result.scalar_one_or_none()

    if not evidence_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence document not found",
        )

    await _require_evidence_viewer(db, evidence_doc, user)

    if not evidence_doc.storage_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not available for download",
        )

    storage = get_uploads_storage()
    try:
        file_bytes = await storage.load(evidence_doc.storage_path)
    except (FileNotFoundError, Exception) as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not available — it may have been uploaded in a different environment.",
        ) from exc

    media_type = EVIDENCE_CONTENT_TYPE_MAP.get(
        evidence_doc.file_type or "", "application/octet-stream"
    )

    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={
            "Content-Disposition": safe_content_disposition(evidence_doc.filename or "file")
        },
    )


@router.delete("/evidence/{evidence_id}")
async def delete_evidence(
    evidence_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Delete an evidence document and its chunks"""
    # Get evidence doc
    result = await db.execute(
        select(EvidenceDoc).where(EvidenceDoc.id == evidence_id)
    )
    evidence_doc = result.scalar_one_or_none()
    
    if not evidence_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence document not found",
        )
    
    await _require_evidence_editor(db, evidence_doc, user)

    storage = get_uploads_storage()
    if evidence_doc.storage_path:
        await storage.delete(evidence_doc.storage_path)

    preview_result = await db.execute(
        select(EvidenceChunk.preview_image_path).where(
            EvidenceChunk.evidence_doc_id == evidence_id,
            EvidenceChunk.preview_image_path.isnot(None),
        )
    )
    for (preview_path,) in preview_result.all():
        if preview_path:
            await storage.delete(preview_path)

    # Delete all chunks first
    await db.execute(
        sql_delete(EvidenceChunk).where(EvidenceChunk.evidence_doc_id == evidence_id)
    )
    
    # Delete the evidence doc
    await db.delete(evidence_doc)
    await db.commit()
    
    return {"success": True, "message": "Evidence document deleted"}
