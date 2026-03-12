from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.auth import AuthUser, get_current_user
from app.core.permissions import ensure_user_exists
from app.models.user import User
from app.schemas.share import UserSearchResult

router = APIRouter()


@router.get("/users/search", response_model=list[UserSearchResult])
async def search_users(
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Search users by email prefix. Returns up to 10 matches excluding the caller."""
    await ensure_user_exists(db, user)
    result = await db.execute(
        select(User)
        .where(
            User.email.ilike(f"{q}%"),
            User.id != user.uid,
        )
        .limit(10)
    )
    return result.scalars().all()
