from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


VariableStatus = Literal["validated", "extracted", "assumed", "missing"]
VariableSourceType = Literal[
    "extraction",
    "user_input",
    "assessment",
    "assessment_approval",
    "chat_approval",
    "default",
    "missing_placeholder",
    "model_candidate",
    "promotion",
]
VariableValueType = Literal["number", "string", "boolean", "percent", "currency", "text"]


class VariableBase(BaseModel):
    key: str = Field(description="Stable machine key for the project-level variable.")
    label: str = Field(description="Human-readable variable label.")
    value: Any = Field(default=None, description="Structured variable value.")
    unit: str | None = Field(default=None, description="Unit for quantitative variables.")
    value_type: VariableValueType = Field(description="Type of value stored by the variable.")
    source_type: VariableSourceType = Field(description="How the variable was created.")
    source_reference: dict[str, Any] | None = Field(
        default=None,
        description="Structured provenance such as material ids, assessment/stage fields, or extraction metadata.",
    )
    aliases: list[str] | None = Field(
        default=None,
        description="Observed surface forms merged into this canonical variable.",
    )
    status: VariableStatus = Field(description="Review lifecycle status.")
    used_in_assessments: list[str] = Field(default_factory=list, description="Assessment ids that use this variable.")
    notes: str | None = Field(default=None, description="Optional user-facing notes.")


class VariableCreate(BaseModel):
    key: str = Field(description="Variable key.")
    label: str | None = Field(default=None, description="Override label; defaults from config.")
    value: Any = Field(default=None, description="Variable value.")
    unit: str | None = Field(default=None, description="Unit override.")
    value_type: VariableValueType | None = Field(default=None, description="Value type override.")
    source_type: VariableSourceType = Field(default="user_input", description="Creation source.")
    source_reference: dict[str, Any] | None = Field(default=None, description="Creation provenance.")
    status: VariableStatus = Field(default="validated", description="Initial status.")
    used_in_assessments: list[str] = Field(default_factory=list, description="Assessments using the variable.")
    notes: str | None = Field(default=None, description="Optional notes.")


class VariableUpdate(BaseModel):
    label: str | None = Field(default=None, description="Updated label.")
    value: Any = Field(default=None, description="Updated variable value.")
    unit: str | None = Field(default=None, description="Updated unit.")
    value_type: VariableValueType | None = Field(default=None, description="Updated value type.")
    source_type: VariableSourceType | None = Field(default=None, description="Updated source type.")
    source_reference: dict[str, Any] | None = Field(default=None, description="Updated provenance.")
    status: VariableStatus | None = Field(default=None, description="Updated status.")
    used_in_assessments: list[str] | None = Field(default=None, description="Updated assessment usage.")
    notes: str | None = Field(default=None, description="Updated notes.")


class VariableResponse(VariableBase):
    id: UUID
    project_id: UUID
    created_by_email: str | None = None
    last_updated_by_email: str | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class VariableSummaryItem(BaseModel):
    id: UUID = Field(description="Variable id.")
    key: str = Field(description="Variable key.")
    label: str = Field(description="Variable label.")
    status: VariableStatus = Field(description="Variable status.")
    used_in_assessments: list[str] = Field(default_factory=list, description="Assessments using this variable.")


class VariableSummary(BaseModel):
    total: int = Field(description="Total tracked active variables.")
    validated: int = Field(description="Validated variable count.")
    extracted: int = Field(description="Extracted variable count.")
    assumed: int = Field(description="Assumed variable count.")
    missing: int = Field(description="Missing variable count.")
    top_attention: list[VariableSummaryItem] = Field(
        default_factory=list,
        description="Top non-validated variables needing attention.",
    )


class VariableRefreshResponse(BaseModel):
    created: int = Field(description="Number of variables created.")
    updated: int = Field(description="Number of variables updated.")
    variables: list[VariableResponse] = Field(description="Variables touched by refresh.")


class VariableResolveResponse(BaseModel):
    found: bool = Field(description="Whether a matching variable was resolved.")
    variable: VariableResponse | None = Field(
        default=None,
        description="Resolved variable when one exists for the assessment field.",
    )


class VariableCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000, description="Comment body.")


class VariableFromChatRequest(BaseModel):
    key: str = Field(description="Variable key or label to promote.")
    value: Any = Field(description="Approved value from chat.")
    label: str | None = Field(default=None, description="Optional human label.")
    unit: str | None = Field(default=None, description="Optional unit.")
    value_type: VariableValueType | None = Field(default=None, description="Optional value type.")
    chat_id: UUID | None = Field(default=None, description="Source chat id.")
    chat_message_id: UUID | None = Field(default=None, description="Source chat message id.")
    quote: str | None = Field(default=None, description="Optional supporting quote.")


class VariableCommentResponse(BaseModel):
    id: UUID = Field(description="Variable comment id.")
    variable_id: UUID = Field(description="Variable this comment belongs to.")
    project_id: UUID = Field(description="Project this comment belongs to.")
    body: str = Field(description="Comment body.")
    created_by_email: str | None = Field(default=None, description="Readable author email.")
    created_at: datetime = Field(description="Comment creation timestamp.")

    class Config:
        from_attributes = True
