import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING
from sqlalchemy import String, DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.initiative import Initiative


class ModuleInstance(Base):
    """A single run of a module template within a project.

    Each row represents one instance — e.g. "LCOE Model #2 for Project X".
    A project can have many instances of the same tool_id.
    """
    __tablename__ = "module_instances"

    __table_args__ = (
        Index("ix_mi_initiative_tool", "initiative_id", "tool_id"),
        Index("ix_mi_initiative_session", "initiative_id", "session_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    initiative_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("initiatives.id", ondelete="CASCADE"),
        nullable=False,
    )
    tool_id: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="started")
    title: Mapped[str | None] = mapped_column(String(255))
    started_by: Mapped[str] = mapped_column(String(255), nullable=False)
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("core_chat_sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    alignment: Mapped[dict | None] = mapped_column(JSONB)
    deliverable: Mapped[dict | None] = mapped_column(JSONB)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    initiative: Mapped["Initiative"] = relationship(back_populates="module_instances")
