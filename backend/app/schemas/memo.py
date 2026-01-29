from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime
from uuid import UUID


class MemoGenerateRequest(BaseModel):
    """Request to generate a memo"""
    include_corpus: bool = Field(
        default=True, 
        description="Include case study corpus in RAG retrieval"
    )


class CitationResponse(BaseModel):
    """A citation in the memo"""
    number: int
    source_type: Literal["evidence", "corpus"]
    source_title: str
    excerpt: str
    chunk_id: UUID


class MemoContent(BaseModel):
    """Structured memo content"""
    title: str
    date: str
    executive_summary: str
    recommendation: Literal["proceed", "hold", "reject"]
    recommendation_rationale: str
    evidence_summary: str
    risks_and_assumptions: str
    open_questions: list[str] = Field(default_factory=list)
    citations: list[CitationResponse] = Field(default_factory=list)


class MemoResponse(BaseModel):
    """Response containing the generated memo"""
    id: UUID
    initiative_id: UUID
    content: MemoContent
    created_at: datetime
    
    class Config:
        from_attributes = True


class ExportRequest(BaseModel):
    """Request to export memo to DOCX"""
    memo_version_id: Optional[UUID] = Field(
        None, 
        description="Specific memo version to export. If not provided, uses latest."
    )


class ExportResponse(BaseModel):
    """Response with export download info"""
    success: bool
    export_id: UUID
    download_url: str
    filename: str
