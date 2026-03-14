import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.core.database import Base


class CoreChatSession(Base):
    """A standalone (non-initiative) chat conversation."""
    __tablename__ = "core_chat_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    title: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Compare mode: pair of initiative UUIDs (as strings), null for regular sessions
    compare_initiative_ids: Mapped[list | None] = mapped_column(JSONB)

    messages: Mapped[list["CoreChatMessage"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="CoreChatMessage.created_at"
    )


class CoreChatMessage(Base):
    """A single message in a core chat session."""
    __tablename__ = "core_chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_chat_sessions.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # user | assistant
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # Research metadata (assistant messages only)
    sources: Mapped[list | None] = mapped_column(JSONB)            # [{source_type, source_title, source_url, ...}]
    thinking_lines: Mapped[list | None] = mapped_column(JSONB)     # ["Searching corpus...", ...]
    completion_meta: Mapped[dict | None] = mapped_column(JSONB)    # {latency_ms, citation_count, tiers_used}

    # Widget attachment (for LCOE / Carbon outputs)
    widget_type: Mapped[str | None] = mapped_column(String(50))
    widget_data: Mapped[dict | None] = mapped_column(JSONB)

    # User feedback — "like" | "dislike" | null
    feedback: Mapped[str | None] = mapped_column(String(20))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    session: Mapped["CoreChatSession"] = relationship(back_populates="messages")
