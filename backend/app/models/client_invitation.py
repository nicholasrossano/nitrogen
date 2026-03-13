import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base


class ClientInvitation(Base):
    __tablename__ = "client_invitations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    # Nullable — project is created only when the client accepts the invite
    initiative_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("initiatives.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    token: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False,
        index=True,
    )
    client_email: Mapped[Optional[str]] = mapped_column(String(255))
    project_title: Mapped[Optional[str]] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default="pending",
    )
    invited_by: Mapped[str] = mapped_column(
        String(255),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    accepted_by: Mapped[Optional[str]] = mapped_column(
        String(255),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
    )

    initiative: Mapped[Optional["Initiative"]] = relationship(
        "Initiative", foreign_keys=[initiative_id], lazy="select"
    )
    inviter: Mapped["User"] = relationship(
        "User", foreign_keys=[invited_by], lazy="joined"
    )
