import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Assumption(Base):
    """Reusable project-level value or claim."""

    __tablename__ = "assumptions"

    __table_args__ = (
        Index("ix_assumptions_initiative_key", "initiative_id", "key"),
        Index("ix_assumptions_initiative_status", "initiative_id", "status"),
        Index("ix_assumptions_source_type", "source_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    initiative_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("initiatives.id", ondelete="CASCADE"),
        nullable=False,
    )
    key: Mapped[str] = mapped_column(String(160), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSONB)
    unit: Mapped[str | None] = mapped_column(String(80))
    value_type: Mapped[str] = mapped_column(String(40), nullable=False)
    source_type: Mapped[str] = mapped_column(String(80), nullable=False)
    source_reference: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="needs_review")
    used_in_modules: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    created_by_user_id: Mapped[str | None] = mapped_column(String(255))
    created_by_email: Mapped[str | None] = mapped_column(String(255))
    last_updated_by_user_id: Mapped[str | None] = mapped_column(String(255))
    last_updated_by_email: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
