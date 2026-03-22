"""API endpoints for the PDD (Project Design Document) authoring workflow."""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser, get_current_user
from app.core.database import get_db
from app.core.permissions import require_editor, require_viewer
from app.services.pdd_service import PDDService

router = APIRouter()
logger = logging.getLogger(__name__)


# -- request bodies ----------------------------------------------------------

class UpdateOutlineRequest(BaseModel):
    sections: list[dict]


class DraftSectionRequest(BaseModel):
    user_answers: dict[str, str] | None = None
    general_guidance: bool = False


class UpdateSectionRequest(BaseModel):
    content: str


# -- endpoints ---------------------------------------------------------------

@router.post("/initiatives/{initiative_id}/pdd")
async def create_pdd_workspace(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Create a PDD workspace and trigger the project scan."""
    await require_editor(db, initiative_id, user)
    service = PDDService(db)

    try:
        await service.create_workspace(initiative_id)
        await service.scan_project(initiative_id)
    except Exception:
        logger.exception("PDD scan failed for %s", initiative_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Project scan failed. Please try again.",
        )

    workspace_state = await service.get_workspace(initiative_id)
    return {"workspace": workspace_state}


@router.get("/initiatives/{initiative_id}/pdd")
async def get_pdd_workspace(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Return the current PDD workspace state, or null."""
    await require_viewer(db, initiative_id, user)
    service = PDDService(db)
    workspace_state = await service.get_workspace(initiative_id)
    return {"workspace": workspace_state}


@router.post("/initiatives/{initiative_id}/pdd/outline")
async def generate_pdd_outline(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Generate a draft PDD outline from the project scan."""
    await require_editor(db, initiative_id, user)
    service = PDDService(db)

    try:
        outline = await service.generate_outline(initiative_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception:
        logger.exception("PDD outline generation failed for %s", initiative_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Outline generation failed. Please try again.",
        )

    return {"outline": outline}


@router.patch("/initiatives/{initiative_id}/pdd/outline")
async def update_pdd_outline(
    initiative_id: UUID,
    body: UpdateOutlineRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Update the PDD outline with user edits."""
    await require_editor(db, initiative_id, user)
    service = PDDService(db)

    try:
        outline = await service.update_outline(initiative_id, body.sections)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {"outline": outline}


@router.post("/initiatives/{initiative_id}/pdd/outline/confirm")
async def confirm_pdd_outline(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Confirm the outline and transition to section authoring."""
    await require_editor(db, initiative_id, user)
    service = PDDService(db)

    try:
        result = await service.confirm_outline(initiative_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return result


@router.post("/initiatives/{initiative_id}/pdd/sections/{section_id}/prepare")
async def prepare_pdd_section(
    initiative_id: UUID,
    section_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Gather evidence and identify gaps for a section."""
    await require_editor(db, initiative_id, user)
    service = PDDService(db)

    try:
        result = await service.prepare_section(initiative_id, section_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception:
        logger.exception("PDD section prepare failed for %s / %s", initiative_id, section_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Section preparation failed. Please try again.",
        )

    return result


@router.post("/initiatives/{initiative_id}/pdd/sections/{section_id}/draft")
async def draft_pdd_section(
    initiative_id: UUID,
    section_id: str,
    body: DraftSectionRequest | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Draft a section with citations."""
    await require_editor(db, initiative_id, user)
    service = PDDService(db)

    user_answers = body.user_answers if body else None
    general_guidance = body.general_guidance if body else False

    try:
        result = await service.draft_section(initiative_id, section_id, user_answers, general_guidance)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception:
        logger.exception("PDD section draft failed for %s / %s", initiative_id, section_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Section drafting failed. Please try again.",
        )

    return result


@router.patch("/initiatives/{initiative_id}/pdd/sections/{section_id}")
async def update_pdd_section(
    initiative_id: UUID,
    section_id: str,
    body: UpdateSectionRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Save user edits to a section draft."""
    await require_editor(db, initiative_id, user)
    service = PDDService(db)

    try:
        await service.update_section(initiative_id, section_id, body.content)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {"ok": True}


@router.post("/initiatives/{initiative_id}/pdd/sections/{section_id}/confirm")
async def confirm_pdd_section(
    initiative_id: UUID,
    section_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Confirm a section and advance to the next."""
    await require_editor(db, initiative_id, user)
    service = PDDService(db)

    try:
        result = await service.confirm_section(initiative_id, section_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return result


@router.post("/initiatives/{initiative_id}/pdd/consistency")
async def run_pdd_consistency(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Run cross-section consistency check."""
    await require_editor(db, initiative_id, user)
    service = PDDService(db)

    try:
        findings = await service.run_consistency_check(initiative_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception:
        logger.exception("PDD consistency check failed for %s", initiative_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Consistency check failed. Please try again.",
        )

    return {"findings": findings}


@router.post("/initiatives/{initiative_id}/pdd/assemble")
async def assemble_pdd(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Compile the final PDD document."""
    await require_editor(db, initiative_id, user)
    service = PDDService(db)

    try:
        assembled = await service.assemble_document(initiative_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception:
        logger.exception("PDD assembly failed for %s", initiative_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Document assembly failed. Please try again.",
        )

    return {"assembled": assembled}


@router.post("/initiatives/{initiative_id}/pdd/export")
async def export_pdd(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Export the assembled PDD as a DOCX file."""
    await require_viewer(db, initiative_id, user)
    service = PDDService(db)

    try:
        docx_bytes = await service.export_docx(initiative_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception:
        logger.exception("PDD export failed for %s", initiative_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Export failed. Please try again.",
        )

    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": "attachment; filename=project_design_document.docx"},
    )
