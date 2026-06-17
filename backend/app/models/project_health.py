import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, synonym

from app.core.database import Base


class ProjectHealthResult(Base):
    """Latest system-generated health result per project dimension."""

    __tablename__ = "project_health_results"

    __table_args__ = (
        UniqueConstraint("project_id", "dimension_id", name="uq_project_health_results_project_dimension"),
        Index("ix_project_health_results_project_status", "project_id", "status"),
        Index("ix_project_health_results_is_stale", "is_stale"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    initiative_id = synonym("project_id")
    domain: Mapped[str] = mapped_column(String(64), nullable=False, default="energy")
    dimension_id: Mapped[str] = mapped_column(String(120), nullable=False)
    dimension_label: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    confidence: Mapped[str] = mapped_column(String(24), nullable=False, default="unknown")
    rationale: Mapped[str] = mapped_column(Text, nullable=False, default="")
    positive_drivers: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    negative_drivers: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    blockers: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    missing_items: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    relevant_modules: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    improvement_actions: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    uncertainties: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    supporting_signals: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    update_source: Mapped[str] = mapped_column(String(64), nullable=False, default="manual_refresh")
    source_fingerprint: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_stale: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
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


class ProjectHealthOverride(Base):
    """Audit trail of user overrides applied to project health dimensions."""

    __tablename__ = "project_health_overrides"

    __table_args__ = (
        Index("ix_project_health_overrides_project_dimension", "project_id", "dimension_id"),
        Index("ix_project_health_overrides_created_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    initiative_id = synonym("project_id")
    dimension_id: Mapped[str] = mapped_column(String(120), nullable=False)
    prior_system_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    override_status: Mapped[str] = mapped_column(String(24), nullable=False)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    overridden_by_user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    overridden_by_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
