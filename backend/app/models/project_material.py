import uuid
from datetime import datetime
from sqlalchemy import String, Text, BigInteger, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base


class ProjectMaterial(Base):
    __tablename__ = "project_materials"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    initiative_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("initiatives.id", ondelete="CASCADE"),
        index=True,
    )

    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_type: Mapped[str] = mapped_column(String(50), nullable=False)
    storage_path: Mapped[str | None] = mapped_column(String(500))
    file_size: Mapped[int | None] = mapped_column(BigInteger)
    content_text: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )

    initiative: Mapped["Initiative"] = relationship(back_populates="project_materials")


from app.models.initiative import Initiative  # noqa: E402
