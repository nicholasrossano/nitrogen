from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sql_delete
from uuid import UUID
import logging

from app.core.database import get_db
from app.core.auth import get_current_user, AuthUser
from app.core.permissions import require_editor, require_viewer
from app.core.storage import get_uploads_storage, get_storage
from app.core.filename_utils import deduplicate_filename
from app.models.evidence import EvidenceDoc
from app.models.memo import MemoVersion
from app.models.project_material import ProjectMaterial
from app.schemas.project_material import (
    ProjectMaterialResponse,
    ProjectMaterialUploadResponse,
    GeneratedFileResponse,
    ProjectFilesResponse,
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


@router.post(
    "/initiatives/{initiative_id}/materials",
    response_model=ProjectMaterialUploadResponse,
)
async def upload_material(
    initiative_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Upload a file as project-level context material."""
    initiative = await require_editor(db, initiative_id, user)

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
        elif file_type in ("xlsx", "xls"):
            content_text = parser.parse_xlsx(content)
    except Exception:
        logger.warning("Could not extract text from %s", file.filename, exc_info=True)

    unique_filename = await deduplicate_filename(
        db, initiative_id, file.filename or "Untitled"
    )

    material = ProjectMaterial(
        initiative_id=initiative.id,
        filename=unique_filename,
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
    user: AuthUser = Depends(get_current_user),
):
    """List all uploaded files for an initiative — materials and evidence docs combined."""
    await require_viewer(db, initiative_id, user)

    mat_result = await db.execute(
        select(ProjectMaterial)
        .where(ProjectMaterial.initiative_id == initiative_id)
        .order_by(ProjectMaterial.created_at.desc())
    )
    ev_result = await db.execute(
        select(EvidenceDoc)
        .where(
            EvidenceDoc.initiative_id == initiative_id,
            EvidenceDoc.storage_path.isnot(None),  # exclude text-paste entries
        )
        .order_by(EvidenceDoc.created_at.desc())
    )

    rows: list[ProjectMaterialResponse] = []
    for m in mat_result.scalars().all():
        rows.append(ProjectMaterialResponse(
            id=m.id,
            filename=m.filename,
            file_type=m.file_type,
            file_size=m.file_size,
            created_at=m.created_at,
            source="material",
        ))
    for e in ev_result.scalars().all():
        rows.append(ProjectMaterialResponse(
            id=e.id,
            filename=e.filename or "Untitled",
            file_type=e.file_type or "unknown",
            file_size=e.file_size,
            created_at=e.created_at,
            source="evidence",
        ))

    rows.sort(key=lambda r: r.created_at, reverse=True)
    return rows


@router.delete("/materials/{material_id}")
async def delete_material(
    material_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
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

    await require_editor(db, material.initiative_id, user)

    if material.storage_path:
        storage = get_uploads_storage()
        await storage.delete(material.storage_path)

    await db.delete(material)
    await db.commit()

    return {"success": True, "message": "Material deleted"}


EXPORT_FORMAT_MAP = {
    "memo": "docx",
    "checklist": "xlsx",
    "spreadsheet": "xlsx",
    "lcoe": "xlsx",
    "carbon": "xlsx",
}


@router.get(
    "/initiatives/{initiative_id}/files",
    response_model=ProjectFilesResponse,
)
async def list_project_files(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """List all project files: uploaded materials + generated outputs."""
    initiative = await require_viewer(db, initiative_id, user)

    # Uploaded materials (project_materials + evidence_docs with files)
    mat_result = await db.execute(
        select(ProjectMaterial)
        .where(ProjectMaterial.initiative_id == initiative_id)
        .order_by(ProjectMaterial.created_at.desc())
    )
    ev_result = await db.execute(
        select(EvidenceDoc)
        .where(
            EvidenceDoc.initiative_id == initiative_id,
            EvidenceDoc.storage_path.isnot(None),
        )
        .order_by(EvidenceDoc.created_at.desc())
    )
    uploaded: list[ProjectMaterialResponse] = []
    for m in mat_result.scalars().all():
        uploaded.append(ProjectMaterialResponse(
            id=m.id,
            filename=m.filename,
            file_type=m.file_type,
            file_size=m.file_size,
            created_at=m.created_at,
            source="material",
        ))
    for e in ev_result.scalars().all():
        uploaded.append(ProjectMaterialResponse(
            id=e.id,
            filename=e.filename or "Untitled",
            file_type=e.file_type or "unknown",
            file_size=e.file_size,
            created_at=e.created_at,
            source="evidence",
        ))
    uploaded.sort(key=lambda r: r.created_at, reverse=True)

    # Generated outputs from initiative.deliverables
    generated: list[GeneratedFileResponse] = []
    deliverables = initiative.deliverables or {}

    memo_result = await db.execute(
        select(MemoVersion)
        .where(MemoVersion.initiative_id == initiative_id)
        .order_by(MemoVersion.created_at.desc())
        .limit(1)
    )
    latest_memo = memo_result.scalar_one_or_none()

    for tool_id, data in deliverables.items():
        if "error" in data and "title" not in data:
            continue
        output_type = data.get("output_type", "document")
        export_fmt = EXPORT_FORMAT_MAP.get(output_type)

        exported = False
        download_url = None
        if output_type == "memo" and latest_memo and latest_memo.export_path:
            exported = True
            download_url = f"/api/v1/exports/{latest_memo.id}"

        content = data.get("content") or {}

        if output_type in ("lcoe", "carbon"):
            exportable = bool(
                export_fmt is not None
                and isinstance(content, dict)
                and content.get("computable", False)
                and content.get("inputs")
            )
        else:
            exportable = export_fmt is not None

        export_data = None
        if output_type == "checklist":
            export_data = content if isinstance(content, dict) else {}

        item_generated_at = data.get("generated_at")
        created_at = item_generated_at if item_generated_at else initiative.updated_at

        generated.append(GeneratedFileResponse(
            id=tool_id,
            title=data.get("title", tool_id.replace("_", " ").title()),
            output_type=output_type,
            created_at=created_at,
            exportable=exportable,
            export_format=export_fmt,
            exported=exported,
            download_url=download_url,
            export_data=export_data,
        ))

    # Fallback: if deliverables has no memo entry but a MemoVersion exists,
    # surface it so previously-generated memos aren't invisible on the Files page.
    has_memo_in_deliverables = any(
        d.get("output_type") == "memo" for d in deliverables.values()
    )
    if not has_memo_in_deliverables and latest_memo:
        memo_title = (latest_memo.content or {}).get("title", "Investment Memo")
        exported = bool(latest_memo.export_path)
        download_url = f"/api/v1/exports/{latest_memo.id}" if exported else None
        generated.append(GeneratedFileResponse(
            id=str(latest_memo.id),
            title=memo_title,
            output_type="memo",
            created_at=latest_memo.created_at,
            exportable=True,
            export_format="docx",
            exported=exported,
            download_url=download_url,
        ))

    return ProjectFilesResponse(uploaded=uploaded, generated=generated)


@router.delete("/initiatives/{initiative_id}/deliverables/{tool_id}")
async def delete_deliverable(
    initiative_id: UUID,
    tool_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Remove a generated deliverable from the project."""
    initiative = await require_editor(db, initiative_id, user)

    if initiative.remove_deliverable(tool_id):
        await db.commit()
    else:
        # tool_id may be a MemoVersion UUID (fallback path)
        try:
            memo_uuid = UUID(tool_id)
            memo_result = await db.execute(
                select(MemoVersion).where(
                    MemoVersion.id == memo_uuid,
                    MemoVersion.initiative_id == initiative_id,
                )
            )
            memo = memo_result.scalar_one_or_none()
            if not memo:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Deliverable not found",
                )
            await db.delete(memo)
            await db.commit()
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Deliverable not found",
            )

    return {"success": True}


@router.get("/materials/{material_id}/download")
async def download_material(
    material_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Download an uploaded project material."""
    result = await db.execute(
        select(ProjectMaterial).where(ProjectMaterial.id == material_id)
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material not found",
        )

    await require_viewer(db, material.initiative_id, user)

    if not material.storage_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not available for download",
        )

    storage = get_uploads_storage()
    file_bytes = await storage.load(material.storage_path)

    content_type_map = {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "txt": "text/plain",
        "csv": "text/csv",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls": "application/vnd.ms-excel",
        "png": "image/png",
        "jpg": "image/jpeg",
    }
    media_type = content_type_map.get(material.file_type, "application/octet-stream")

    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{material.filename}"'
        },
    )
