from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime
from uuid import UUID


class ModuleInstanceResponse(BaseModel):
    """Lightweight instance info for list views and the Open picker."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    module_id: str
    status: str
    title: Optional[str] = None
    started_by: str
    started_by_email: Optional[str] = None
    started_at: datetime
    updated_at: datetime
    session_id: Optional[UUID] = None
