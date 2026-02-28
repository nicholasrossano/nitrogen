import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
import enum

from app.core.database import Base


class MessageRole(str, enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class WidgetType(str, enum.Enum):
    CONFIRMATION = "confirmation"
    EVIDENCE_INPUT = "evidence_input"
    GENERATE_OPTIONS = "generate_options"
    MEMO_VIEWER = "memo_viewer"


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        primary_key=True, 
        default=uuid.uuid4
    )
    initiative_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        ForeignKey("initiatives.id", ondelete="CASCADE"),
        index=True
    )
    
    # Message content
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    
    # Widget attachment (optional)
    widget_type: Mapped[str | None] = mapped_column(String(50))
    widget_data: Mapped[dict | None] = mapped_column(JSONB)
    
    # Source citations (for RAG-informed responses)
    sources: Mapped[list | None] = mapped_column(JSONB)

    # User feedback: "like", "dislike", or null
    feedback: Mapped[str | None] = mapped_column(String(20), default=None)
    
    # Timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        default=datetime.utcnow
    )
    
    # Relationships
    initiative: Mapped["Initiative"] = relationship(back_populates="chat_messages")


# Import for relationship typing
from app.models.initiative import Initiative
