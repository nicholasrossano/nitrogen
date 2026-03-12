"""API endpoints for the Compliance Pre-Check workflow."""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser, get_current_user
from app.core.database import get_db
from app.core.permissions import require_editor, require_viewer
from app.services.compliance_frameworks import get_framework_list
from app.services.compliance_precheck import CompliancePrecheckService

router = APIRouter()
logger = logging.getLogger(__name__)


class RunPrecheckRequest(BaseModel):
    framework_id: str
    confirmed_facts: list[dict]


class RerunPrecheckRequest(BaseModel):
    updated_facts: list[dict]
    additional_answers: dict[str, str] | None = None


@router.get("/initiatives/{initiative_id}/compliance-precheck")
async def get_compliance_precheck(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Return the cached compliance pre-check results, or null if none exist."""
    initiative = await require_viewer(db, initiative_id, user)
    return {"compliance_precheck": initiative.compliance_precheck}


@router.get("/initiatives/{initiative_id}/compliance-precheck/frameworks")
async def list_frameworks(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """List all supported compliance frameworks."""
    await require_viewer(db, initiative_id, user)
    return {"frameworks": get_framework_list()}


@router.post("/initiatives/{initiative_id}/compliance-precheck/route")
async def route_framework(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Analyze project context and recommend the most relevant framework."""
    initiative = await require_editor(db, initiative_id, user)

    if not initiative.project_description and not initiative.title:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project needs a description before framework routing can run.",
        )

    service = CompliancePrecheckService(db)
    try:
        result = await service.route_framework(initiative)
    except Exception:
        logger.exception("Framework routing failed for %s", initiative_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Framework routing failed. Please try again.",
        )

    return result


@router.post("/initiatives/{initiative_id}/compliance-precheck/run")
async def run_precheck(
    initiative_id: UUID,
    body: RunPrecheckRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Run the full compliance pre-check for the specified framework."""
    initiative = await require_editor(db, initiative_id, user)

    service = CompliancePrecheckService(db)
    try:
        result = await service.run_precheck(
            initiative=initiative,
            framework_id=body.framework_id,
            confirmed_facts=body.confirmed_facts,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception:
        logger.exception("Compliance pre-check failed for %s", initiative_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Compliance pre-check failed. Please try again.",
        )

    return {"compliance_precheck": result}


@router.post("/initiatives/{initiative_id}/compliance-precheck/rerun")
async def rerun_precheck(
    initiative_id: UUID,
    body: RerunPrecheckRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Rerun the compliance pre-check with updated facts or additional answers."""
    initiative = await require_editor(db, initiative_id, user)

    service = CompliancePrecheckService(db)
    try:
        result = await service.rerun_precheck(
            initiative=initiative,
            updated_facts=body.updated_facts,
            additional_answers=body.additional_answers,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception:
        logger.exception("Compliance pre-check rerun failed for %s", initiative_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Compliance pre-check rerun failed. Please try again.",
        )

    return {"compliance_precheck": result}
