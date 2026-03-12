from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, union_all, literal, case
from uuid import UUID

from app.core.database import get_db
from app.core.auth import get_current_user, AuthUser
from app.core.permissions import (
    ensure_user_exists,
    get_initiative_with_role,
    require_editor,
    require_owner,
)
from app.models.initiative import Initiative
from app.models.chat import ChatMessage
from app.models.project_share import ProjectShare
from app.models.user import User
from app.schemas.initiative import (
    InitiativeCreate,
    InitiativeResponse,
    InitiativeConfirmResponse,
)

router = APIRouter()


def _initiative_to_response(initiative: Initiative, shared_role: str | None = None, owner_email: str | None = None) -> dict:
    """Convert an Initiative ORM object to a response dict with sharing fields."""
    data = InitiativeResponse.model_validate(initiative).model_dump()
    data["shared_role"] = shared_role
    data["owner_email"] = owner_email
    return data


@router.post("/initiatives", response_model=InitiativeResponse, status_code=status.HTTP_201_CREATED)
async def create_initiative(
    data: InitiativeCreate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Create a new initiative and start the intake process"""
    await ensure_user_exists(db, user)
    initiative = Initiative(
        user_id=user.uid,
        title=data.title,
    )
    db.add(initiative)
    await db.commit()
    await db.refresh(initiative)
    
    initial_message = ChatMessage(
        initiative_id=initiative.id,
        role="assistant",
        content="Briefly describe your project.",
    )
    db.add(initial_message)
    await db.commit()
    
    return initiative


@router.get("/initiatives/{initiative_id}", response_model=InitiativeResponse)
async def get_initiative(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Get an initiative by ID (owner, editor, or viewer)"""
    await ensure_user_exists(db, user)
    initiative, role = await get_initiative_with_role(db, initiative_id, user)

    owner_user = await db.get(User, initiative.user_id)
    owner_email = owner_user.email if owner_user else None

    return _initiative_to_response(
        initiative,
        shared_role=role if role != "owner" else None,
        owner_email=owner_email,
    )


@router.post("/initiatives/{initiative_id}/confirm", response_model=InitiativeConfirmResponse)
async def confirm_initiative(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Confirm the intake stage and move to evidence stage"""
    initiative = await require_editor(db, initiative_id, user)
    
    if not initiative.is_intake_complete():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot confirm: required fields are not complete",
        )
    
    initiative.stage_1_complete = True
    initiative.stage = "evidence"
    await db.commit()
    
    confirm_message = ChatMessage(
        initiative_id=initiative.id,
        role="assistant",
        content="Great! Your initiative is confirmed. Now let's add some supporting evidence. You can upload a document or paste text.",
        widget_type="evidence_input",
        widget_data={"status": "ready"},
    )
    db.add(confirm_message)
    await db.commit()
    
    return InitiativeConfirmResponse(
        success=True,
        stage="evidence",
        message="Initiative confirmed. Ready for evidence upload.",
    )


@router.get("/initiatives", response_model=list[InitiativeResponse])
async def list_initiatives(
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    limit: int = 20,
    offset: int = 0,
    archived: bool = False,
):
    """List owned + shared initiatives for the current user."""
    await ensure_user_exists(db, user)

    # Owned initiatives
    owned = await db.execute(
        select(Initiative)
        .where(
            Initiative.user_id == user.uid,
            Initiative.archived == archived,
        )
        .order_by(Initiative.updated_at.desc(), Initiative.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    owned_initiatives = owned.scalars().all()

    # Shared initiatives (only non-archived, and only when not viewing trash)
    shared_initiatives: list[tuple[Initiative, str, str | None]] = []
    if not archived:
        shared_result = await db.execute(
            select(ProjectShare, Initiative, User)
            .join(Initiative, ProjectShare.initiative_id == Initiative.id)
            .outerjoin(User, Initiative.user_id == User.id)
            .where(
                ProjectShare.user_id == user.uid,
                Initiative.archived == False,
            )
            .order_by(Initiative.updated_at.desc())
            .limit(limit)
        )
        shared_initiatives = [
            (initiative, share.role, owner.email if owner else None)
            for share, initiative, owner in shared_result.all()
        ]

    results = []
    for init in owned_initiatives:
        results.append(_initiative_to_response(init, owner_email=user.email))

    for init, role, owner_email in shared_initiatives:
        results.append(_initiative_to_response(init, shared_role=role, owner_email=owner_email))

    results.sort(key=lambda x: x["updated_at"], reverse=True)
    return results


@router.patch("/initiatives/{initiative_id}", response_model=InitiativeResponse)
async def update_initiative(
    initiative_id: UUID,
    data: InitiativeCreate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Update an initiative (title, icon). Owner or editor."""
    initiative = await require_editor(db, initiative_id, user)
    
    if data.title is not None:
        initiative.title = data.title
    if data.icon is not None:
        initiative.icon = data.icon
    
    await db.commit()
    await db.refresh(initiative)
    
    return initiative


@router.delete("/initiatives/{initiative_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_initiative(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Archive (soft delete) an initiative - owner only"""
    initiative = await require_owner(db, initiative_id, user)
    initiative.archived = True
    await db.commit()
    return None


@router.post("/initiatives/{initiative_id}/restore", response_model=InitiativeResponse)
async def restore_initiative(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Restore an archived initiative from trash - owner only"""
    initiative = await require_owner(db, initiative_id, user)
    
    if not initiative.archived:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Initiative is not archived",
        )
    
    initiative.archived = False
    await db.commit()
    await db.refresh(initiative)
    
    return initiative


@router.delete("/initiatives/{initiative_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
async def permanently_delete_initiative(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Permanently delete an initiative and all related data - owner only"""
    initiative = await require_owner(db, initiative_id, user)
    await db.delete(initiative)
    await db.commit()
    return None
