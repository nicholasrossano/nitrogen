import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, Boolean, ARRAY, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
import enum

from app.core.database import Base


class InitiativeStage(str, enum.Enum):
    """Stages of the initiative workflow."""
    DESCRIBE = "describe"           # User describes their project
    SELECT_TOOLS = "select_tools"   # User selects which tools to use
    GATHER_INPUTS = "gather_inputs" # Gather tool-specific inputs
    REVIEW = "review"               # Review deliverables overview
    GENERATE = "generate"           # Generate outputs
    COMPLETE = "complete"           # All outputs generated


class Initiative(Base):
    __tablename__ = "initiatives"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        primary_key=True, 
        default=uuid.uuid4
    )
    user_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    
    # Project description (free-form from initial conversation)
    project_description: Mapped[str | None] = mapped_column(Text)
    project_type: Mapped[str | None] = mapped_column(String(100))  # Classified type
    
    # Legacy fields (kept for backward compatibility)
    title: Mapped[str | None] = mapped_column(String(255))
    icon: Mapped[str | None] = mapped_column(String(50))  # lucide-react icon name
    sector: Mapped[str] = mapped_column(String(100), default="general")
    geography: Mapped[str | None] = mapped_column(String(255))
    target_population: Mapped[str | None] = mapped_column(Text)
    goal: Mapped[str | None] = mapped_column(Text)
    budget_range: Mapped[str | None] = mapped_column(String(100))
    timeline: Mapped[str | None] = mapped_column(String(100))
    constraints: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    
    # Tool-based workflow
    selected_tools: Mapped[list[str] | None] = mapped_column(ARRAY(Text))  # Tool IDs
    tool_inputs: Mapped[dict | None] = mapped_column(JSONB)  # Tool-specific inputs
    tool_alignments: Mapped[dict | None] = mapped_column(JSONB)  # Tool alignments (outline, params) keyed by tool_id
    deliverables: Mapped[dict | None] = mapped_column(JSONB)  # Generated output references
    
    # Stage tracking
    stage: Mapped[str] = mapped_column(
        String(20), 
        default=InitiativeStage.DESCRIBE.value
    )
    
    # Legacy stage flags (for backward compatibility)
    stage_1_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    evidence_ready: Mapped[bool] = mapped_column(Boolean, default=False)
    
    # Archive flag for soft delete
    archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        server_default=func.now(),
        nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        server_default=func.now(),
        nullable=False
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
    
    # New workflow methods
    def has_project_description(self) -> bool:
        """Check if project has been described."""
        return bool(self.project_description and len(self.project_description) > 10)
    
    def has_selected_tools(self) -> bool:
        """Check if tools have been selected."""
        return bool(self.selected_tools and len(self.selected_tools) > 0)
    
    def get_missing_tool_inputs(self) -> dict[str, list[str]]:
        """Get missing required inputs for selected tools."""
        from app.tools import get_tool_registry
        
        missing = {}
        registry = get_tool_registry()
        
        if not self.selected_tools:
            return missing
        
        tool_inputs = self.tool_inputs or {}
        
        for tool_id in self.selected_tools:
            tool = registry.get_tool(tool_id)
            if tool:
                tool_missing = []
                for inp in tool.required_inputs:
                    if inp.name not in tool_inputs or not tool_inputs.get(inp.name):
                        tool_missing.append(inp.name)
                if tool_missing:
                    missing[tool_id] = tool_missing
        
        return missing
    
    def is_ready_to_generate(self) -> bool:
        """Check if all required inputs are gathered."""
        return (
            self.has_project_description() and
            self.has_selected_tools() and
            len(self.get_missing_tool_inputs()) == 0
        )
    
    def get_alignment_for_tool(self, tool_id: str) -> dict | None:
        """Get alignment configuration for a specific tool."""
        if not self.tool_alignments:
            return None
        return self.tool_alignments.get(tool_id)
    
    def set_alignment_for_tool(self, tool_id: str, alignment: dict):
        """Set alignment configuration for a specific tool."""
        if self.tool_alignments is None:
            self.tool_alignments = {}
        self.tool_alignments[tool_id] = alignment
        # Force SQLAlchemy to detect the JSONB change by reassigning the dict
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(self, "tool_alignments")
    
    def has_confirmed_alignments(self) -> bool:
        """Check if all selected tools have confirmed alignments."""
        if not self.selected_tools:
            return True  # No tools selected
        if not self.tool_alignments:
            return False
        
        from app.tools import get_tool_registry
        registry = get_tool_registry()
        
        for tool_id in self.selected_tools:
            tool = registry.get_tool(tool_id)
            if tool and tool.requires_alignment:
                alignment = self.tool_alignments.get(tool_id)
                if not alignment or not alignment.get("confirmed"):
                    return False
        return True
    
    def get_pending_alignment_tools(self) -> list[str]:
        """Get list of tool IDs that require alignment but haven't been confirmed."""
        if not self.selected_tools:
            return []
        
        from app.tools import get_tool_registry
        registry = get_tool_registry()
        
        pending = []
        alignments = self.tool_alignments or {}
        
        for tool_id in self.selected_tools:
            tool = registry.get_tool(tool_id)
            if tool and tool.requires_alignment:
                alignment = alignments.get(tool_id)
                if not alignment or not alignment.get("confirmed"):
                    pending.append(tool_id)
        return pending
    
    def touch(self):
        """Update the updated_at timestamp to mark this initiative as recently modified."""
        self.updated_at = datetime.now(timezone.utc)
    
    # Legacy methods (for backward compatibility)
    def is_intake_complete(self) -> bool:
        """Check if required intake fields are populated (legacy)."""
        return all([
            self.title,
            self.sector,
            self.geography,
            self.target_population,
            self.goal,
        ])
    
    def to_summary_dict(self) -> dict:
        """Get initiative summary for confirmation widget."""
        # Generate a fallback title from project_description if title is missing
        title = self.title
        if not title and self.project_description:
            # Extract first meaningful phrase (up to 60 chars, end at word boundary)
            desc = self.project_description.strip()
            if len(desc) > 60:
                title = desc[:60].rsplit(' ', 1)[0] + "..."
            else:
                title = desc
        
        return {
            "title": title,
            "sector": self.sector,
            "geography": self.geography,
            "target_population": self.target_population,
            "goal": self.goal,
            "budget_range": self.budget_range,
            "timeline": self.timeline,
            "constraints": self.constraints or [],
            # New fields
            "project_description": self.project_description,
            "project_type": self.project_type,
            "selected_tools": self.selected_tools or [],
            "tool_inputs": self.tool_inputs or {},
        }


# Import for relationship typing
from app.models.chat import ChatMessage
from app.models.evidence import EvidenceDoc
from app.models.memo import MemoVersion
