from fastapi import APIRouter, Depends, HTTPException, Request, status, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID
from typing import Optional

from app.core.database import get_db
from app.core.auth import get_current_user, MockUser
from app.core.storage import get_uploads_storage
from app.core.filename_utils import safe_content_disposition, validate_file_magic
from app.models.corpus import CorpusDocument, CorpusChunk
from app.schemas.corpus import (
    CorpusDocumentResponse,
    CorpusListResponse,
    CorpusTextInput,
)
from app.services.document_parser import DocumentParserService
from app.services.embeddings import EmbeddingsService
from app.core.rate_limit import limiter

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
            metadata=doc.doc_metadata,
            chunk_count=chunk_count,
            created_at=doc.created_at,
        ))
    
    return CorpusListResponse(documents=response_docs, total=total)


@router.post("/corpus", response_model=CorpusDocumentResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
async def add_corpus_document(
    request: Request,
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
    
    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File size exceeds 50 MB limit",
        )
    if not validate_file_magic(content, file.content_type or ""):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File content does not match declared type",
        )
    storage_path = await storage.save(content, file.filename, folder="corpus")
    
    # Parse document and build chunk tuples: (plain, html_or_none, page_or_none)
    if file.content_type == "application/pdf":
        file_type = "pdf"
        pages = parser.parse_pdf_pages(content)
        page_chunks = parser.chunk_pdf_pages(pages)
        chunk_tuples = [(c, None, pg) for c, pg in page_chunks]
    else:
        file_type = "docx"
        html = parser.parse_docx_html(content)
        html_chunks = parser.chunk_html(html)
        chunk_tuples = [(plain, h, None) for plain, h in html_chunks]
    
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
        doc_metadata=metadata,
    )
    db.add(corpus_doc)
    await db.commit()
    await db.refresh(corpus_doc)
    
    # Embed plain-text chunks
    plain_texts = [t[0] for t in chunk_tuples]
    embeddings = await embeddings_service.embed_texts(plain_texts)
    
    # Store chunks
    for i, ((plain, html_content, page_num), embedding) in enumerate(
        zip(chunk_tuples, embeddings)
    ):
        chunk = CorpusChunk(
            corpus_doc_id=corpus_doc.id,
            chunk_index=i,
            content=plain,
            content_html=html_content,
            page_number=page_num,
            embedding=embedding,
        )
        db.add(chunk)
    await db.commit()
    
    return CorpusDocumentResponse(
        id=corpus_doc.id,
        title=corpus_doc.title,
        source=corpus_doc.source,
        file_type=corpus_doc.file_type,
        metadata=corpus_doc.doc_metadata,
        chunk_count=len(chunk_tuples),
        created_at=corpus_doc.created_at,
    )


@router.post("/corpus/text", response_model=CorpusDocumentResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
async def add_corpus_text(
    request: Request,
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
        doc_metadata=data.metadata.model_dump() if data.metadata else None,
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
            metadata=corpus_doc.doc_metadata,
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


CORPUS_CONTENT_TYPE_MAP = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xls": "application/vnd.ms-excel",
}


@router.get("/corpus/{doc_id}/download")
async def download_corpus_document(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Download an uploaded corpus document."""
    result = await db.execute(
        select(CorpusDocument).where(CorpusDocument.id == doc_id)
    )
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Corpus document not found",
        )

    if not doc.storage_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not available for download",
        )

    storage = get_uploads_storage()
    file_bytes = await storage.load(doc.storage_path)

    media_type = CORPUS_CONTENT_TYPE_MAP.get(
        doc.file_type or "", "application/octet-stream"
    )

    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={
            "Content-Disposition": safe_content_disposition(doc.title or "file")
        },
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

    if doc.storage_path:
        storage = get_uploads_storage()
        await storage.delete(doc.storage_path)

    await db.delete(doc)
    await db.commit()
