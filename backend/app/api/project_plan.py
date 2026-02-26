"""API endpoints for the 3-pillar Project Plan."""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.auth import MockUser, get_current_user
from app.core.database import get_db
from app.models.initiative import Initiative
from app.services.project_plan import ProjectPlanService

router = APIRouter()
logger = logging.getLogger(__name__)


class StatusUpdate(BaseModel):
    status: str  # not_started | in_progress | complete


async def _get_initiative(
    initiative_id: UUID,
    user: MockUser,
    db: AsyncSession,
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


@router.get("/initiatives/{initiative_id}/project-plan")
async def get_project_plan(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Return the cached project plan, or null if none exists."""
    initiative = await _get_initiative(initiative_id, user, db)
    return {"project_plan": initiative.project_plan}


@router.post("/initiatives/{initiative_id}/project-plan")
async def generate_project_plan(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Generate a new project plan (or refresh the existing one)."""
    initiative = await _get_initiative(initiative_id, user, db)

    if not initiative.project_description and not initiative.title:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project needs a description before a plan can be generated.",
        )

    service = ProjectPlanService(db)
    existing_plan = initiative.project_plan

    try:
        plan = await service.generate(
            initiative=initiative,
            existing_plan=existing_plan,
        )
    except Exception:
        logger.exception("Project plan generation failed for %s", initiative_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Plan generation failed. Please try again.",
        )

    initiative.project_plan = plan
    flag_modified(initiative, "project_plan")
    initiative.touch()
    await db.commit()

    return {"project_plan": plan}


@router.patch("/initiatives/{initiative_id}/project-plan/items/{item_id}/status")
async def update_plan_item_status(
    initiative_id: UUID,
    item_id: str,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Update the status of a single sub-item in the project plan."""
    VALID_STATUSES = {"not_started", "in_progress", "complete"}
    if body.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status. Must be one of: {', '.join(VALID_STATUSES)}",
        )

    initiative = await _get_initiative(initiative_id, user, db)

    if not initiative.project_plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No project plan exists")

    found = False
    for pillar in initiative.project_plan.get("pillars", []):
        for item in pillar.get("items", []):
            if item.get("id") == item_id:
                item["status"] = body.status
                found = True
                break
        if found:
            break

    if not found:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Item '{item_id}' not found in plan")

    flag_modified(initiative, "project_plan")
    initiative.touch()
    await db.commit()

    return {"success": True, "item_id": item_id, "status": body.status}
