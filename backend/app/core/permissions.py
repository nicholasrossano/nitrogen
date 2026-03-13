import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser
from app.models.initiative import Initiative
from app.models.project_share import ProjectShare
from app.models.user import User


async def ensure_user_exists(db: AsyncSession, user: AuthUser) -> None:
    """Upsert the authenticated user into the users table."""
    if not user.uid or user.uid == "shared-user":
        return
    existing = await db.get(User, user.uid)
    if existing:
        existing.last_seen_at = datetime.now(timezone.utc)
    else:
        db.add(User(
            id=user.uid,
            email=user.email,
            last_seen_at=datetime.now(timezone.utc),
        ))
    await db.commit()


async def get_initiative_with_role(
    db: AsyncSession,
    initiative_id: uuid.UUID | str,
    user: AuthUser,
) -> tuple[Initiative, str]:
    """Return (initiative, role) where role is 'owner', 'editor', or 'viewer'.

    Raises 404 if the user has no access.
    """
    result = await db.execute(
        select(Initiative).where(Initiative.id == initiative_id)
    )
    initiative = result.scalar_one_or_none()
    if not initiative:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Initiative not found")

    if initiative.user_id == user.uid:
        return initiative, "owner"

    share_result = await db.execute(
        select(ProjectShare).where(
            ProjectShare.initiative_id == initiative_id,
            ProjectShare.user_id == user.uid,
        )
    )
    share = share_result.scalar_one_or_none()
    if share:
        return initiative, share.role

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Initiative not found")


async def require_owner(
    db: AsyncSession,
    initiative_id: uuid.UUID | str,
    user: AuthUser,
) -> Initiative:
    """Return initiative only if the user is the owner, else 403."""
    initiative, role = await get_initiative_with_role(db, initiative_id, user)
    if role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the project owner can perform this action")
    return initiative


async def require_editor(
    db: AsyncSession,
    initiative_id: uuid.UUID | str,
    user: AuthUser,
) -> Initiative:
    """Return initiative if the user is owner or editor, else 403."""
    initiative, role = await get_initiative_with_role(db, initiative_id, user)
    if role == "viewer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Viewers cannot modify this project")
    return initiative


async def require_viewer(
    db: AsyncSession,
    initiative_id: uuid.UUID | str,
    user: AuthUser,
) -> Initiative:
    """Return initiative if the user has any access (owner/editor/viewer)."""
    initiative, _role = await get_initiative_with_role(db, initiative_id, user)
    return initiative
