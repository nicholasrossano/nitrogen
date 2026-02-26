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
from app.services.deep_dive import DeepDiveService
from app.services.project_plan import ProjectPlanService

router = APIRouter()
logger = logging.getLogger(__name__)


class StatusUpdate(BaseModel):
    status: str  # not_started | in_progress | complete


class DeepDiveRequest(BaseModel):
    item_title: str
    item_classification: str
    item_rationale: str = ""
    pillar_name: str = ""


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


def _serialize_deep_dive(result) -> dict:
    """Serialize a DeepDiveResult (or its already-dict form) to a JSON-safe dict."""
    if isinstance(result, dict):
        return result
    return {
        "item_id": result.item_id,
        "item_title": result.item_title,
        "pillar_name": result.pillar_name,
        "what_this_is": result.what_this_is,
        "elements": [
            {
                "title": el.title,
                "description": el.description,
                "classification": el.classification,
            }
            for el in result.elements
        ],
        "dependencies": [
            {"condition": d.condition, "effect": d.effect}
            for d in result.dependencies
        ],
        "sources": [
            {
                "title": s.title,
                "url": s.url,
                "source_type": s.source_type,
                "publisher": s.publisher,
            }
            for s in result.sources
        ],
        "generated_at": result.generated_at,
        "latency_ms": result.latency_ms,
    }


@router.post("/initiatives/{initiative_id}/project-plan/items/{item_id}/deep-dive")
async def deep_dive_plan_item(
    initiative_id: UUID,
    item_id: str,
    body: DeepDiveRequest,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Run a targeted research deep dive on a specific project plan sub-item.

    Results are cached inside project_plan.deep_dives[item_id] so subsequent
    requests for the same item are returned instantly without re-running research.
    """
    initiative = await _get_initiative(initiative_id, user, db)

    # Check for cached result
    plan = initiative.project_plan or {}
    cached = plan.get("deep_dives", {}).get(item_id)
    if cached:
        logger.info("Returning cached deep dive for item %s", item_id)
        return cached

    service = DeepDiveService(db)
    try:
        result = await service.generate(
            initiative=initiative,
            item_id=item_id,
            item_title=body.item_title,
            item_classification=body.item_classification,
            item_rationale=body.item_rationale,
            pillar_name=body.pillar_name,
        )
    except Exception:
        logger.exception(
            "Deep dive failed for item %s in initiative %s", item_id, initiative_id
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Deep dive failed. Please try again.",
        )

    serialized = _serialize_deep_dive(result)

    # Persist into project_plan.deep_dives
    if initiative.project_plan is None:
        initiative.project_plan = {}
    deep_dives = initiative.project_plan.setdefault("deep_dives", {})
    deep_dives[item_id] = serialized
    flag_modified(initiative, "project_plan")
    initiative.touch()
    await db.commit()

    return serialized
