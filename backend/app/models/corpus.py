import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
from pgvector.sqlalchemy import Vector

from app.core.database import Base


class CorpusDocument(Base):
    """Global corpus of case studies - not tied to any initiative"""
    __tablename__ = "corpus_documents"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        primary_key=True, 
        default=uuid.uuid4
    )
    
    # Document metadata
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    source: Mapped[str | None] = mapped_column(String(255))  # e.g., "USAID 2024"
    file_type: Mapped[str | None] = mapped_column(String(50))
    storage_path: Mapped[str | None] = mapped_column(String(500))
    
    # Extended metadata (sector, geography, year, tags)
    # Note: column is named 'metadata' in DB but 'doc_metadata' in Python to avoid SQLAlchemy reserved name
    doc_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB)
    
    # Timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        default=datetime.utcnow
    )
    
    # Relationships
    chunks: Mapped[list["CorpusChunk"]] = relationship(
        back_populates="corpus_doc", 
        cascade="all, delete-orphan"
    )


class CorpusChunk(Base):
    """Embedded chunks from corpus documents"""
    __tablename__ = "corpus_chunks"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        primary_key=True, 
        default=uuid.uuid4
    )
    corpus_doc_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        ForeignKey("corpus_documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    
    # Chunk content
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    
    # Vector embedding (1536 dimensions for OpenAI ada-002)
    embedding = mapped_column(Vector(1536))
    
    # Timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        default=datetime.utcnow
    )
    
    # Relationships
    corpus_doc: Mapped["CorpusDocument"] = relationship(back_populates="chunks")
