"""API endpoints for the 3-pillar Project Plan."""

import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.auth import AuthUser, get_current_user
from app.core.billing_guard import require_ai_access
from app.core.permissions import require_editor, require_viewer
from app.core.database import get_db
from app.models.onboarding import ChatMessage
from app.models.initiative import InitiativeStage
from app.plans.registry import get_plan_registry
from app.services.deep_dive import DeepDiveService

router = APIRouter()
logger = logging.getLogger(__name__)


def _ensure_plan_metadata(
    db: AsyncSession,
    user_id: str | None,
    plan: dict | None,
) -> dict | None:
    """Backfill plan metadata for legacy payloads without mutating storage eagerly."""

    if not plan:
        return plan
    if plan.get("plan_type") and plan.get("schema_version"):
        return plan
    handler = get_plan_registry().default_handler(db, user_id)
    return handler.attach_metadata(plan)


class StatusUpdate(BaseModel):
    status: str  # not_started | in_progress | complete


class ConfirmCategoriesRequest(BaseModel):
    categories: list[dict]  # [{id, name, summary}, ...]


class DeepDiveRequest(BaseModel):
    item_title: str
    item_classification: str
    item_rationale: str = ""
    pillar_name: str = ""


class AddPlanItemRequest(BaseModel):
    title: str
    item_type: str = "deliverable"
    phase_id: str | None = None


@router.get("/initiatives/{initiative_id}/project-plan")
async def get_project_plan(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Return the cached project plan, or null if none exists."""
    initiative = await require_viewer(db, initiative_id, user)
    return {"project_plan": _ensure_plan_metadata(db, user.uid, initiative.project_plan)}


@router.post("/initiatives/{initiative_id}/project-plan")
async def generate_project_plan(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_ai_access),
):
    """Generate a new project plan (or refresh the existing one)."""
    initiative = await require_editor(db, initiative_id, user)

    if not initiative.project_description and not initiative.title:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project needs a description before a plan can be generated.",
        )

    handler = get_plan_registry().default_handler(db, user.uid)
    existing_plan = initiative.project_plan

    try:
        plan = await handler.generate_plan(
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


@router.post("/initiatives/{initiative_id}/project-plan/propose-categories")
async def propose_plan_categories(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_ai_access),
):
    """Propose high-level plan categories adapted to the project."""
    initiative = await require_editor(db, initiative_id, user)

    if not initiative.project_description and not initiative.title:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project needs a description before categories can be proposed.",
        )

    # Load recent chat messages for richer context
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.initiative_id == initiative.id)
        .order_by(ChatMessage.created_at.desc())
        .limit(12)
    )
    recent_messages = list(reversed(result.scalars().all()))
    chat_history = [{"role": m.role, "content": m.content} for m in recent_messages]

    handler = get_plan_registry().default_handler(db, user.uid)
    try:
        categories = await handler.propose_structure(initiative=initiative, chat_history=chat_history)
    except Exception:
        logger.exception("Category proposal failed for %s", initiative_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Category proposal failed. Please try again.",
        )

    return {"categories": categories}


@router.post("/initiatives/{initiative_id}/project-plan/confirm-categories")
async def confirm_plan_categories(
    initiative_id: str,
    body: ConfirmCategoriesRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_ai_access),
):
    """Accept confirmed categories and generate the full project plan."""
    initiative = await require_editor(db, initiative_id, user)

    handler = get_plan_registry().default_handler(db, user.uid)
    existing_plan = initiative.project_plan

    try:
        plan = await handler.generate_plan(
            initiative=initiative,
            existing_plan=existing_plan,
            approved_structure=body.categories,
        )
    except Exception:
        logger.exception("Plan generation (with categories) failed for %s", initiative_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Plan generation failed. Please try again.",
        )

    initiative.project_plan = plan
    if initiative.stage in (InitiativeStage.DESCRIBE,):
        initiative.stage = InitiativeStage.PLAN
    flag_modified(initiative, "project_plan")
    initiative.touch()
    await db.commit()

    return {"project_plan": plan}


@router.patch("/initiatives/{initiative_id}/project-plan/items/{item_id}/status")
async def update_plan_item_status(
    initiative_id: str,
    item_id: str,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Update the status of a single sub-item in the project plan."""
    VALID_STATUSES = {"not_started", "in_progress", "complete"}
    if body.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status. Must be one of: {', '.join(VALID_STATUSES)}",
        )

    initiative = await require_editor(db, initiative_id, user)

    if not initiative.project_plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No project plan exists")
    initiative.project_plan = _ensure_plan_metadata(db, user.uid, initiative.project_plan)

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
                **({"provenance": el.provenance} if el.provenance else {}),
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
                **({"excerpt": s.excerpt} if s.excerpt else {}),
                **({"evidence_doc_id": s.evidence_doc_id} if s.evidence_doc_id else {}),
                **({"chunk_id": s.chunk_id} if s.chunk_id else {}),
            }
            for s in result.sources
        ],
        "generated_at": result.generated_at,
        "latency_ms": result.latency_ms,
    }


@router.delete("/initiatives/{initiative_id}/project-plan/items/{item_id}")
async def delete_plan_item(
    initiative_id: str,
    item_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Remove a single item from the project plan."""
    initiative = await require_editor(db, initiative_id, user)

    if not initiative.project_plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No project plan exists")
    initiative.project_plan = _ensure_plan_metadata(db, user.uid, initiative.project_plan)

    found = False
    for pillar in initiative.project_plan.get("pillars", []):
        before = len(pillar.get("items", []))
        pillar["items"] = [item for item in pillar.get("items", []) if item.get("id") != item_id]
        if len(pillar["items"]) < before:
            found = True
            break

    if not found:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Item '{item_id}' not found in plan")

    flag_modified(initiative, "project_plan")
    initiative.touch()
    await db.commit()

    return {"success": True, "item_id": item_id}


@router.delete("/initiatives/{initiative_id}/project-plan/items/{item_id}/elements/{element_index}")
async def delete_plan_element(
    initiative_id: str,
    item_id: str,
    element_index: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Remove an element by index from a deep-dive result cached in the project plan."""
    initiative = await require_editor(db, initiative_id, user)

    if not initiative.project_plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No project plan exists")
    initiative.project_plan = _ensure_plan_metadata(db, user.uid, initiative.project_plan)

    deep_dives = initiative.project_plan.get("deep_dives", {})
    dive = deep_dives.get(item_id)
    if not dive:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No deep dive found for item '{item_id}'")

    elements = dive.get("elements", [])
    if element_index < 0 or element_index >= len(elements):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Element index {element_index} out of range")

    dive["elements"] = [el for i, el in enumerate(elements) if i != element_index]
    flag_modified(initiative, "project_plan")
    initiative.touch()
    await db.commit()

    return {"success": True, "item_id": item_id, "element_index": element_index}


@router.post("/initiatives/{initiative_id}/project-plan/pillars/{pillar_id}/items")
async def add_plan_item(
    initiative_id: str,
    pillar_id: str,
    body: AddPlanItemRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Add a new item to a specific pillar in the project plan."""
    initiative = await require_editor(db, initiative_id, user)

    if not initiative.project_plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No project plan exists")
    initiative.project_plan = _ensure_plan_metadata(db, user.uid, initiative.project_plan)

    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title cannot be empty")

    item_type = body.item_type if body.item_type in ("deliverable", "assessment") else "deliverable"
    new_item: dict = {
        "id": str(uuid4()),
        "title": title,
        "item_type": item_type,
        "classification": "optional",
        "status": "not_started",
        "rationale": "",
        "user_added": True,
    }
    if body.phase_id:
        new_item["phase"] = body.phase_id
        new_item["phase_order"] = 999

    found = False
    for pillar in initiative.project_plan.get("pillars", []):
        if pillar.get("id") == pillar_id:
            pillar.setdefault("items", []).append(new_item)
            found = True
            break

    if not found:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Pillar '{pillar_id}' not found")

    flag_modified(initiative, "project_plan")
    initiative.touch()
    await db.commit()

    return {"success": True, "item": new_item}


@router.post("/initiatives/{initiative_id}/project-plan/items/{item_id}/deep-dive")
async def deep_dive_plan_item(
    initiative_id: str,
    item_id: str,
    body: DeepDiveRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_ai_access),
):
    """Run a targeted research deep dive on a specific project plan sub-item.

    Results are cached inside project_plan.deep_dives[item_id] so subsequent
    requests for the same item are returned instantly without re-running research.
    """
    initiative = await require_editor(db, initiative_id, user)

    service = DeepDiveService(db, user_id=user.uid)

    # Check for cached LLM result
    plan = _ensure_plan_metadata(db, user.uid, initiative.project_plan) or {}
    cached = plan.get("deep_dives", {}).get(item_id)

    if cached:
        logger.info("Returning cached deep dive for item %s (+ fresh evidence lookup)", item_id)
        serialized = cached
    else:
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

        # Persist into project_plan.deep_dives (without evidence sources — those stay fresh)
        if initiative.project_plan is None:
            initiative.project_plan = {}
        deep_dives = initiative.project_plan.setdefault("deep_dives", {})
        deep_dives[item_id] = serialized
        flag_modified(initiative, "project_plan")
        initiative.touch()
        await db.commit()

    # Always run a fresh evidence RAG lookup (fast, ~5 vector comparisons) so that
    # document citations reflect current uploads regardless of when the LLM result was cached.
    evidence_sources = await service.get_evidence_sources(
        initiative=initiative,
        item_title=body.item_title,
        item_rationale=body.item_rationale,
    )
    if evidence_sources:
        non_evidence = [s for s in serialized.get("sources", []) if s.get("source_type") != "evidence"]
        serialized = {
            **serialized,
            "sources": non_evidence + [
                {
                    "title": s.title,
                    "url": s.url,
                    "source_type": s.source_type,
                    **({"excerpt": s.excerpt} if s.excerpt else {}),
                    **({"evidence_doc_id": s.evidence_doc_id} if s.evidence_doc_id else {}),
                    **({"chunk_id": s.chunk_id} if s.chunk_id else {}),
                }
                for s in evidence_sources
            ],
        }

    return serialized
