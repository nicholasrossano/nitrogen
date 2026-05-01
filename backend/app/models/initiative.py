import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING
from sqlalchemy import String, Text, Boolean, ARRAY, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
import enum

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.workspace import Workspace


class InitiativeStage(str, enum.Enum):
    """Stages of the initiative workflow."""
    DESCRIBE = "describe"           # User describes their project
    PLAN = "plan"                   # Project plan generated, user reviewing
    EXECUTE = "execute"             # User working through plan items
    # Legacy stages kept for DB backward compatibility
    SELECT_TOOLS = "select_tools"
    GATHER_INPUTS = "gather_inputs"
    REVIEW = "review"
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
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    
    # Project description (free-form from initial conversation)
    project_description: Mapped[str | None] = mapped_column(Text)
    project_type: Mapped[str | None] = mapped_column(String(100))  # Classified type
    
    # Human-readable URL slug (generated once at creation, immutable by default)
    slug: Mapped[str] = mapped_column(String(120), nullable=False, default="")

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
    project_plan: Mapped[dict | None] = mapped_column(JSONB)  # 3-pillar needs map
    overview_description: Mapped[str | None] = mapped_column(Text)
    overview_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    
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
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
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
    project_materials: Mapped[list["ProjectMaterial"]] = relationship(
        back_populates="initiative",
        cascade="all, delete-orphan",
    )
    assessment_instances: Mapped[list["AssessmentInstance"]] = relationship(
        back_populates="initiative",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="AssessmentInstance.started_at.desc()",
    )
    workspace: Mapped["Workspace"] = relationship(back_populates="initiatives")
    
    # New workflow methods
    def has_project_description(self) -> bool:
        """Check if project has been described."""
        return bool(self.project_description and len(self.project_description) > 10)
    
    def has_selected_tools(self) -> bool:
        """Check if tools have been selected."""
        return bool(self.selected_tools and len(self.selected_tools) > 0)
    
    def get_missing_tool_inputs(self) -> dict[str, list[str]]:
        """Get missing required inputs for selected tools."""
        from app.assessments import get_assessment_registry
        
        missing = {}
        registry = get_assessment_registry()
        
        if not self.selected_tools:
            return missing
        
        tool_inputs = self.tool_inputs or {}
        
        for tool_id in self.selected_tools:
            tool = registry.get_assessment(tool_id)
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
    
    # ── Computed views from assessment_instances (replaces JSONB reads) ──

    def get_deliverables_dict(self) -> dict:
        """Build a backward-compatible deliverables dict from assessment_instances.

        Returns the latest approved instance's deliverable per tool_id.
        """
        result: dict[str, dict] = {}
        for inst in self.assessment_instances:
            if inst.deliverable and inst.is_plan_complete:
                existing = result.get(inst.assessment_id)
                if existing is None or inst.updated_at > existing.get("_updated_at", inst.updated_at):
                    d = dict(inst.deliverable)
                    d["_updated_at"] = inst.updated_at
                    d["_instance_id"] = str(inst.id)
                    result[inst.assessment_id] = d
        for v in result.values():
            v.pop("_updated_at", None)
        return result

    def get_tool_alignments_dict(self) -> dict:
        """Build a backward-compatible tool_alignments dict from assessment_instances.

        Returns the latest instance's alignment per tool_id.
        """
        result: dict[str, dict] = {}
        latest_ts: dict[str, datetime] = {}
        for inst in self.assessment_instances:
            if inst.alignment:
                prev = latest_ts.get(inst.assessment_id)
                if prev is None or inst.updated_at > prev:
                    result[inst.assessment_id] = dict(inst.alignment)
                    latest_ts[inst.assessment_id] = inst.updated_at
        return result

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
from app.models.onboarding import ChatMessage  # noqa: E402
from app.models.evidence import EvidenceDoc  # noqa: E402
from app.models.memo import MemoVersion  # noqa: E402
from app.models.project_material import ProjectMaterial  # noqa: E402
from app.models.assessment_instance import AssessmentInstance  # noqa: E402
