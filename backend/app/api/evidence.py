from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID
from typing import Optional

from app.core.database import get_db
from app.core.auth import get_current_user, MockUser
from app.core.storage import get_uploads_storage
from app.models.initiative import Initiative
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
    user: MockUser = Depends(get_current_user),
):
    """Upload a file or paste text as evidence"""
    # Get initiative
    result = await db.execute(
        select(Initiative).where(
            Initiative.id == initiative_id,
            Initiative.user_id == user.uid,
        )
    )
    initiative = result.scalar_one_or_none()
    
    if not initiative:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Initiative not found",
        )
    
    if not initiative.stage_1_complete:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot upload evidence: intake not complete",
        )
    
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
        allowed_types = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
        if file.content_type not in allowed_types:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File must be PDF or DOCX",
            )
        
        # Read and store file
        content = await file.read()
        storage_path = await storage.save(content, file.filename, folder=str(initiative_id))
        
        # Parse document
        if file.content_type == "application/pdf":
            text = parser.parse_pdf(content)
            file_type = "pdf"
        else:
            text = parser.parse_docx(content)
            file_type = "docx"
        
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
    initiative.stage = "generate"
    await db.commit()
    
    # Add message about evidence
    evidence_message = ChatMessage(
        initiative_id=initiative.id,
        role="assistant",
        content=f"Evidence received: **{filename}**. I've processed {len(chunks)} sections. You can now generate your memo.",
        widget_type="generate_options",
        widget_data={"evidence_ready": True, "chunk_count": len(chunks)},
    )
    db.add(evidence_message)
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
    user: MockUser = Depends(get_current_user),
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
    user: MockUser = Depends(get_current_user),
):
    """List evidence documents for an initiative"""
    # Verify access
    result = await db.execute(
        select(Initiative).where(
            Initiative.id == initiative_id,
            Initiative.user_id == user.uid,
        )
    )
    initiative = result.scalar_one_or_none()
    
    if not initiative:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Initiative not found",
        )
    
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
