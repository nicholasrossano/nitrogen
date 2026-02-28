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


class SourceCitation(BaseModel):
    """Citation for a fact used in a message"""
    source_type: str  # corpus, evidence, web, llm_estimate
    source_title: str
    source_url: Optional[str] = None
    chunk_id: Optional[str] = None
    confidence: float = 1.0


class ChatMessageResponse(BaseModel):
    """Response for a single chat message"""
    id: UUID
    role: str
    content: str
    widget_type: Optional[str] = None
    widget_data: Optional[dict[str, Any]] = None
    sources: Optional[list[SourceCitation]] = None
    feedback: Optional[str] = None
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


# Alignment schemas
class AlignmentSectionSchema(BaseModel):
    """A section within a tool alignment"""
    id: str
    title: str
    description: str
    key_points: list[str] = Field(default_factory=list)
    include: bool = True
    order: int = 0


class AlignmentParameterSchema(BaseModel):
    """A configurable parameter for tool alignment"""
    name: str
    label: str
    description: str
    param_type: str  # "text", "number", "select", "boolean"
    value: Any
    options: Optional[list[str]] = None
    unit: Optional[str] = None


class ToolAlignmentSchema(BaseModel):
    """Alignment configuration for a tool"""
    tool_id: str
    title: str
    description: str
    sections: list[AlignmentSectionSchema] = Field(default_factory=list)
    parameters: list[AlignmentParameterSchema] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    confirmed: bool = False
    feedback: Optional[str] = None


class AlignmentFeedbackRequest(BaseModel):
    """Request to provide feedback on an alignment"""
    tool_id: str
    feedback: str = Field(..., min_length=1, max_length=5000)


class AlignmentConfirmRequest(BaseModel):
    """Request to confirm an alignment, optionally with modifications"""
    tool_id: str
    sections: Optional[list[AlignmentSectionSchema]] = None  # Optional modifications
    parameters: Optional[list[AlignmentParameterSchema]] = None


class AlignmentResponse(BaseModel):
    """Response containing alignment data"""
    alignment: ToolAlignmentSchema
    message: str


class MessageFeedbackRequest(BaseModel):
    """Request to set like/dislike feedback on a message"""
    feedback: Optional[str] = Field(None, pattern=r'^(like|dislike)$', description="'like', 'dislike', or null to clear")


class TruncateChatRequest(BaseModel):
    """Request to truncate chat from a given message onward"""
    from_message_id: str = Field(..., description="Delete this message and all messages after it")


class TruncateChatResponse(BaseModel):
    """Response after truncating chat"""
    deleted_count: int
    messages: list[ChatMessageResponse]


class RetryResponse(BaseModel):
    """Response after retrying an assistant message"""
    message: ChatMessageResponse
    stage_status: StageStatus
