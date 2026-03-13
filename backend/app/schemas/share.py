from pydantic import BaseModel
from typing import Optional, Literal
from datetime import datetime
from uuid import UUID


class ShareCreate(BaseModel):
    email: str
    role: Literal["editor", "viewer", "client"]


class ShareUpdate(BaseModel):
    role: Literal["editor", "viewer", "client"]


class ShareResponse(BaseModel):
    id: UUID
    initiative_id: UUID
    user_id: str
    user_email: Optional[str] = None
    user_display_name: Optional[str] = None
    role: str
    created_at: datetime

    class Config:
        from_attributes = True


class UserSearchResult(BaseModel):
    id: str
    email: Optional[str] = None
    display_name: Optional[str] = None

    class Config:
        from_attributes = True
