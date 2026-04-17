import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import TYPE_CHECKING
from sqlalchemy import String, DateTime, ForeignKey, Index, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.initiative import Initiative


class ModuleInstanceStatus(str, Enum):
    """Canonical lifecycle status for a module instance.

    Transitions:
        started -> generating (setup confirmed on a layered module, or LLM run begins)
        started -> ready      (widget module becomes computable after first recalculate)
        generating -> ready   (LLM generation complete, user can review)
        ready -> completed    (user exports or finalizes the deliverable)
        Any -> started        (setup re-confirmed, resetting build/output)
    """
    STARTED = "started"
    GENERATING = "generating"
    READY = "ready"
    COMPLETED = "completed"


class ModuleInstance(Base):
    """A single run of a module template within a project.

    Each row represents one instance — e.g. "LCOE Model #2 for Project X".
    A project can have many instances of the same module_id.
    """
    __tablename__ = "module_instances"

    __table_args__ = (
        Index("ix_mi_initiative_module", "initiative_id", "module_id"),
        Index("ix_mi_initiative_chat", "initiative_id", "chat_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    initiative_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("initiatives.id", ondelete="CASCADE"),
        nullable=False,
    )
    module_id: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="started")
    title: Mapped[str | None] = mapped_column(String(255))
    started_by: Mapped[str] = mapped_column(String(255), nullable=False)
    chat_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("core_chats.id", ondelete="SET NULL"),
        nullable=True,
    )
    archived: Mapped[bool] = mapped_column(default=False, nullable=False)
    alignment: Mapped[dict | None] = mapped_column(JSONB)
    deliverable: Mapped[dict | None] = mapped_column(JSONB)
    workflow_state: Mapped[dict | None] = mapped_column(JSONB)
    workflow_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
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
