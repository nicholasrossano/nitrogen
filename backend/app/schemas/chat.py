from pydantic import BaseModel, Field
from typing import Optional, Any
from datetime import datetime
from uuid import UUID


class ChatMessageCreate(BaseModel):
    """Schema for sending a chat message"""
    content: str = Field(..., min_length=1, max_length=10000)


class WidgetData(BaseModel):
    """Widget data attached to a message"""
    type: str
    data: dict[str, Any] = Field(default_factory=dict)


class ChatMessageResponse(BaseModel):
    """Response for a single chat message"""
    id: UUID
    role: str
    content: str
    widget_type: Optional[str] = None
    widget_data: Optional[dict[str, Any]] = None
    created_at: datetime
    
    class Config:
        from_attributes = True


class ExtractedFields(BaseModel):
    """Fields extracted from conversation"""
    title: Optional[str] = None
    sector: Optional[str] = None
    geography: Optional[str] = None
    target_population: Optional[str] = None
    goal: Optional[str] = None
    budget_range: Optional[str] = None
    timeline: Optional[str] = None
    constraints: Optional[list[str]] = None


class StageStatus(BaseModel):
    """Current stage status"""
    stage: str
    stage_1_complete: bool
    evidence_ready: bool
    required_fields_complete: bool
    missing_fields: list[str] = Field(default_factory=list)


class ChatResponse(BaseModel):
    """Response from chat endpoint"""
    message: ChatMessageResponse
    extracted_fields: Optional[ExtractedFields] = None
    stage_status: StageStatus
    show_confirmation: bool = False
    trigger_tools_next: bool = False  # Signal frontend to immediately request tool recommendations


class ChatHistoryResponse(BaseModel):
    """Response for chat history"""
    messages: list[ChatMessageResponse]
    stage_status: StageStatus
