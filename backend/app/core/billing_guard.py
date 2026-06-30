import logging
from typing import Callable

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.auth import AuthUser, get_current_user
from app.core.database import get_db
from app.core.llm_client import check_usage_budget
from app.models.subscription import Subscription
from app.services.billing import ensure_subscription

logger = logging.getLogger(__name__)
settings = get_settings()


def require_ai_access(*, count_message: bool = False) -> Callable:
    """FastAPI dependency factory for AI-consuming endpoints.

    count_message=True only for user-initiated chat turns (trial message cap).
    """

    async def _dependency(
        request: Request,
        user: AuthUser = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> AuthUser:
        if not settings.billing_enabled:
            return user

        if settings.billing_testing_mode:
            if not request.headers.get("x-billing-test"):
                return user

        await ensure_subscription(user.uid, db)

        budget = await check_usage_budget(user.uid, db)

        if not budget.get("allowed", True):
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={
                    "message": "AI access requires an active subscription or API key",
                    **budget,
                },
            )

        if count_message and budget.get("tier") == "trial":
            result = await db.execute(
                select(Subscription).where(Subscription.user_id == user.uid)
            )
            sub = result.scalar_one_or_none()
            if sub:
                sub.trial_messages_used = (sub.trial_messages_used or 0) + 1
                await db.flush()

        return user

    return _dependency
