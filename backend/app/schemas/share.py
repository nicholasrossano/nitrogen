from pydantic import BaseModel
from typing import Optional, Literal
from datetime import datetime
from uuid import UUID


class ShareCreate(BaseModel):
    email: str
    role: Literal["editor", "viewer"]


class ShareUpdate(BaseModel):
    role: Literal["editor", "viewer"]


class ShareResponse(BaseModel):
    id: UUID
    project_id: UUID
    user_id: Optional[str] = None
    user_email: Optional[str] = None
    user_display_name: Optional[str] = None
    role: str
    created_at: datetime
    pending: bool = False

    class Config:
        from_attributes = True


class UserSearchResult(BaseModel):
    id: str
    email: Optional[str] = None
    display_name: Optional[str] = None

    class Config:
        from_attributes = True
