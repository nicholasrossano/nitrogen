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
    # New tool-based fields
    project_description: Optional[str] = None
    project_type: Optional[str] = None
    selected_tools: Optional[list[str]] = None
    tool_inputs: Optional[dict] = None
    tool_alignments: Optional[dict] = None
    deliverables: Optional[dict] = None
    
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
