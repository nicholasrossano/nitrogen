import stripe
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import get_settings
from app.models.subscription import Subscription
from app.core.llm_client import check_usage_budget

settings = get_settings()


async def ensure_subscription(user_id: str, db: AsyncSession) -> Subscription:
    """Get or create a Subscription row for this user (default: trial tier)."""
    result = await db.execute(select(Subscription).where(Subscription.user_id == user_id))
    sub = result.scalar_one_or_none()
    if not sub:
        sub = Subscription(user_id=user_id, tier="trial", status="active")
        db.add(sub)
        await db.flush()
        await db.refresh(sub)
    return sub


async def ensure_stripe_customer(user_id: str, email: str | None, db: AsyncSession) -> str:
    """Idempotent: find or create a Stripe Customer, return customer_id."""
    sub = await ensure_subscription(user_id, db)
    if sub.stripe_customer_id:
        return sub.stripe_customer_id

    stripe.api_key = settings.stripe_secret_key
    customer = stripe.Customer.create(
        metadata={"user_id": user_id},
        email=email or None,
    )
    sub.stripe_customer_id = customer.id
    await db.flush()
    return customer.id


async def create_checkout_session(
    user_id: str,
    email: str | None,
    price_id: str,
    db: AsyncSession,
    success_url: str,
    cancel_url: str,
) -> str:
    """Create a Stripe Checkout Session and return the URL."""
    customer_id = await ensure_stripe_customer(user_id, email, db)
    stripe.api_key = settings.stripe_secret_key
    session = stripe.checkout.Session.create(
        customer=customer_id,
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={"user_id": user_id},
    )
    return session.url


async def create_portal_session(user_id: str, db: AsyncSession, return_url: str) -> str:
    """Create a Stripe Customer Portal session and return the URL."""
    sub = await ensure_subscription(user_id, db)
    if not sub.stripe_customer_id:
        raise ValueError("No Stripe customer found")
    stripe.api_key = settings.stripe_secret_key
    session = stripe.billing_portal.Session.create(
        customer=sub.stripe_customer_id,
        return_url=return_url,
    )
    return session.url


async def get_billing_status(user_id: str, db: AsyncSession) -> dict:
    """Return billing status for frontend consumption."""
    return await check_usage_budget(user_id, db)


async def handle_webhook_event(payload: bytes, sig_header: str, db: AsyncSession) -> None:
    """Process a Stripe webhook event."""
    stripe.api_key = settings.stripe_secret_key
    event = stripe.Webhook.construct_event(payload, sig_header, settings.stripe_webhook_secret)

    event_type = event["type"]
    data = event["data"]["object"]

    if event_type == "checkout.session.completed":
        await _handle_checkout_completed(data, db)
    elif event_type == "customer.subscription.updated":
        await _handle_subscription_updated(data, db)
    elif event_type == "customer.subscription.deleted":
        await _handle_subscription_deleted(data, db)
    elif event_type == "invoice.payment_failed":
        await _handle_payment_failed(data, db)


async def _handle_checkout_completed(data: dict, db: AsyncSession) -> None:
    customer_id = data.get("customer")
    subscription_id = data.get("subscription")
    if not customer_id:
        return
    result = await db.execute(
        select(Subscription).where(Subscription.stripe_customer_id == customer_id)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        return
    if subscription_id:
        sub.stripe_subscription_id = subscription_id
        stripe.api_key = settings.stripe_secret_key
        stripe_sub = stripe.Subscription.retrieve(subscription_id)
        price_id = stripe_sub["items"]["data"][0]["price"]["id"] if stripe_sub["items"]["data"] else None
        if price_id == settings.stripe_starter_price_id:
            sub.tier = "starter"
        elif price_id == settings.stripe_pro_price_id:
            sub.tier = "pro"
        sub.status = "active"
        from datetime import datetime, timezone
        sub.current_period_start = datetime.fromtimestamp(stripe_sub["current_period_start"], tz=timezone.utc)
        sub.current_period_end = datetime.fromtimestamp(stripe_sub["current_period_end"], tz=timezone.utc)
    await db.flush()


async def _handle_subscription_updated(data: dict, db: AsyncSession) -> None:
    sub_id = data.get("id")
    result = await db.execute(
        select(Subscription).where(Subscription.stripe_subscription_id == sub_id)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        return
    price_id = data["items"]["data"][0]["price"]["id"] if data.get("items", {}).get("data") else None
    if price_id == settings.stripe_starter_price_id:
        sub.tier = "starter"
    elif price_id == settings.stripe_pro_price_id:
        sub.tier = "pro"
    status = data.get("status", "active")
    sub.status = "active" if status == "active" else ("past_due" if status == "past_due" else status)
    from datetime import datetime, timezone
    if data.get("current_period_start"):
        sub.current_period_start = datetime.fromtimestamp(data["current_period_start"], tz=timezone.utc)
    if data.get("current_period_end"):
        sub.current_period_end = datetime.fromtimestamp(data["current_period_end"], tz=timezone.utc)
    await db.flush()


async def _handle_subscription_deleted(data: dict, db: AsyncSession) -> None:
    sub_id = data.get("id")
    result = await db.execute(
        select(Subscription).where(Subscription.stripe_subscription_id == sub_id)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        return
    sub.status = "canceled"
    await db.flush()


async def _handle_payment_failed(data: dict, db: AsyncSession) -> None:
    customer_id = data.get("customer")
    if not customer_id:
        return
    result = await db.execute(
        select(Subscription).where(Subscription.stripe_customer_id == customer_id)
    )
    sub = result.scalar_one_or_none()
    if sub:
        sub.status = "past_due"
        await db.flush()


async def redeem_access_code(user_id: str, code: str, db: AsyncSession) -> dict:
    """Validate and redeem an access code for extended trial."""
    if not settings.access_code or code != settings.access_code:
        return {"success": False, "error": "Invalid access code"}

    sub = await ensure_subscription(user_id, db)
    if sub.access_code_redeemed:
        return {"success": False, "error": "Access code already redeemed"}

    sub.access_code_redeemed = True
    await db.flush()

    budget = await check_usage_budget(user_id, db)
    return {"success": True, **budget}
