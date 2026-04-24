from pydantic import BaseModel
from typing import Any, Optional
from datetime import datetime
from uuid import UUID


class ProjectMaterialResponse(BaseModel):
    id: UUID
    filename: str
    file_type: str
    file_size: Optional[int] = None
    created_at: datetime
    source: str = "material"  # "material" or "evidence"
    # Only meaningful for source == "evidence"; plain project materials have no
    # background processing lifecycle and are treated as immediately ready.
    processing_status: Optional[str] = None
    processing_error: Optional[str] = None

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
    export_data: Optional[dict[str, Any]] = None


class ProjectFilesResponse(BaseModel):
    uploaded: list[ProjectMaterialResponse]
    generated: list[GeneratedFileResponse]
