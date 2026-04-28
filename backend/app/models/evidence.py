import enum
import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, BigInteger, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
from pgvector.sqlalchemy import Vector

from app.core.database import Base


class EvidenceDocStatus(str, enum.Enum):
    """Processing lifecycle for an uploaded evidence document.

    `uploaded` means the file is safely stored and visible to the user but has
    not yet been touched by the background processor.  `lightweight_ready` means
    we have enough signal (filename, type, optional preview) to drive onboarding
    decisions such as module recommendation — but full chunking/embeddings are
    not done yet.  `indexed` means the document is fully chunked and embedded
    and is available for retrieval.  `failed` marks a document that the worker
    could not process after any retries; the upload itself still succeeded.
    """

    UPLOADED = "uploaded"
    PROCESSING = "processing"
    LIGHTWEIGHT_READY = "lightweight_ready"
    INDEXED = "indexed"
    FAILED = "failed"


class EvidenceDoc(Base):
    __tablename__ = "evidence_docs"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        primary_key=True, 
        default=uuid.uuid4
    )
    initiative_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), 
        ForeignKey("initiatives.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    
    # Document metadata
    filename: Mapped[str | None] = mapped_column(String(255))
    file_type: Mapped[str | None] = mapped_column(String(50))  # pdf, docx, text
    storage_path: Mapped[str | None] = mapped_column(String(500))
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    # Processing lifecycle — see EvidenceDocStatus docstring.
    processing_status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default=EvidenceDocStatus.UPLOADED.value,
        server_default=EvidenceDocStatus.UPLOADED.value,
        index=True,
    )
    processing_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    processing_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    processing_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    processing_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Short text preview extracted at the lightweight milestone — cheap signal
    # used by onboarding before full chunking/embeddings are ready.
    preview_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        default=datetime.utcnow
    )
    
    # Relationships
    initiative: Mapped["Initiative | None"] = relationship(back_populates="evidence_docs")
    workspace: Mapped["Workspace"] = relationship()
    chunks: Mapped[list["EvidenceChunk"]] = relationship(
        back_populates="evidence_doc", 
        cascade="all, delete-orphan"
    )

    @property
    def is_lightweight_ready(self) -> bool:
        """True once the lightweight extraction milestone (or better) is reached."""
        return self.processing_status in (
            EvidenceDocStatus.LIGHTWEIGHT_READY.value,
            EvidenceDocStatus.INDEXED.value,
        )

    @property
    def is_indexed(self) -> bool:
        """True once full chunking + embeddings have been persisted."""
        return self.processing_status == EvidenceDocStatus.INDEXED.value


class EvidenceChunk(Base):
    __tablename__ = "evidence_chunks"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        primary_key=True, 
        default=uuid.uuid4
    )
    evidence_doc_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        ForeignKey("evidence_docs.id", ondelete="CASCADE"),
        index=True
    )
    
    # Chunk content
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chunk_kind: Mapped[str] = mapped_column(
        String(32), nullable=False, default="text", server_default="text"
    )
    bbox: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    preview_image_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    preview_mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    
    # Vector embedding (1536 dimensions for OpenAI ada-002)
    embedding = mapped_column(Vector(1536))
    
    # Timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        default=datetime.utcnow
    )
    
    # Relationships
    evidence_doc: Mapped["EvidenceDoc"] = relationship(back_populates="chunks")


# Import for relationship typing
from app.models.initiative import Initiative  # noqa: E402
from app.models.workspace import Workspace  # noqa: E402
