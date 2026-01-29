from pydantic import BaseModel, Field
from typing import Optional, Any
from datetime import datetime
from uuid import UUID


class CorpusMetadata(BaseModel):
    """Extended metadata for corpus documents"""
    sector: Optional[str] = None
    geography: Optional[str] = None
    year: Optional[int] = None
    tags: list[str] = Field(default_factory=list)
    organization: Optional[str] = None


class CorpusDocumentCreate(BaseModel):
    """Schema for adding a document to the corpus"""
    title: str = Field(..., min_length=1, max_length=255)
    source: Optional[str] = Field(None, max_length=255)
    metadata: Optional[CorpusMetadata] = None


class CorpusTextInput(BaseModel):
    """Schema for adding text content to corpus"""
    title: str = Field(..., min_length=1, max_length=255)
    source: Optional[str] = Field(None, max_length=255)
    content: str = Field(..., min_length=1, max_length=100000)
    metadata: Optional[CorpusMetadata] = None


class CorpusDocumentResponse(BaseModel):
    """Response for a corpus document"""
    id: UUID
    title: str
    source: Optional[str] = None
    file_type: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None
    chunk_count: int = 0
    created_at: datetime
    
    class Config:
        from_attributes = True


class CorpusListResponse(BaseModel):
    """Response for listing corpus documents"""
    documents: list[CorpusDocumentResponse]
    total: int


class CorpusChunkResponse(BaseModel):
    """Response for a corpus chunk (used in citations)"""
    id: UUID
    chunk_index: int
    content: str
    source_doc_id: UUID
    source_doc_title: str
    source: Optional[str] = None
