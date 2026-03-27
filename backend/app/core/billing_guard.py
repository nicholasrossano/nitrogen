import logging

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


async def require_ai_access(
    request: Request,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AuthUser:
    """
    Gate for AI-consuming endpoints.

    When billing is disabled (self-hosted / no Stripe key): passes through.
    When billing_testing_mode is True: only enforces billing for requests
      that include the X-Billing-Test header (i.e. Developer Mode in the frontend).
    When billing is enabled normally:
      - Ensures a Subscription row exists (creates trial if needed)
      - Checks usage budget via check_usage_budget
      - If not allowed: raises HTTP 402 with billing status details
      - If allowed and user is on trial: increments trial_messages_used

    Returns the AuthUser so endpoints can use it directly.
    """
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

    if budget.get("tier") == "trial":
        result = await db.execute(
            select(Subscription).where(Subscription.user_id == user.uid)
        )
        sub = result.scalar_one_or_none()
        if sub:
            sub.trial_messages_used = (sub.trial_messages_used or 0) + 1
            await db.flush()

    return user
