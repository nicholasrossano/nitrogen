"""API endpoints for the Compliance Pre-Check workflow."""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser, get_current_user
from app.core.database import get_db
from app.core.permissions import require_editor, require_viewer
from app.services.compliance_frameworks import get_framework_list, FRAMEWORK_FAMILIES
from app.services.compliance_precheck import CompliancePrecheckService

router = APIRouter()
logger = logging.getLogger(__name__)


class RunPrecheckRequest(BaseModel):
    confirmed_facts: list[dict]
    force: bool = False


class RerunPrecheckRequest(BaseModel):
    updated_facts: list[dict]
    additional_answers: dict[str, str] | None = None


@router.get("/initiatives/{initiative_id}/compliance-prechecks")
async def get_all_prechecks(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Return all saved compliance pre-checks for this initiative (keyed by framework_id)."""
    initiative = await require_viewer(db, initiative_id, user)
    return {"compliance_prechecks": initiative.compliance_prechecks or {}}


@router.get("/initiatives/{initiative_id}/compliance-prechecks/{framework_id}")
async def get_precheck(
    initiative_id: UUID,
    framework_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Return the compliance pre-check for a specific framework, or null."""
    initiative = await require_viewer(db, initiative_id, user)
    prechecks = initiative.compliance_prechecks or {}
    return {"compliance_precheck": prechecks.get(framework_id)}


@router.get("/initiatives/{initiative_id}/compliance-prechecks/meta/frameworks")
async def list_frameworks(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """List all supported compliance frameworks."""
    await require_viewer(db, initiative_id, user)
    return {"frameworks": get_framework_list()}


@router.post("/initiatives/{initiative_id}/compliance-prechecks/{framework_id}/route")
async def route_framework(
    initiative_id: UUID,
    framework_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Analyze project context and return scope facts for the given framework."""
    initiative = await require_editor(db, initiative_id, user)

    if framework_id not in FRAMEWORK_FAMILIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported framework: {framework_id}",
        )

    if not initiative.project_description and not initiative.title:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project needs a description before framework routing can run.",
        )

    service = CompliancePrecheckService(db)
    try:
        result = await service.route_framework(initiative, framework_id)
    except Exception:
        logger.exception("Framework routing failed for %s / %s", initiative_id, framework_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Framework routing failed. Please try again.",
        )

    return result


@router.post("/initiatives/{initiative_id}/compliance-prechecks/{framework_id}/run")
async def run_precheck(
    initiative_id: UUID,
    framework_id: str,
    body: RunPrecheckRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Run the compliance pre-check for the specified framework.

    Rejects if a check for this framework already exists unless force=true.
    """
    initiative = await require_editor(db, initiative_id, user)

    prechecks = initiative.compliance_prechecks or {}
    if framework_id in prechecks and not body.force:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A pre-check for {framework_id} already exists. Use rerun to update, or pass force=true.",
        )

    service = CompliancePrecheckService(db)
    try:
        result = await service.run_precheck(
            initiative=initiative,
            framework_id=framework_id,
            confirmed_facts=body.confirmed_facts,
        )
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid pre-check parameters")
    except Exception:
        logger.exception("Compliance pre-check failed for %s / %s", initiative_id, framework_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Compliance pre-check failed. Please try again.",
        )

    return {"compliance_precheck": result}


@router.post("/initiatives/{initiative_id}/compliance-prechecks/{framework_id}/rerun")
async def rerun_precheck(
    initiative_id: UUID,
    framework_id: str,
    body: RerunPrecheckRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Rerun the compliance pre-check with updated facts."""
    initiative = await require_editor(db, initiative_id, user)

    service = CompliancePrecheckService(db)
    try:
        result = await service.rerun_precheck(
            initiative=initiative,
            framework_id=framework_id,
            updated_facts=body.updated_facts,
            additional_answers=body.additional_answers,
        )
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid pre-check parameters")
    except Exception:
        logger.exception("Compliance pre-check rerun failed for %s / %s", initiative_id, framework_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Compliance pre-check rerun failed. Please try again.",
        )

    return {"compliance_precheck": result}
