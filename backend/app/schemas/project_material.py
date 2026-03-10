from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from uuid import UUID


class ProjectMaterialResponse(BaseModel):
    id: UUID
    filename: str
    file_type: str
    file_size: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ProjectMaterialUploadResponse(BaseModel):
    success: bool
    material: ProjectMaterialResponse
    message: str
