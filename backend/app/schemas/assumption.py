from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


AssumptionStatus = Literal["confirmed", "needs_review", "missing", "rejected"]
AssumptionSourceType = Literal[
    "extraction",
    "user_input",
    "module",
    "default",
    "missing_placeholder",
    "model_candidate",
]
AssumptionValueType = Literal["number", "string", "boolean", "percent", "currency", "text"]


class AssumptionBase(BaseModel):
    key: str = Field(description="Stable machine key for the project-level assumption.")
    label: str = Field(description="Human-readable assumption label.")
    value: Any = Field(default=None, description="Structured assumption value.")
    unit: str | None = Field(default=None, description="Unit for quantitative assumptions.")
    value_type: AssumptionValueType = Field(description="Type of value stored by the assumption.")
    source_type: AssumptionSourceType = Field(description="How the assumption was created.")
    source_reference: dict[str, Any] | None = Field(
        default=None,
        description="Structured provenance such as material ids, module/stage fields, or extraction metadata.",
    )
    status: AssumptionStatus = Field(description="Review lifecycle status.")
    used_in_modules: list[str] = Field(default_factory=list, description="Module ids that use this assumption.")
    notes: str | None = Field(default=None, description="Optional user-facing notes.")


class AssumptionCreate(BaseModel):
    key: str = Field(description="Assumption key.")
    label: str | None = Field(default=None, description="Override label; defaults from config.")
    value: Any = Field(default=None, description="Assumption value.")
    unit: str | None = Field(default=None, description="Unit override.")
    value_type: AssumptionValueType | None = Field(default=None, description="Value type override.")
    source_type: AssumptionSourceType = Field(default="user_input", description="Creation source.")
    source_reference: dict[str, Any] | None = Field(default=None, description="Creation provenance.")
    status: AssumptionStatus = Field(default="confirmed", description="Initial status.")
    used_in_modules: list[str] = Field(default_factory=list, description="Modules using the assumption.")
    notes: str | None = Field(default=None, description="Optional notes.")


class AssumptionUpdate(BaseModel):
    label: str | None = Field(default=None, description="Updated label.")
    value: Any = Field(default=None, description="Updated assumption value.")
    unit: str | None = Field(default=None, description="Updated unit.")
    value_type: AssumptionValueType | None = Field(default=None, description="Updated value type.")
    source_type: AssumptionSourceType | None = Field(default=None, description="Updated source type.")
    source_reference: dict[str, Any] | None = Field(default=None, description="Updated provenance.")
    status: AssumptionStatus | None = Field(default=None, description="Updated status.")
    used_in_modules: list[str] | None = Field(default=None, description="Updated module usage.")
    notes: str | None = Field(default=None, description="Updated notes.")


class AssumptionResponse(AssumptionBase):
    id: UUID
    initiative_id: UUID
    created_by_email: str | None = None
    last_updated_by_email: str | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AssumptionSummaryItem(BaseModel):
    id: UUID = Field(description="Assumption id.")
    key: str = Field(description="Assumption key.")
    label: str = Field(description="Assumption label.")
    status: AssumptionStatus = Field(description="Assumption status.")
    used_in_modules: list[str] = Field(default_factory=list, description="Modules using this assumption.")


class AssumptionSummary(BaseModel):
    total: int = Field(description="Total tracked assumptions excluding rejected assumptions.")
    confirmed: int = Field(description="Confirmed assumption count.")
    needs_review: int = Field(description="Needs-review assumption count.")
    missing: int = Field(description="Missing assumption count.")
    top_attention: list[AssumptionSummaryItem] = Field(
        default_factory=list,
        description="Top missing or needs-review assumptions.",
    )


class AssumptionRefreshResponse(BaseModel):
    created: int = Field(description="Number of assumptions created.")
    updated: int = Field(description="Number of assumptions updated.")
    assumptions: list[AssumptionResponse] = Field(description="Assumptions touched by refresh.")


class AssumptionCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000, description="Comment body.")


class AssumptionCommentResponse(BaseModel):
    id: UUID = Field(description="Assumption comment id.")
    assumption_id: UUID = Field(description="Assumption this comment belongs to.")
    initiative_id: UUID = Field(description="Project this comment belongs to.")
    body: str = Field(description="Comment body.")
    created_by_email: str | None = Field(default=None, description="Readable author email.")
    created_at: datetime = Field(description="Comment creation timestamp.")

    class Config:
        from_attributes = True
