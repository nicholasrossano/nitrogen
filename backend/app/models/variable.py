import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Variable(Base):
    """Reusable project-level value or claim."""

    __tablename__ = "variables"

    __table_args__ = (
        Index("ix_variables_project_key", "project_id", "key"),
        Index("ix_variables_project_status", "project_id", "status"),
        Index("ix_variables_source_type", "source_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    key: Mapped[str] = mapped_column(String(160), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSONB)
    unit: Mapped[str | None] = mapped_column(String(80))
    value_type: Mapped[str] = mapped_column(String(40), nullable=False)
    source_type: Mapped[str] = mapped_column(String(80), nullable=False)
    source_reference: Mapped[dict | None] = mapped_column(JSONB)
    # Observed surface forms merged into this canonical variable (e.g. NPV / net present value).
    aliases: Mapped[list[str] | None] = mapped_column(JSONB)
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


class VariableComment(Base):
    """User comment attached to a project variable."""

    __tablename__ = "variable_comments"

    __table_args__ = (
        Index("ix_variable_comments_variable_created", "variable_id", "created_at"),
        Index("ix_variable_comments_project_created", "project_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    variable_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("variables.id", ondelete="CASCADE"),
        nullable=False,
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
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


class VariableBinding(Base):
    """Structured mapping between a assessment variable and a project variable."""

    __tablename__ = "variable_bindings"

    __table_args__ = (
        Index(
            "ix_variable_bindings_project_assessment_field",
            "project_id",
            "assessment_id",
            "field_name",
        ),
        Index("ix_variable_bindings_variable", "variable_id"),
        Index("ix_variable_bindings_assessment_instance", "assessment_instance_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    variable_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("variables.id", ondelete="CASCADE"),
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
