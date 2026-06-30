import enum
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import ARRAY, Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.assessment_instance import AssessmentInstance
    from app.models.evidence import EvidenceDoc
    from app.models.finding import Finding
    from app.models.memo import MemoVersion
    from app.models.project_material import ProjectMaterial
    from app.models.workspace import Workspace


class ProjectStage(str, enum.Enum):
    """Stages of the project workflow."""

    DESCRIBE = "describe"
    PLAN = "plan"
    EXECUTE = "execute"
    SELECT_TOOLS = "select_tools"
    GATHER_INPUTS = "gather_inputs"
    REVIEW = "review"
    GENERATE = "generate"
    COMPLETE = "complete"


class Project(Base):
    """Shared diligence project (deal). Canonical replacement for the legacy initiatives table."""

    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    subject: Mapped[str | None] = mapped_column(Text)
    slug: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    created_by: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    project_type: Mapped[str | None] = mapped_column(String(100))
    icon: Mapped[str | None] = mapped_column(String(50))
    sector: Mapped[str] = mapped_column(String(100), default="general")
    geography: Mapped[str | None] = mapped_column(String(255))
    target_population: Mapped[str | None] = mapped_column(Text)
    goal: Mapped[str | None] = mapped_column(Text)
    budget_range: Mapped[str | None] = mapped_column(String(100))
    timeline: Mapped[str | None] = mapped_column(String(100))
    constraints: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    selected_tools: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    tool_inputs: Mapped[dict | None] = mapped_column(JSONB)
    tool_alignments: Mapped[dict | None] = mapped_column(JSONB)
    deliverables: Mapped[dict | None] = mapped_column(JSONB)
    project_plan: Mapped[dict | None] = mapped_column(JSONB)
    overview_description: Mapped[str | None] = mapped_column(Text)
    overview_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stage: Mapped[str] = mapped_column(String(20), default=ProjectStage.DESCRIBE.value)
    stage_1_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    evidence_ready: Mapped[bool] = mapped_column(Boolean, default=False)

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

    workspace: Mapped["Workspace"] = relationship(back_populates="projects")
    findings: Mapped[list["Finding"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )
    evidence_docs: Mapped[list["EvidenceDoc"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )
    memo_versions: Mapped[list["MemoVersion"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )
    project_materials: Mapped[list["ProjectMaterial"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )
    assessment_instances: Mapped[list["AssessmentInstance"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="AssessmentInstance.started_at.desc()",
    )

    @property
    def title(self) -> str | None:
        return self.name

    @title.setter
    def title(self, value: str | None) -> None:
        if value is not None:
            self.name = value

    @property
    def user_id(self) -> str:
        return self.created_by

    @user_id.setter
    def user_id(self, value: str) -> None:
        self.created_by = value

    @property
    def project_description(self) -> str | None:
        return self.subject

    @project_description.setter
    def project_description(self, value: str | None) -> None:
        self.subject = value

    def has_project_description(self) -> bool:
        return bool(self.subject and len(self.subject) > 10)

    def has_selected_tools(self) -> bool:
        return bool(self.selected_tools and len(self.selected_tools) > 0)

    def get_missing_tool_inputs(self) -> dict[str, list[str]]:
        from app.assessments import get_assessment_registry

        missing: dict[str, list[str]] = {}
        registry = get_assessment_registry()
        if not self.selected_tools:
            return missing
        tool_inputs = self.tool_inputs or {}
        for tool_id in self.selected_tools:
            tool = registry.get_assessment(tool_id)
            if tool:
                tool_missing = [
                    inp.name
                    for inp in tool.required_inputs
                    if inp.name not in tool_inputs or not tool_inputs.get(inp.name)
                ]
                if tool_missing:
                    missing[tool_id] = tool_missing
        return missing

    def is_ready_to_generate(self) -> bool:
        return (
            self.has_project_description()
            and self.has_selected_tools()
            and len(self.get_missing_tool_inputs()) == 0
        )

    def get_deliverables_dict(self) -> dict:
        result: dict[str, dict] = {}
        for inst in self.assessment_instances:
            if inst.deliverable and inst.is_plan_complete:
                existing = result.get(inst.assessment_id)
                if existing is None or inst.updated_at > existing.get("_updated_at", inst.updated_at):
                    d = dict(inst.deliverable)
                    d["_updated_at"] = inst.updated_at
                    d["_instance_id"] = str(inst.id)
                    result[inst.assessment_id] = d
        for value in result.values():
            value.pop("_updated_at", None)
        return result

    def get_tool_alignments_dict(self) -> dict:
        result: dict[str, dict] = {}
        latest_ts: dict[str, datetime] = {}
        for inst in self.assessment_instances:
            if inst.alignment:
                prev = latest_ts.get(inst.assessment_id)
                if prev is None or inst.updated_at > prev:
                    result[inst.assessment_id] = dict(inst.alignment)
                    latest_ts[inst.assessment_id] = inst.updated_at
        return result

    def touch(self) -> None:
        self.updated_at = datetime.now(timezone.utc)

    def is_intake_complete(self) -> bool:
        return all([self.name, self.sector, self.geography, self.target_population, self.goal])

    def to_summary_dict(self) -> dict:
        title = self.name
        if not title and self.subject:
            desc = self.subject.strip()
            title = desc[:60].rsplit(" ", 1)[0] + "..." if len(desc) > 60 else desc
        return {
            "title": title,
            "sector": self.sector,
            "geography": self.geography,
            "target_population": self.target_population,
            "goal": self.goal,
            "budget_range": self.budget_range,
            "timeline": self.timeline,
            "constraints": self.constraints or [],
            "project_description": self.subject,
            "project_type": self.project_type,
            "selected_tools": self.selected_tools or [],
            "tool_inputs": self.tool_inputs or {},
        }

