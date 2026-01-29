import uuid
from datetime import datetime
from sqlalchemy import String, Text, Boolean, ARRAY, DateTime, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
import enum

from app.core.database import Base


class InitiativeStage(str, enum.Enum):
    INTAKE = "intake"
    EVIDENCE = "evidence"
    GENERATE = "generate"
    COMPLETE = "complete"


class Initiative(Base):
    __tablename__ = "initiatives"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        primary_key=True, 
        default=uuid.uuid4
    )
    user_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    
    # Initiative fields (populated during intake)
    title: Mapped[str | None] = mapped_column(String(255))
    sector: Mapped[str] = mapped_column(String(100), default="clean_cooking")
    geography: Mapped[str | None] = mapped_column(String(255))
    target_population: Mapped[str | None] = mapped_column(Text)
    goal: Mapped[str | None] = mapped_column(Text)
    budget_range: Mapped[str | None] = mapped_column(String(100))
    timeline: Mapped[str | None] = mapped_column(String(100))
    constraints: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    
    # Stage tracking
    stage: Mapped[str] = mapped_column(
        String(20), 
        default=InitiativeStage.INTAKE.value
    )
    stage_1_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    evidence_ready: Mapped[bool] = mapped_column(Boolean, default=False)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        default=datetime.utcnow, 
        onupdate=datetime.utcnow
    )
    
    # Relationships
    chat_messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="initiative", 
        cascade="all, delete-orphan"
    )
    evidence_docs: Mapped[list["EvidenceDoc"]] = relationship(
        back_populates="initiative", 
        cascade="all, delete-orphan"
    )
    memo_versions: Mapped[list["MemoVersion"]] = relationship(
        back_populates="initiative", 
        cascade="all, delete-orphan"
    )
    
    def is_intake_complete(self) -> bool:
        """Check if required intake fields are populated"""
        return all([
            self.title,
            self.sector,
            self.geography,
            self.target_population,
            self.goal,
        ])
    
    def to_summary_dict(self) -> dict:
        """Get initiative summary for confirmation widget"""
        return {
            "title": self.title,
            "sector": self.sector,
            "geography": self.geography,
            "target_population": self.target_population,
            "goal": self.goal,
            "budget_range": self.budget_range,
            "timeline": self.timeline,
            "constraints": self.constraints or [],
        }


# Import for relationship typing
from app.models.chat import ChatMessage
from app.models.evidence import EvidenceDoc
from app.models.memo import MemoVersion
