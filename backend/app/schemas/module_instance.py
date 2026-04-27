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
    instance_number: Optional[int] = None
    creator_handle: Optional[str] = None
    display_name: Optional[str] = None
    started_by: str
    started_by_email: Optional[str] = None
    started_at: datetime
    updated_at: datetime
    chat_id: Optional[UUID] = None
    deliverable: Optional[dict] = None
    workflow_state: Optional[dict] = None
    is_plan_complete: bool = False
