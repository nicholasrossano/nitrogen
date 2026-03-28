from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from uuid import UUID


class ModuleInstanceResponse(BaseModel):
    """Lightweight instance info for list views and the Open picker."""
    id: UUID
    tool_id: str
    status: str
    title: Optional[str] = None
    started_by: str
    started_by_email: Optional[str] = None
    started_at: datetime
    updated_at: datetime
    session_id: Optional[UUID] = None

    class Config:
        from_attributes = True
