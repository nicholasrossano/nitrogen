import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.core.database import Base


class PDDWorkspace(Base):
    __tablename__ = "pdd_workspaces"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    initiative_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("initiatives.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("core_chat_sessions.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="scan"
    )
    project_scan: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    outline: Mapped[list | None] = mapped_column(JSONB, default=list)
    sections: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    active_section_id: Mapped[str | None] = mapped_column(
        String(100), nullable=True
    )
    consistency_findings: Mapped[list | None] = mapped_column(JSONB, default=list)
    assembled_document: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    missing_items_global: Mapped[list | None] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
