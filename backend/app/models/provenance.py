"""ProvenanceTrace model – Layer 1 audit log for AI generation events."""

import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.core.database import Base


class ProvenanceTrace(Base):
    """Append-only record of a single AI generation event.

    Captures the full retrieval context, thinking steps, model metadata,
    and timing for any feature that produces AI-generated content.
    """

    __tablename__ = "provenance_traces"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # Optionally scoped to an initiative or a standalone chat session
    initiative_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("initiatives.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    chat_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("core_chats.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # What triggered this generation
    trigger: Mapped[str] = mapped_column(String(80), nullable=False)
    trigger_ref: Mapped[str | None] = mapped_column(String(255))

    # Layer 1 payload (all JSONB, write-once)
    retrieval_context: Mapped[list | None] = mapped_column(JSONB)
    thinking_lines: Mapped[list | None] = mapped_column(JSONB)
    model_id: Mapped[str | None] = mapped_column(String(100))
    prompt_template: Mapped[str | None] = mapped_column(String(200))
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    token_usage: Mapped[dict | None] = mapped_column(JSONB)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )
