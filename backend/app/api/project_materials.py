from fastapi import APIRouter, Depends, HTTPException, Request, status, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
import logging

from app.core.database import get_db
from app.core.auth import get_current_user, AuthUser
from app.core.permissions import require_project_editor, require_project_viewer
from app.core.storage import get_uploads_storage, load_upload
from app.core.filename_utils import deduplicate_filename, safe_content_disposition, validate_file_magic
from app.core.upload_types import (
    DOCUMENT_CONTENT_TYPES,
    content_type_for_file_type,
    resolve_document_file_type,
)
from app.models.evidence import EvidenceDoc
from app.models.google_drive import DriveLinkedFile
from app.models.memo import MemoVersion
from app.models.project_material import ProjectMaterial
from app.schemas.project_material import (
    ProjectMaterialResponse,
    ProjectMaterialUploadResponse,
    GeneratedFileResponse,
    ProjectFilesResponse,
)
from app.services.document_parser import DocumentParserService
from app.services.document_conversion import (
    DocumentConversionError,
    prepare_uploaded_document,
)
from app.services import assessment_service
from app.services.assumptions import AssumptionActor, extract_assumptions_from_sources
from app.core.rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_CONTENT_TYPES = {
    **DOCUMENT_CONTENT_TYPES,
    "text/plain": "txt",
    "text/csv": "csv",
    "image/png": "png",
    "image/jpeg": "jpg",
}

_PROJECT_UPLOAD_TYPE_LABEL = "PDF, DOCX, PPTX, TXT, CSV, Excel, Pages, Keynote, PNG, or JPG"


def _resolve_material_file_type(content_type: str | None, filename: str | None) -> str | None:
    if content_type in {"text/plain", "text/csv", "image/png", "image/jpeg"}:
        return ALLOWED_CONTENT_TYPES[content_type]
    return resolve_document_file_type(content_type, filename)


async def _repair_project_file_workspace_ids(db: AsyncSession, project_id, workspace_id) -> None:
    """Keep project-scoped files aligned after a project moves workspaces."""
    repaired = False
    material_result = await db.execute(
        select(ProjectMaterial).where(
            ProjectMaterial.project_id == project_id,
            ProjectMaterial.workspace_id != workspace_id,
        )
    )
    for material in material_result.scalars().all():
        material.workspace_id = workspace_id
        repaired = True

    evidence_result = await db.execute(
        select(EvidenceDoc).where(
            EvidenceDoc.project_id == project_id,
            EvidenceDoc.workspace_id != workspace_id,
        )
    )
    for evidence_doc in evidence_result.scalars().all():
        evidence_doc.workspace_id = workspace_id
        repaired = True

    drive_result = await db.execute(
        select(DriveLinkedFile).where(
            DriveLinkedFile.project_id == project_id,
            DriveLinkedFile.workspace_id != workspace_id,
        )
    )
    for linked_file in drive_result.scalars().all():
        linked_file.workspace_id = workspace_id
        repaired = True

    if repaired:
        await db.commit()


@router.post(
    "/projects/{project_id}/materials",
    response_model=ProjectMaterialUploadResponse,
)
@limiter.limit("120/minute")
async def upload_material(
    request: Request,
    project_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Upload a file as project-level context material."""
    initiative = await require_project_editor(db, project_id, user)

    file_type = _resolve_material_file_type(file.content_type, file.filename)
    if not file_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type: {file.content_type}. Allowed: {_PROJECT_UPLOAD_TYPE_LABEL}",
        )

    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File size exceeds 50 MB limit",
        )
    validation_content_type = file.content_type or content_type_for_file_type(file_type) or ""
    if not validate_file_magic(content, validation_content_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File content does not match declared type",
        )

    try:
        prepared = prepare_uploaded_document(content, file.filename, file_type)
    except DocumentConversionError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    storage = get_uploads_storage()
    storage_path = await storage.save(
        prepared.content, prepared.filename, folder=f"{initiative.id}/materials"
    )

    content_text = None
    parser = DocumentParserService()
    try:
        if prepared.file_type == "pdf":
            content_text = parser.parse_pdf(prepared.content)
        elif prepared.file_type == "docx":
            content_text = parser.parse_docx(prepared.content)
        elif prepared.file_type == "pptx":
            content_text = parser.parse_pptx(prepared.content)
        elif prepared.file_type in ("txt", "csv"):
            content_text = prepared.content.decode("utf-8", errors="replace")
        elif prepared.file_type in ("xlsx", "xls"):
            content_text = parser.parse_xlsx(prepared.content)
    except Exception:
        logger.warning("Could not extract text from %s", file.filename, exc_info=True)

    unique_filename = await deduplicate_filename(
        db, initiative.id, prepared.filename
    )

    material = ProjectMaterial(
        project_id=initiative.id,
        workspace_id=initiative.workspace_id,
        filename=unique_filename,
        file_type=prepared.file_type,
        storage_path=storage_path,
        file_size=len(prepared.content),
        content_text=content_text,
    )
    db.add(material)

    initiative.touch()
    await db.flush()
    try:
        await extract_assumptions_from_sources(
            db,
            initiative,
            actor=AssumptionActor(user_id=user.uid, email=user.email or user.uid),
        )
    except Exception:
        logger.warning("Could not refresh assumptions after material upload", exc_info=True)
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
    "/projects/{project_id}/materials",
    response_model=list[ProjectMaterialResponse],
)
async def list_materials(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """List all uploaded files for an initiative — materials and evidence docs combined."""
    initiative = await require_project_viewer(db, project_id, user)
    await _repair_project_file_workspace_ids(db, initiative.id, initiative.workspace_id)

    mat_result = await db.execute(
        select(ProjectMaterial)
        .where(
            ProjectMaterial.project_id == initiative.id,
        )
        .order_by(ProjectMaterial.created_at.desc())
    )
    ev_result = await db.execute(
        select(EvidenceDoc)
        .where(
            EvidenceDoc.project_id == initiative.id,
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
            processing_status=e.processing_status,
            processing_error=e.processing_error,
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

    await require_project_editor(db, material.project_id, user)

    if material.storage_path:
        storage = get_uploads_storage()
        await storage.delete(material.storage_path)

    await db.delete(material)
    await db.commit()

    return {"success": True, "message": "Material deleted"}


def _resolve_tool(tool_id: str, output_type: str):
    """Look up the BaseAssessment for a deliverable, matching on tool_id first, then output_type."""
    from app.assessments.registry import get_assessment_registry
    registry = get_assessment_registry()
    tool = registry.get_assessment(tool_id)
    if tool:
        return tool
    for t in registry.get_all_assessments():
        if t.definition.output_type == output_type:
            return t
    return None


@router.get(
    "/projects/{project_id}/files",
    response_model=ProjectFilesResponse,
)
async def list_project_files(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """List all project files: uploaded materials + generated outputs."""
    initiative = await require_project_viewer(db, project_id, user)
    await _repair_project_file_workspace_ids(db, initiative.id, initiative.workspace_id)

    mat_result = await db.execute(
        select(ProjectMaterial)
        .where(
            ProjectMaterial.project_id == initiative.id,
        )
        .order_by(ProjectMaterial.created_at.desc())
    )
    ev_result = await db.execute(
        select(EvidenceDoc)
        .where(
            EvidenceDoc.project_id == initiative.id,
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
            processing_status=e.processing_status,
            processing_error=e.processing_error,
        ))
    uploaded.sort(key=lambda r: r.created_at, reverse=True)

    generated: list[GeneratedFileResponse] = []
    deliverables = initiative.get_deliverables_dict()

    memo_result = await db.execute(
        select(MemoVersion)
        .where(MemoVersion.project_id == initiative.id)
        .order_by(MemoVersion.created_at.desc())
        .limit(1)
    )
    latest_memo = memo_result.scalar_one_or_none()

    for tool_id, data in deliverables.items():
        if "error" in data and "title" not in data:
            continue
        output_type = data.get("output_type", "document")
        content = data.get("content") or {}

        tool = _resolve_tool(tool_id, output_type)
        export_fmt = tool.definition.export_format if tool else None
        exportable = tool.is_exportable(content) if tool else False

        exported = False
        download_url = None
        if output_type == "memo" and latest_memo and latest_memo.export_path:
            exported = True
            download_url = f"/api/v1/exports/{latest_memo.id}"

        if output_type == "template":
            material_id = content.get("material_id") if isinstance(content, dict) else None
            if material_id:
                exportable = True
                exported = True
                download_url = f"/api/v1/template/{material_id}/export"
                ext = (content.get("filename") or "").rsplit(".", 1)[-1] or "docx"
                export_fmt = ext

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

    return ProjectFilesResponse(uploaded=uploaded, generated=generated)


@router.delete("/projects/{project_id}/deliverables/{tool_id}")
async def delete_deliverable(
    project_id: str,
    tool_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Remove a generated deliverable from the project."""
    initiative = await require_project_editor(db, project_id, user)

    removed = await assessment_service.remove_instance_by_tool(db, initiative.id, tool_id)
    if removed:
        await db.commit()
    else:
        # tool_id can be a MemoVersion UUID when not tied to an assessment instance
        try:
            from uuid import UUID as _UUID
            memo_uuid = _UUID(tool_id)
            memo_result = await db.execute(
                select(MemoVersion).where(
                    MemoVersion.id == memo_uuid,
                    MemoVersion.project_id == initiative.id,
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

    await require_project_viewer(db, material.project_id, user)

    if not material.storage_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not available for download",
        )

    file_bytes = await load_upload(material.storage_path)

    content_type_map = {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "txt": "text/plain",
        "csv": "text/csv",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls": "application/vnd.ms-excel",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "png": "image/png",
        "jpg": "image/jpeg",
    }
    media_type = content_type_map.get(material.file_type, "application/octet-stream")

    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={
            "Content-Disposition": safe_content_disposition(material.filename)
        },
    )
