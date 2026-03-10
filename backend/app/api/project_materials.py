from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sql_delete
from uuid import UUID
import logging

from app.core.database import get_db
from app.core.auth import get_current_user, MockUser
from app.core.storage import get_uploads_storage
from app.models.initiative import Initiative
from app.models.project_material import ProjectMaterial
from app.schemas.project_material import (
    ProjectMaterialResponse,
    ProjectMaterialUploadResponse,
)
from app.services.document_parser import DocumentParserService

logger = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_CONTENT_TYPES = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/plain": "txt",
    "text/csv": "csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
    "image/png": "png",
    "image/jpeg": "jpg",
}


async def _get_initiative_for_user(
    initiative_id: UUID, user: MockUser, db: AsyncSession
) -> Initiative:
    result = await db.execute(
        select(Initiative).where(
            Initiative.id == initiative_id,
            Initiative.user_id == user.uid,
        )
    )
    initiative = result.scalar_one_or_none()
    if not initiative:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Initiative not found",
        )
    return initiative


@router.post(
    "/initiatives/{initiative_id}/materials",
    response_model=ProjectMaterialUploadResponse,
)
async def upload_material(
    initiative_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Upload a file as project-level context material."""
    initiative = await _get_initiative_for_user(initiative_id, user, db)

    file_type = ALLOWED_CONTENT_TYPES.get(file.content_type or "")
    if not file_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type: {file.content_type}. Allowed: PDF, DOCX, TXT, CSV, XLSX, PNG, JPG",
        )

    content = await file.read()
    storage = get_uploads_storage()
    storage_path = await storage.save(
        content, file.filename or "file", folder=f"{initiative_id}/materials"
    )

    content_text = None
    parser = DocumentParserService()
    try:
        if file_type == "pdf":
            content_text = parser.parse_pdf(content)
        elif file_type == "docx":
            content_text = parser.parse_docx(content)
        elif file_type in ("txt", "csv"):
            content_text = content.decode("utf-8", errors="replace")
    except Exception:
        logger.warning("Could not extract text from %s", file.filename, exc_info=True)

    material = ProjectMaterial(
        initiative_id=initiative.id,
        filename=file.filename or "Untitled",
        file_type=file_type,
        storage_path=storage_path,
        file_size=len(content),
        content_text=content_text,
    )
    db.add(material)
    initiative.touch()
    await db.commit()
    await db.refresh(material)

    return ProjectMaterialUploadResponse(
        success=True,
        material=ProjectMaterialResponse(
            id=material.id,
            filename=material.filename,
            file_type=material.file_type,
            file_size=material.file_size,
            created_at=material.created_at,
        ),
        message=f"Material '{material.filename}' uploaded",
    )


@router.get(
    "/initiatives/{initiative_id}/materials",
    response_model=list[ProjectMaterialResponse],
)
async def list_materials(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """List all project materials for an initiative."""
    await _get_initiative_for_user(initiative_id, user, db)

    result = await db.execute(
        select(ProjectMaterial)
        .where(ProjectMaterial.initiative_id == initiative_id)
        .order_by(ProjectMaterial.created_at.desc())
    )
    materials = result.scalars().all()

    return [
        ProjectMaterialResponse(
            id=m.id,
            filename=m.filename,
            file_type=m.file_type,
            file_size=m.file_size,
            created_at=m.created_at,
        )
        for m in materials
    ]


@router.delete("/materials/{material_id}")
async def delete_material(
    material_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Delete a project material."""
    result = await db.execute(
        select(ProjectMaterial).where(ProjectMaterial.id == material_id)
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material not found",
        )

    await _get_initiative_for_user(material.initiative_id, user, db)

    if material.storage_path:
        storage = get_uploads_storage()
        await storage.delete(material.storage_path)

    await db.delete(material)
    await db.commit()

    return {"success": True, "message": "Material deleted"}
