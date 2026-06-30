from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    """Schema for creating a new project."""

    title: Optional[str] = None
    workspace_id: Optional[UUID] = None


class ProjectUpdate(BaseModel):
    """Schema for updating project fields."""

    title: Optional[str] = None
    subject: Optional[str] = None
    icon: Optional[str] = None
    workspace_id: Optional[UUID] = None
    sector: Optional[str] = None
    geography: Optional[str] = None
    target_population: Optional[str] = None
    goal: Optional[str] = None
    budget_range: Optional[str] = None
    timeline: Optional[str] = None
    constraints: Optional[list[str]] = None
    archived: Optional[bool] = None


class ProjectSummary(BaseModel):
    """Summary of project fields for confirmation widget."""

    title: Optional[str] = None
    sector: Optional[str] = None
    geography: Optional[str] = None
    target_population: Optional[str] = None
    goal: Optional[str] = None
    budget_range: Optional[str] = None
    timeline: Optional[str] = None
    constraints: list[str] = Field(default_factory=list)


class ProjectResponse(BaseModel):
    """Full project response."""

    id: UUID
    slug: str = ""
    user_id: str
    workspace_id: UUID
    title: Optional[str] = None
    icon: Optional[str] = None
    sector: str
    geography: Optional[str] = None
    target_population: Optional[str] = None
    goal: Optional[str] = None
    budget_range: Optional[str] = None
    timeline: Optional[str] = None
    constraints: Optional[list[str]] = None
    stage: str
    stage_1_complete: bool
    evidence_ready: bool
    archived: bool = False
    created_at: datetime
    updated_at: datetime
    project_description: Optional[str] = None
    project_type: Optional[str] = None
    overview_description: Optional[str] = None
    overview_generated_at: Optional[datetime] = None
    selected_tools: Optional[list[str]] = None
    tool_inputs: Optional[dict] = None
    assessment_alignments: Optional[dict] = None
    deliverables: Optional[dict] = None
    project_plan: Optional[dict] = None
    assessment_instances: Optional[list] = None
    assessment_instances_count: int = 0
    generated_assessments_count: int = 0
    shared_role: Optional[str] = None
    owner_email: Optional[str] = None

    model_config = {"from_attributes": True}


class ProjectConfirmRequest(BaseModel):
    """Request to confirm intake completion."""

    pass


class ProjectConfirmResponse(BaseModel):
    """Response after confirming intake."""

    success: bool
    stage: str
    message: str
