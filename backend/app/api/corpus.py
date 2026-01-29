from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID
from typing import Optional

from app.core.database import get_db
from app.core.auth import get_current_user, MockUser
from app.core.storage import get_uploads_storage
from app.models.corpus import CorpusDocument, CorpusChunk
from app.schemas.corpus import (
    CorpusDocumentCreate,
    CorpusDocumentResponse,
    CorpusListResponse,
    CorpusTextInput,
)
from app.services.document_parser import DocumentParserService
from app.services.embeddings import EmbeddingsService

router = APIRouter()


@router.get("/corpus", response_model=CorpusListResponse)
async def list_corpus(
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
    limit: int = 50,
    offset: int = 0,
):
    """List all corpus documents"""
    # Get documents
    docs_result = await db.execute(
        select(CorpusDocument)
        .order_by(CorpusDocument.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    docs = docs_result.scalars().all()
    
    # Get total count
    count_result = await db.execute(select(func.count(CorpusDocument.id)))
    total = count_result.scalar() or 0
    
    # Build response with chunk counts
    response_docs = []
    for doc in docs:
        chunk_count_result = await db.execute(
            select(func.count(CorpusChunk.id)).where(
                CorpusChunk.corpus_doc_id == doc.id
            )
        )
        chunk_count = chunk_count_result.scalar() or 0
        
        response_docs.append(CorpusDocumentResponse(
            id=doc.id,
            title=doc.title,
            source=doc.source,
            file_type=doc.file_type,
            metadata=doc.metadata,
            chunk_count=chunk_count,
            created_at=doc.created_at,
        ))
    
    return CorpusListResponse(documents=response_docs, total=total)


@router.post("/corpus", response_model=CorpusDocumentResponse, status_code=status.HTTP_201_CREATED)
async def add_corpus_document(
    file: Optional[UploadFile] = File(None),
    title: str = None,
    source: Optional[str] = None,
    metadata_json: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Add a document to the corpus (file upload)"""
    if not file:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File is required. Use /corpus/text for text input.",
        )
    
    if not title:
        title = file.filename or "Untitled"
    
    # Validate file type
    allowed_types = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be PDF or DOCX",
        )
    
    parser = DocumentParserService()
    embeddings_service = EmbeddingsService()
    storage = get_uploads_storage()
    
    # Read and store file
    content = await file.read()
    storage_path = await storage.save(content, file.filename, folder="corpus")
    
    # Parse document
    if file.content_type == "application/pdf":
        text = parser.parse_pdf(content)
        file_type = "pdf"
    else:
        text = parser.parse_docx(content)
        file_type = "docx"
    
    # Parse metadata if provided
    import json
    metadata = None
    if metadata_json:
        try:
            metadata = json.loads(metadata_json)
        except json.JSONDecodeError:
            pass
    
    # Create corpus document
    corpus_doc = CorpusDocument(
        title=title,
        source=source,
        file_type=file_type,
        storage_path=storage_path,
        metadata=metadata,
    )
    db.add(corpus_doc)
    await db.commit()
    await db.refresh(corpus_doc)
    
    # Chunk and embed
    chunks = parser.chunk_text(text)
    embeddings = await embeddings_service.embed_texts(chunks)
    
    # Store chunks
    for i, (chunk_text, embedding) in enumerate(zip(chunks, embeddings)):
        chunk = CorpusChunk(
            corpus_doc_id=corpus_doc.id,
            chunk_index=i,
            content=chunk_text,
            embedding=embedding,
        )
        db.add(chunk)
    await db.commit()
    
    return CorpusDocumentResponse(
        id=corpus_doc.id,
        title=corpus_doc.title,
        source=corpus_doc.source,
        file_type=corpus_doc.file_type,
        metadata=corpus_doc.metadata,
        chunk_count=len(chunks),
        created_at=corpus_doc.created_at,
    )


@router.post("/corpus/text", response_model=CorpusDocumentResponse, status_code=status.HTTP_201_CREATED)
async def add_corpus_text(
    data: CorpusTextInput,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Add text content to the corpus"""
    parser = DocumentParserService()
    embeddings_service = EmbeddingsService()
    
    # Create corpus document
    corpus_doc = CorpusDocument(
        title=data.title,
        source=data.source,
        file_type="text",
        metadata=data.metadata.model_dump() if data.metadata else None,
    )
    db.add(corpus_doc)
    await db.commit()
    await db.refresh(corpus_doc)
    
    # Chunk and embed
    chunks = parser.chunk_text(data.content)
    embeddings = await embeddings_service.embed_texts(chunks)
    
    # Store chunks
    for i, (chunk_text, embedding) in enumerate(zip(chunks, embeddings)):
        chunk = CorpusChunk(
            corpus_doc_id=corpus_doc.id,
            chunk_index=i,
            content=chunk_text,
            embedding=embedding,
        )
        db.add(chunk)
    await db.commit()
    
    return CorpusDocumentResponse(
        id=corpus_doc.id,
        title=corpus_doc.title,
        source=corpus_doc.source,
        file_type=corpus_doc.file_type,
        metadata=corpus_doc.metadata,
        chunk_count=len(chunks),
        created_at=corpus_doc.created_at,
    )


@router.get("/corpus/{doc_id}", response_model=CorpusDocumentResponse)
async def get_corpus_document(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Get a corpus document by ID"""
    result = await db.execute(
        select(CorpusDocument).where(CorpusDocument.id == doc_id)
    )
    doc = result.scalar_one_or_none()
    
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Corpus document not found",
        )
    
    # Get chunk count
    chunk_count_result = await db.execute(
        select(func.count(CorpusChunk.id)).where(CorpusChunk.corpus_doc_id == doc.id)
    )
    chunk_count = chunk_count_result.scalar() or 0
    
    return CorpusDocumentResponse(
        id=doc.id,
        title=doc.title,
        source=doc.source,
        file_type=doc.file_type,
        metadata=doc.metadata,
        chunk_count=chunk_count,
        created_at=doc.created_at,
    )


@router.delete("/corpus/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_corpus_document(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Delete a corpus document"""
    result = await db.execute(
        select(CorpusDocument).where(CorpusDocument.id == doc_id)
    )
    doc = result.scalar_one_or_none()
    
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Corpus document not found",
        )
    
    await db.delete(doc)
    await db.commit()
