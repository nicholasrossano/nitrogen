import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship, synonym
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.core.database import Base


class CoreChat(Base):
    """A standalone (non-initiative) chat conversation."""
    __tablename__ = "core_chats"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    title: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    initiative_id = synonym("project_id")
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("workspaces.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    assumption_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("assumptions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    compare_project_ids: Mapped[list | None] = mapped_column(JSONB)
    compare_initiative_ids = synonym("compare_project_ids")

    messages: Mapped[list["CoreChatMessage"]] = relationship(
        back_populates="chat", cascade="all, delete-orphan", order_by="CoreChatMessage.created_at"
    )


class CoreChatMessage(Base):
    """A single message in a core chat conversation."""
    __tablename__ = "core_chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chat_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_chats.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)

    sources: Mapped[list | None] = mapped_column(JSONB)
    thinking_lines: Mapped[list | None] = mapped_column(JSONB)
    completion_meta: Mapped[dict | None] = mapped_column(JSONB)
    widget_type: Mapped[str | None] = mapped_column(String(50))
    widget_data: Mapped[dict | None] = mapped_column(JSONB)
    feedback: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    chat: Mapped["CoreChat"] = relationship(back_populates="messages")
