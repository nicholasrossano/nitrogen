"""Template upload, analysis, generation and export endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from pydantic import BaseModel
import logging

from app.core.database import get_db
from app.core.auth import get_current_user, MockUser
from app.core.storage import get_uploads_storage, get_storage
from app.models.initiative import Initiative
from app.models.project_material import ProjectMaterial
from app.services.document_parser import DocumentParserService

logger = logging.getLogger(__name__)

router = APIRouter()

TEMPLATE_CONTENT_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "template_docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "template_xlsx",
}


async def _get_initiative_for_user(
    initiative_id: UUID, user: MockUser, db: AsyncSession,
) -> Initiative:
    result = await db.execute(
        select(Initiative).where(
            Initiative.id == initiative_id,
            Initiative.user_id == user.uid,
        )
    )
    initiative = result.scalar_one_or_none()
    if not initiative:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Initiative not found")
    return initiative


# ── Upload ──────────────────────────────────────────────────────────

@router.post("/template/upload")
async def upload_template(
    initiative_id: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Upload a DOCX or XLSX template for analysis and completion."""
    init_uuid = UUID(initiative_id)
    initiative = await _get_initiative_for_user(init_uuid, user, db)

    file_type = TEMPLATE_CONTENT_TYPES.get(file.content_type or "")
    if not file_type:
        ext = (file.filename or "").rsplit(".", 1)[-1].lower()
        if ext == "docx":
            file_type = "template_docx"
        elif ext == "xlsx":
            file_type = "template_xlsx"
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only DOCX and XLSX files are supported for template generation.",
            )

    content = await file.read()
    storage = get_uploads_storage()
    storage_path = await storage.save(
        content, file.filename or "template", folder=f"{initiative_id}/templates",
    )

    content_text = None
    parser = DocumentParserService()
    try:
        if file_type == "template_docx":
            content_text = parser.parse_docx(content)
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

    return {
        "template_id": str(material.id),
        "filename": material.filename,
        "file_type": file_type,
    }


# ── Requirement update ──────────────────────────────────────────────

class RequirementUpdate(BaseModel):
    value: str | None = None
    status: str | None = None


@router.patch("/template/requirements/{requirement_id}")
async def update_requirement(
    requirement_id: str,
    body: RequirementUpdate,
    user: MockUser = Depends(get_current_user),
):
    """Update a single requirement value/status from the widget's inline editor.

    The actual state is managed in widget_data on the chat message — this
    endpoint serves as a lightweight bridge for callers that prefer REST
    over the generic updateMessageWidget path.  For v1, we simply echo back
    the update so the frontend can apply it optimistically.
    """
    return {
        "requirement_id": requirement_id,
        "value": body.value,
        "status": body.status,
        "updated": True,
    }


# ── Generate filled document ────────────────────────────────────────

class GenerateWithRequirementsRequest(BaseModel):
    initiative_id: str
    template_id: str
    requirements: list[dict] | None = None


@router.post("/template/generate")
async def generate_from_template(
    body: GenerateWithRequirementsRequest,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Fill the template with resolved requirement values and return a viewer payload."""
    from app.services.template_filler import TemplateFillerService

    init_uuid = UUID(body.initiative_id)
    template_uuid = UUID(body.template_id)
    logger.info("generate_from_template: initiative=%s template=%s", init_uuid, template_uuid)
    await _get_initiative_for_user(init_uuid, user, db)

    result = await db.execute(
        select(ProjectMaterial).where(ProjectMaterial.id == template_uuid)
    )
    material = result.scalar_one_or_none()
    if not material:
        logger.error("Template material not found in DB: %s", template_uuid)
        raise HTTPException(status_code=404, detail=f"Template material {template_uuid} not found in database")
    if not material.storage_path:
        logger.error("Template material has no storage_path: %s", template_uuid)
        raise HTTPException(status_code=404, detail="Template file missing from storage")

    storage = get_uploads_storage()
    try:
        template_bytes = await storage.load(material.storage_path)
    except Exception:
        logger.error("Failed to load template file from storage: %s", material.storage_path, exc_info=True)
        raise HTTPException(status_code=404, detail=f"Template file not found at {material.storage_path}")

    reqs = body.requirements or []

    filler = TemplateFillerService()
    is_xlsx = material.file_type == "template_xlsx"
    try:
        filled_bytes = (
            filler.fill_xlsx(template_bytes, reqs)
            if is_xlsx
            else filler.fill_docx(template_bytes, reqs)
        )
    except Exception:
        logger.error("Failed to fill template: %s", template_uuid, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fill template with provided values")

    out_storage = get_uploads_storage()
    ext = "xlsx" if is_xlsx else "docx"
    out_filename = f"filled_{material.filename}"
    out_path = await out_storage.save(
        filled_bytes, out_filename, folder=f"{body.initiative_id}/templates",
    )

    # Create a new material record for the filled output
    filled_material = ProjectMaterial(
        initiative_id=init_uuid,
        filename=out_filename,
        file_type=f"template_{ext}",
        storage_path=out_path,
        file_size=len(filled_bytes),
    )
    db.add(filled_material)
    await db.commit()
    await db.refresh(filled_material)

    return {
        "template_id": str(filled_material.id),
        "output_path": out_path,
        "file_type": ext,
        "filename": out_filename,
        "requirements": reqs,
    }


# ── List recent templates ───────────────────────────────────────────

@router.get("/template/recent")
async def list_recent_templates(
    initiative_id: str,
    limit: int = 5,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Return the most recently uploaded (unfilled) templates for an initiative."""
    init_uuid = UUID(initiative_id)
    await _get_initiative_for_user(init_uuid, user, db)

    result = await db.execute(
        select(ProjectMaterial)
        .where(
            ProjectMaterial.initiative_id == init_uuid,
            ProjectMaterial.file_type.in_(["template_docx", "template_xlsx"]),
            ~ProjectMaterial.filename.startswith("filled_"),
        )
        .order_by(ProjectMaterial.created_at.desc())
        .limit(limit)
    )
    materials = result.scalars().all()

    return [
        {
            "template_id": str(m.id),
            "filename": m.filename,
            "file_type": m.file_type,
            "created_at": m.created_at.isoformat(),
        }
        for m in materials
    ]


# ── Export / download ───────────────────────────────────────────────

@router.get("/template/{template_id}/export")
async def export_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Download the generated (filled) template file."""
    result = await db.execute(
        select(ProjectMaterial).where(ProjectMaterial.id == template_id)
    )
    material = result.scalar_one_or_none()
    if not material or not material.storage_path:
        raise HTTPException(status_code=404, detail="Template not found")

    await _get_initiative_for_user(material.initiative_id, user, db)

    storage = get_uploads_storage()
    file_bytes = await storage.load(material.storage_path)

    ct_map = {
        "template_docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "template_xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
    media_type = ct_map.get(material.file_type, "application/octet-stream")

    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{material.filename}"'},
    )
