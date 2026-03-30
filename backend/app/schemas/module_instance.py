from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import datetime
from uuid import UUID


class ModuleInstanceResponse(BaseModel):
    """Lightweight instance info for list views and the Open picker."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    # DB column / ORM attribute is tool_id; API surface keeps module_id for frontend compat
    module_id: str = Field(alias="tool_id")
    status: str
    title: Optional[str] = None
    started_by: str
    started_by_email: Optional[str] = None
    started_at: datetime
    updated_at: datetime
    session_id: Optional[UUID] = None
