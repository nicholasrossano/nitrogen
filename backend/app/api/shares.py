import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.auth import AuthUser, get_current_user, _init_firebase
from app.core.permissions import (
    ensure_user_exists,
    get_initiative_with_role,
    require_editor,
    require_owner,
)
from app.models.project_share import ProjectShare
from app.models.user import User
from app.schemas.share import ShareCreate, ShareUpdate, ShareResponse

router = APIRouter()
logger = logging.getLogger(__name__)


async def _resolve_user_by_email(db: AsyncSession, email: str) -> User | None:
    """Look up a user by email. If not in our DB but exists in Firebase, auto-upsert and return them."""
    # 1. Check our local users table first
    local = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if local:
        return local

    # 2. Fall back to Firebase Admin lookup
    if not _init_firebase():
        return None
    try:
        from firebase_admin import auth as fb_auth
        fb_user = fb_auth.get_user_by_email(email)
        # Auto-upsert into our users table
        new_user = User(
            id=fb_user.uid,
            email=fb_user.email,
            display_name=fb_user.display_name,
            last_seen_at=datetime.now(timezone.utc),
        )
        db.add(new_user)
        await db.commit()
        await db.refresh(new_user)
        logger.info("Auto-upserted Firebase user %s into users table", email)
        return new_user
    except Exception as e:
        logger.debug("Firebase user lookup for %s failed: %s", email, e)
        return None


@router.post(
    "/initiatives/{initiative_id}/shares",
    response_model=ShareResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_share(
    initiative_id: str,
    body: ShareCreate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Share a project with another user. Owner or editor."""
    await ensure_user_exists(db, user)
    initiative = await require_editor(db, initiative_id, user)

    target_user = await _resolve_user_by_email(db, body.email)
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No Nitrogen account found for {body.email}. Ask them to sign in to Nitrogen first, then try sharing again.",
        )
    if target_user.id == user.uid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot share a project with yourself.",
        )

    existing = (
        await db.execute(
            select(ProjectShare).where(
                ProjectShare.initiative_id == initiative.id,
                ProjectShare.user_id == target_user.id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This user already has access to the project.",
        )

    share = ProjectShare(
        initiative_id=initiative.id,
        user_id=target_user.id,
        role=body.role,
        shared_by=user.uid,
    )
    db.add(share)
    await db.commit()
    await db.refresh(share)

    return ShareResponse(
        id=share.id,
        initiative_id=share.initiative_id,
        user_id=share.user_id,
        user_email=target_user.email,
        user_display_name=target_user.display_name,
        role=share.role,
        created_at=share.created_at,
    )


@router.get(
    "/initiatives/{initiative_id}/shares",
    response_model=list[ShareResponse],
)
async def list_shares(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """List all shares for a project. Any user with access can view."""
    await ensure_user_exists(db, user)
    initiative, _role = await get_initiative_with_role(db, initiative_id, user)

    result = await db.execute(
        select(ProjectShare)
        .where(ProjectShare.initiative_id == initiative.id)
        .order_by(ProjectShare.created_at)
    )
    shares = result.scalars().all()

    return [
        ShareResponse(
            id=s.id,
            initiative_id=s.initiative_id,
            user_id=s.user_id,
            user_email=s.user.email if s.user else None,
            user_display_name=s.user.display_name if s.user else None,
            role=s.role,
            created_at=s.created_at,
        )
        for s in shares
    ]


@router.patch(
    "/initiatives/{initiative_id}/shares/{share_id}",
    response_model=ShareResponse,
)
async def update_share(
    initiative_id: str,
    share_id: uuid.UUID,
    body: ShareUpdate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Update a share's role. Owner-only."""
    await ensure_user_exists(db, user)
    initiative = await require_owner(db, initiative_id, user)

    result = await db.execute(
        select(ProjectShare).where(
            ProjectShare.id == share_id,
            ProjectShare.initiative_id == initiative.id,
        )
    )
    share = result.scalar_one_or_none()
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share not found")

    share.role = body.role
    await db.commit()
    await db.refresh(share)

    return ShareResponse(
        id=share.id,
        initiative_id=share.initiative_id,
        user_id=share.user_id,
        user_email=share.user.email if share.user else None,
        user_display_name=share.user.display_name if share.user else None,
        role=share.role,
        created_at=share.created_at,
    )


@router.delete(
    "/initiatives/{initiative_id}/shares/{share_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_share(
    initiative_id: str,
    share_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Remove a share. Owner can remove anyone; shared user can remove themselves."""
    await ensure_user_exists(db, user)
    initiative, role = await get_initiative_with_role(db, initiative_id, user)

    result = await db.execute(
        select(ProjectShare).where(
            ProjectShare.id == share_id,
            ProjectShare.initiative_id == initiative.id,
        )
    )
    share = result.scalar_one_or_none()
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share not found")

    is_owner = role == "owner"
    is_self_removing = share.user_id == user.uid
    if not is_owner and not is_self_removing:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the project owner or the shared user can remove access.",
        )

    await db.delete(share)
    await db.commit()
