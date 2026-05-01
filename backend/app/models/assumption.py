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
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="assumed")
    used_in_assessments: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
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


class AssumptionComment(Base):
    """User comment attached to a project assumption."""

    __tablename__ = "assumption_comments"

    __table_args__ = (
        Index("ix_assumption_comments_assumption_created", "assumption_id", "created_at"),
        Index("ix_assumption_comments_initiative_created", "initiative_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    assumption_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("assumptions.id", ondelete="CASCADE"),
        nullable=False,
    )
    initiative_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("initiatives.id", ondelete="CASCADE"),
        nullable=False,
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_by_user_id: Mapped[str | None] = mapped_column(String(255))
    created_by_email: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class AssumptionBinding(Base):
    """Structured mapping between a assessment variable and a project assumption."""

    __tablename__ = "assumption_bindings"

    __table_args__ = (
        Index(
            "ix_assumption_bindings_initiative_assessment_field",
            "initiative_id",
            "assessment_id",
            "field_name",
        ),
        Index("ix_assumption_bindings_assumption", "assumption_id"),
        Index("ix_assumption_bindings_assessment_instance", "assessment_instance_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    initiative_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("initiatives.id", ondelete="CASCADE"),
        nullable=False,
    )
    assumption_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("assumptions.id", ondelete="CASCADE"),
        nullable=False,
    )
    assessment_id: Mapped[str] = mapped_column(String(160), nullable=False)
    assessment_instance_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("assessment_instances.id", ondelete="SET NULL"),
    )
    stage_id: Mapped[str | None] = mapped_column(String(120))
    field_name: Mapped[str] = mapped_column(String(160), nullable=False)
    field_label: Mapped[str | None] = mapped_column(String(255))
    unit: Mapped[str | None] = mapped_column(String(80))
    value_type: Mapped[str | None] = mapped_column(String(40))
    binding_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB)
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
