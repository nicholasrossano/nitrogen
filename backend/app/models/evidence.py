import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from pgvector.sqlalchemy import Vector

from app.core.database import Base


class EvidenceDoc(Base):
    __tablename__ = "evidence_docs"
    
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
    
    # Document metadata
    filename: Mapped[str | None] = mapped_column(String(255))
    file_type: Mapped[str | None] = mapped_column(String(50))  # pdf, docx, text
    storage_path: Mapped[str | None] = mapped_column(String(500))
    
    # Timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        default=datetime.utcnow
    )
    
    # Relationships
    initiative: Mapped["Initiative"] = relationship(back_populates="evidence_docs")
    chunks: Mapped[list["EvidenceChunk"]] = relationship(
        back_populates="evidence_doc", 
        cascade="all, delete-orphan"
    )


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
from app.models.initiative import Initiative
