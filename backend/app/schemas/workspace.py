from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class WorkspaceCreate(BaseModel):
    """Request body for creating a team workspace."""

    name: str = Field(..., min_length=1, max_length=255, description="Workspace display name.")
    description: str | None = Field(None, max_length=5000, description="Optional workspace description.")


class WorkspaceUpdate(BaseModel):
    """Request body for updating workspace metadata."""

    name: str | None = Field(None, min_length=1, max_length=255, description="Workspace display name.")
    icon: str | None = Field(None, min_length=1, max_length=64, description="Workspace icon name.")
    description: str | None = Field(None, max_length=5000, description="Optional workspace description.")


class WorkspaceMemberAdd(BaseModel):
    """Request body for adding a member to a workspace."""

    email: str = Field(..., min_length=3, max_length=255, description="Email address of the user to add.")


class WorkspaceMemberResponse(BaseModel):
    """Workspace membership response."""

    id: UUID = Field(..., description="Membership or pending-invitation identifier.")
    workspace_id: UUID = Field(..., description="Workspace identifier.")
    user_id: str | None = Field(None, description="Member user identifier (null while invite is pending).")
    user_email: str | None = Field(None, description="Member email address.")
    user_display_name: str | None = Field(None, description="Member display name.")
    role: str = Field(..., description="Workspace role: owner or member.")
    created_at: datetime = Field(..., description="Membership creation timestamp.")
    pending: bool = Field(False, description="True if this row is a pre-signup invitation.")


class WorkspaceResponse(BaseModel):
    """Workspace response with the caller's role."""

    id: UUID = Field(..., description="Workspace identifier.")
    name: str = Field(..., description="Workspace display name.")
    icon: str = Field(..., description="Workspace icon name.")
    description: str | None = Field(None, description="Optional workspace description.")
    workspace_type: str = Field(..., description="Workspace type: personal or team.")
    current_user_role: str = Field(..., description="Caller role in the workspace: owner or member.")
    created_at: datetime = Field(..., description="Workspace creation timestamp.")
    updated_at: datetime = Field(..., description="Workspace update timestamp.")


class WorkspaceDetailResponse(WorkspaceResponse):
    """Workspace response including member list."""

    members: list[WorkspaceMemberResponse] = Field(default_factory=list, description="Workspace members.")


class WorkspaceKnowledgeBankCreate(BaseModel):
    """Request body for adding a workspace knowledge bank."""

    name: str = Field(..., min_length=1, max_length=255, description="Knowledge bank display name.")
    base_url: str = Field(..., min_length=5, max_length=2048, description="Knowledge bank base URL.")


class WorkspaceKnowledgeBankUpdate(BaseModel):
    """Request body for updating a workspace knowledge bank."""

    name: str | None = Field(None, min_length=1, max_length=255, description="Knowledge bank display name.")
    base_url: str | None = Field(None, min_length=5, max_length=2048, description="Knowledge bank base URL.")
    is_active: bool | None = Field(None, description="Whether this knowledge bank is active for retrieval.")


class WorkspaceKnowledgeBankResponse(BaseModel):
    """Workspace knowledge bank response."""

    id: UUID = Field(..., description="Knowledge bank identifier.")
    workspace_id: UUID = Field(..., description="Workspace identifier.")
    name: str = Field(..., description="Knowledge bank display name.")
    base_url: str = Field(..., description="Knowledge bank base URL.")
    is_active: bool = Field(..., description="Whether the knowledge bank is active.")
    status: str = Field(..., description="Indexing status.")
    last_indexed_at: datetime | None = Field(None, description="Most recent successful indexing timestamp.")
    index_error: str | None = Field(None, description="Most recent indexing error.")
    created_at: datetime = Field(..., description="Knowledge bank creation timestamp.")
    updated_at: datetime = Field(..., description="Knowledge bank update timestamp.")
