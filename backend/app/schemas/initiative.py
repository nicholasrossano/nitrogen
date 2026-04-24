from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from uuid import UUID


class InitiativeCreate(BaseModel):
    """Schema for creating a new initiative"""
    title: Optional[str] = None


class InitiativeUpdate(BaseModel):
    """Schema for updating initiative fields"""
    title: Optional[str] = None
    icon: Optional[str] = None
    sector: Optional[str] = None
    geography: Optional[str] = None
    target_population: Optional[str] = None
    goal: Optional[str] = None
    budget_range: Optional[str] = None
    timeline: Optional[str] = None
    constraints: Optional[list[str]] = None


class InitiativeSummary(BaseModel):
    """Summary of initiative fields for confirmation widget"""
    title: Optional[str] = None
    sector: Optional[str] = None
    geography: Optional[str] = None
    target_population: Optional[str] = None
    goal: Optional[str] = None
    budget_range: Optional[str] = None
    timeline: Optional[str] = None
    constraints: list[str] = Field(default_factory=list)


class InitiativeResponse(BaseModel):
    """Full initiative response"""
    id: UUID
    slug: str = ""
    user_id: str
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
    # Module-based fields
    project_description: Optional[str] = None
    project_type: Optional[str] = None
    overview_description: Optional[str] = None
    overview_generated_at: Optional[datetime] = None
    selected_tools: Optional[list[str]] = None
    tool_inputs: Optional[dict] = None
    module_alignments: Optional[dict] = None
    deliverables: Optional[dict] = None
    project_plan: Optional[dict] = None
    # Module instances
    module_instances: Optional[list] = None
    module_instances_count: int = 0
    # Non-archived instances with a completed generated deliverable (for grid tiles)
    generated_modules_count: int = 0
    # Sharing fields (null = owned by current user)
    shared_role: Optional[str] = None
    owner_email: Optional[str] = None
    
    class Config:
        from_attributes = True


class InitiativeConfirmRequest(BaseModel):
    """Request to confirm intake completion"""
    pass  # No body needed, just the action


class InitiativeConfirmResponse(BaseModel):
    """Response after confirming intake"""
    success: bool
    stage: str
    message: str
