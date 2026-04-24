from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from uuid import UUID


class EvidenceTextInput(BaseModel):
    """Schema for pasting text as evidence"""
    content: str = Field(..., min_length=1, max_length=100000)
    title: Optional[str] = Field(None, max_length=255)


class EvidenceDocResponse(BaseModel):
    """Response for an evidence document."""

    id: UUID
    filename: Optional[str] = None
    file_type: Optional[str] = None
    file_size: Optional[int] = None
    created_at: datetime
    chunk_count: int = 0
    processing_status: str = Field(
        default="uploaded",
        description=(
            "Processing lifecycle state: uploaded, processing, "
            "lightweight_ready, indexed, failed."
        ),
    )
    processing_error: Optional[str] = Field(
        default=None,
        description="Error message when processing_status == 'failed'.",
    )

    class Config:
        from_attributes = True


class EvidenceUploadResponse(BaseModel):
    """Response after uploading/pasting evidence.

    The response is returned as soon as the file is safely stored; full parsing
    and embedding happen asynchronously.  Clients should treat
    ``document.processing_status`` as the source of truth for "is this doc
    ready for retrieval?".
    """

    success: bool
    document: EvidenceDocResponse
    message: str
    stage: str
    evidence_ready: bool


class EvidenceChunkResponse(BaseModel):
    """Response for an evidence chunk (used in citations)"""
    id: UUID
    chunk_index: int
    content: str
    source_doc_id: UUID
    source_doc_title: Optional[str] = None
