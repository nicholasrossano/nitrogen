import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.core.database import Base


class MemoVersion(Base):
    __tablename__ = "memo_versions"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        primary_key=True, 
        default=uuid.uuid4
    )
    initiative_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        ForeignKey("initiatives.id", ondelete="CASCADE"),
        index=True
    )
    
    # Memo content (structured JSON)
    content: Mapped[dict] = mapped_column(JSONB, nullable=False)
    
    # Export metadata
    export_path: Mapped[str | None] = mapped_column(String(500))
    
    # Timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        default=datetime.utcnow
    )
    
    # Relationships
    initiative: Mapped["Initiative"] = relationship(back_populates="memo_versions")
    citations: Mapped[list["Citation"]] = relationship(
        back_populates="memo_version", 
        cascade="all, delete-orphan"
    )


class Citation(Base):
    __tablename__ = "citations"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        primary_key=True, 
        default=uuid.uuid4
    )
    memo_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        ForeignKey("memo_versions.id", ondelete="CASCADE"),
        index=True
    )
    
    # Citation details
    section_name: Mapped[str | None] = mapped_column(String(100))
    citation_number: Mapped[int] = mapped_column(Integer, nullable=False)
    
    # Source reference (can be evidence_chunk or corpus_chunk)
    chunk_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    source_type: Mapped[str] = mapped_column(
        String(20), 
        nullable=False, 
        default="evidence"
    )  # 'evidence' | 'corpus'
    
    # Citation content
    excerpt: Mapped[str | None] = mapped_column(Text)
    
    # Relationships
    memo_version: Mapped["MemoVersion"] = relationship(back_populates="citations")


# Import for relationship typing
from app.models.initiative import Initiative
