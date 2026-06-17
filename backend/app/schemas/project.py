from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    title: str | None = Field(default=None, description="Project display name")
    workspace_id: UUID | None = None


class ProjectUpdate(BaseModel):
    title: str | None = None
    subject: str | None = None
    icon: str | None = None
    archived: bool | None = None


class ProjectResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    name: str
    subject: str | None = None
    slug: str
    icon: str | None = None
    created_by: str
    archived: bool
    created_at: datetime
    updated_at: datetime
    shared_role: str | None = None
    owner_email: str | None = None

    model_config = {"from_attributes": True}
