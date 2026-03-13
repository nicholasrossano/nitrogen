from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete as sql_delete
from uuid import UUID
from typing import Optional

from app.core.database import get_db
from app.core.auth import get_current_user, AuthUser
from app.core.permissions import require_editor, require_viewer
from app.core.storage import get_uploads_storage
from app.models.evidence import EvidenceDoc, EvidenceChunk
from app.models.chat import ChatMessage
from app.schemas.evidence import (
    EvidenceTextInput,
    EvidenceDocResponse,
    EvidenceUploadResponse,
)
from app.services.document_parser import DocumentParserService
from app.services.embeddings import EmbeddingsService

router = APIRouter()


@router.post("/initiatives/{initiative_id}/evidence", response_model=EvidenceUploadResponse)
async def upload_evidence(
    initiative_id: UUID,
    file: Optional[UploadFile] = File(None),
    text_content: Optional[str] = Form(None),
    text_title: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Upload a file or paste text as evidence"""
    initiative = await require_editor(db, initiative_id, user)
    
    # Validate input
    if not file and not text_content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must provide either a file or text content",
        )
    
    parser = DocumentParserService()
    embeddings_service = EmbeddingsService()
    storage = get_uploads_storage()
    
    # Process file upload
    if file:
        # Validate file type
        allowed_types = {
            "application/pdf": "pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
            "application/vnd.ms-excel": "xls",
        }
        file_type = allowed_types.get(file.content_type or "")
        if not file_type:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File must be PDF, DOCX, or Excel (XLSX/XLS)",
            )
        
        # Read and store file
        content = await file.read()
        storage_path = await storage.save(content, file.filename, folder=str(initiative_id))
        
        # Parse document
        if file_type == "pdf":
            text = parser.parse_pdf(content)
        elif file_type == "docx":
            text = parser.parse_docx(content)
        else:
            text = parser.parse_xlsx(content)
        
        filename = file.filename
    
    # Process text paste
    else:
        text = text_content
        filename = text_title or "Pasted text"
        file_type = "text"
        storage_path = None  # Text is stored in chunks, no file
    
    # Create evidence doc
    evidence_doc = EvidenceDoc(
        initiative_id=initiative.id,
        filename=filename,
        file_type=file_type,
        storage_path=storage_path,
    )
    db.add(evidence_doc)
    await db.commit()
    await db.refresh(evidence_doc)
    
    # Chunk and embed
    chunks = parser.chunk_text(text)
    embeddings = await embeddings_service.embed_texts(chunks)
    
    # Store chunks
    for i, (chunk_text, embedding) in enumerate(zip(chunks, embeddings)):
        chunk = EvidenceChunk(
            evidence_doc_id=evidence_doc.id,
            chunk_index=i,
            content=chunk_text,
            embedding=embedding,
        )
        db.add(chunk)
    
    # Update initiative
    initiative.evidence_ready = True
    initiative.touch()  # Update the initiative's updated_at timestamp
    await db.commit()
    
    # Get chunk count
    chunk_count_result = await db.execute(
        select(func.count(EvidenceChunk.id)).where(
            EvidenceChunk.evidence_doc_id == evidence_doc.id
        )
    )
    chunk_count = chunk_count_result.scalar() or 0
    
    return EvidenceUploadResponse(
        success=True,
        document=EvidenceDocResponse(
            id=evidence_doc.id,
            filename=evidence_doc.filename,
            file_type=evidence_doc.file_type,
            created_at=evidence_doc.created_at,
            chunk_count=chunk_count,
        ),
        message=f"Evidence processed: {len(chunks)} chunks created",
        stage=initiative.stage,
        evidence_ready=initiative.evidence_ready,
    )


@router.post("/initiatives/{initiative_id}/evidence/text", response_model=EvidenceUploadResponse)
async def paste_evidence_text(
    initiative_id: UUID,
    data: EvidenceTextInput,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Paste text as evidence (alternative to file upload)"""
    # Reuse upload endpoint logic with text
    return await upload_evidence(
        initiative_id=initiative_id,
        file=None,
        text_content=data.content,
        text_title=data.title,
        db=db,
        user=user,
    )


@router.get("/initiatives/{initiative_id}/evidence", response_model=list[EvidenceDocResponse])
async def list_evidence(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """List evidence documents for an initiative"""
    initiative = await require_viewer(db, initiative_id, user)
    
    # Get evidence docs with chunk counts
    docs_result = await db.execute(
        select(EvidenceDoc).where(EvidenceDoc.initiative_id == initiative_id)
    )
    docs = docs_result.scalars().all()
    
    response = []
    for doc in docs:
        chunk_count_result = await db.execute(
            select(func.count(EvidenceChunk.id)).where(
                EvidenceChunk.evidence_doc_id == doc.id
            )
        )
        chunk_count = chunk_count_result.scalar() or 0
        
        response.append(EvidenceDocResponse(
            id=doc.id,
            filename=doc.filename,
            file_type=doc.file_type,
            created_at=doc.created_at,
            chunk_count=chunk_count,
        ))
    
    return response


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
    
    # Get all chunks ordered by index
    chunks_result = await db.execute(
        select(EvidenceChunk)
        .where(EvidenceChunk.evidence_doc_id == evidence_id)
        .order_by(EvidenceChunk.chunk_index)
    )
    chunks = chunks_result.scalars().all()
    
    # Combine chunk content
    full_content = "\n\n".join([chunk.content for chunk in chunks])
    
    return {
        "id": str(evidence_doc.id),
        "filename": evidence_doc.filename,
        "file_type": evidence_doc.file_type,
        "content": full_content,
        "chunk_count": len(chunks),
    }


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

    await require_viewer(db, evidence_doc.initiative_id, user)

    if not evidence_doc.storage_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not available for download",
        )

    storage = get_uploads_storage()
    file_bytes = await storage.load(evidence_doc.storage_path)

    media_type = EVIDENCE_CONTENT_TYPE_MAP.get(
        evidence_doc.file_type or "", "application/octet-stream"
    )

    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{evidence_doc.filename or "file"}"'
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
    
    await require_editor(db, evidence_doc.initiative_id, user)
    
    # Delete all chunks first
    await db.execute(
        sql_delete(EvidenceChunk).where(EvidenceChunk.evidence_doc_id == evidence_id)
    )
    
    # Delete the evidence doc
    await db.delete(evidence_doc)
    await db.commit()
    
    return {"success": True, "message": "Evidence document deleted"}
