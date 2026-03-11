import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.core.database import Base


class GSCertificationWorkspace(Base):
    __tablename__ = "gs_certification_workspaces"

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
    template_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("gs_template_versions.id", ondelete="RESTRICT"),
        nullable=False,
    )
    template_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="cover_letter", index=True
    )
    field_values: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    checklist_state: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    export_history: Mapped[list | None] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    template_version: Mapped["GSTemplateVersion"] = relationship(lazy="joined")


from app.models.gs_template import GSTemplateVersion  # noqa: E402
