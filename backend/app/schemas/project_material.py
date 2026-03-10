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


class GeneratedFileResponse(BaseModel):
    id: str
    title: str
    output_type: str
    created_at: Optional[datetime] = None
    exportable: bool = False
    export_format: Optional[str] = None
    exported: bool = False
    download_url: Optional[str] = None


class ProjectFilesResponse(BaseModel):
    uploaded: list[ProjectMaterialResponse]
    generated: list[GeneratedFileResponse]
