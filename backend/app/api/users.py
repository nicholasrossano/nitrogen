from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.auth import AuthUser, get_current_user
from app.core.permissions import ensure_user_exists
from app.models.user import User
from app.models.project_share import ProjectShare
from app.schemas.share import UserSearchResult
from app.core.rate_limit import limiter

router = APIRouter()


@router.get("/users/search", response_model=list[UserSearchResult])
@limiter.limit("30/minute")
async def search_users(
    request: Request,
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Search users by email prefix, scoped to past collaborators.

    Only returns users who share at least one project with the caller.
    For users not yet collaborating, the caller must provide an exact email.
    """
    await ensure_user_exists(db, user)

    my_projects = (
        select(ProjectShare.project_id)
        .where(ProjectShare.user_id == user.uid)
    )
    collaborator_ids = (
        select(ProjectShare.user_id)
        .where(
            ProjectShare.project_id.in_(my_projects),
            ProjectShare.user_id != user.uid,
        )
    )

    result = await db.execute(
        select(User)
        .where(
            User.email.ilike(f"{q}%"),
            User.id != user.uid,
            User.id.in_(collaborator_ids),
        )
        .limit(10)
    )
    collaborators = result.scalars().all()

    if not collaborators and "@" in q:
        exact = await db.execute(
            select(User).where(User.email == q, User.id != user.uid).limit(1)
        )
        exact_user = exact.scalar_one_or_none()
        if exact_user:
            return [exact_user]

    return collaborators
