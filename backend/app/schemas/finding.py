from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class FindingCreate(BaseModel):
    body: str = Field(min_length=1)
    sources: list[dict[str, Any]] | None = None
    source_chat_message_id: UUID | None = None


class FindingPromoteRequest(BaseModel):
    chat_message_id: UUID
    project_id: UUID
    body: str | None = None


class FindingResponse(BaseModel):
    id: UUID
    project_id: UUID
    body: str
    sources: list[dict[str, Any]] | None = None
    promoted_by: str
    source_chat_message_id: UUID | None = None
    status: str
    created_at: datetime
    updated_at: datetime
    promoter_email: str | None = None

    model_config = {"from_attributes": True}
