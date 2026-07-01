import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, synonym

from app.core.database import Base


class ProjectStatusCategory(Base):
    """User-configurable status category definition for a project."""

    __tablename__ = "project_status_categories"

    __table_args__ = (
        UniqueConstraint("project_id", "category_key", name="uq_project_status_categories_project_key"),
        Index("ix_project_status_categories_project_active", "project_id", "is_active"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    initiative_id = synonym("project_id")
    category_key: Mapped[str] = mapped_column(String(120), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    definition_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    criteria: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
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


class ProjectStatusResult(Base):
    """Latest system-generated status assessment per project category."""

    __tablename__ = "project_status_results"

    __table_args__ = (
        UniqueConstraint("project_id", "category_key", name="uq_project_status_results_project_category"),
        Index("ix_project_status_results_project_status", "project_id", "status"),
        Index("ix_project_status_results_is_stale", "is_stale"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    initiative_id = synonym("project_id")
    domain: Mapped[str] = mapped_column(String(64), nullable=False, default="energy")
    category_key: Mapped[str] = mapped_column(String(120), nullable=False)
    category_label: Mapped[str] = mapped_column(String(255), nullable=False)
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


class ProjectStatusOverride(Base):
    """Audit trail of user overrides applied to status categories."""

    __tablename__ = "project_status_overrides"

    __table_args__ = (
        Index("ix_project_status_overrides_project_category", "project_id", "category_key"),
        Index("ix_project_status_overrides_created_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    initiative_id = synonym("project_id")
    category_key: Mapped[str] = mapped_column(String(120), nullable=False)
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


class ProjectStatusAssessmentHistory(Base):
    """Append-only assessment snapshots for export and future trend UI."""

    __tablename__ = "project_status_assessment_history"

    __table_args__ = (
        Index("ix_project_status_assessment_history_project_category", "project_id", "category_key"),
        Index("ix_project_status_assessment_history_assessed_at", "assessed_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    initiative_id = synonym("project_id")
    category_key: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    confidence: Mapped[str] = mapped_column(String(24), nullable=False, default="unknown")
    critical_insight: Mapped[str] = mapped_column(Text, nullable=False, default="")
    source_fingerprint: Mapped[str | None] = mapped_column(String(128), nullable=True)
    assessed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
