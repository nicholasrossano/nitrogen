import logging
from datetime import datetime, timezone
from typing import Any

import stripe
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import get_settings
from app.models.subscription import Subscription
from app.core.llm_client import check_usage_budget

settings = get_settings()
logger = logging.getLogger(__name__)

_VALID_PAID_TIERS = frozenset({"individual", "starter", "pro"})


def _sget(obj: Any, key: str, default: Any = None) -> Any:
    """Dict-or-StripeObject-safe lookup.

    Recent stripe-python `StripeObject`/`ListObject` instances no longer
    subclass `dict`, so `.get()` isn't a real method on them — Python falls
    through to `__getattr__`, which raises `AttributeError` for any name that
    isn't a literal key (this crashed `/billing/status` with `AttributeError:
    get`). Item access (`obj["key"]`) still works on both, but `getattr` is
    the safe read for keys that may be absent.
    """
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _tier_from_stripe_price(price_id: str | None, price_obj: Any | None = None) -> str | None:
    if price_id:
        if price_id == settings.stripe_price_id:
            return "individual"
        if price_id == settings.stripe_starter_price_id:
            return "starter"
        if price_id == settings.stripe_pro_price_id:
            return "pro"
    # Stripe Price metadata is the durable source when env price IDs drift.
    if price_obj is not None:
        meta = getattr(price_obj, "metadata", None) or {}
        if isinstance(price_obj, dict):
            meta = price_obj.get("metadata") or {}
        tier = meta.get("app_tier") if isinstance(meta, dict) else None
        if tier in _VALID_PAID_TIERS:
            return tier
    return None


def _first_subscription_item(stripe_sub: Any) -> Any | None:
    items = stripe_sub.get("items") if isinstance(stripe_sub, dict) else getattr(stripe_sub, "items", None)
    if not items:
        return None
    data = items.get("data") if isinstance(items, dict) else getattr(items, "data", None)
    if not data:
        return None
    return data[0]


def _subscription_period_bounds(stripe_sub: Any) -> tuple[datetime | None, datetime | None]:
    """Stripe API 2025+ stores period bounds on the item, not the subscription root."""
    start_ts = None
    end_ts = None
    if isinstance(stripe_sub, dict):
        start_ts = stripe_sub.get("current_period_start")
        end_ts = stripe_sub.get("current_period_end")
    else:
        start_ts = getattr(stripe_sub, "current_period_start", None)
        end_ts = getattr(stripe_sub, "current_period_end", None)

    item = _first_subscription_item(stripe_sub)
    if item is not None:
        if start_ts is None:
            start_ts = item.get("current_period_start") if isinstance(item, dict) else getattr(item, "current_period_start", None)
        if end_ts is None:
            end_ts = item.get("current_period_end") if isinstance(item, dict) else getattr(item, "current_period_end", None)

    start = datetime.fromtimestamp(start_ts, tz=timezone.utc) if start_ts else None
    end = datetime.fromtimestamp(end_ts, tz=timezone.utc) if end_ts else None
    return start, end


def _price_from_subscription(stripe_sub: Any) -> tuple[str | None, Any | None]:
    item = _first_subscription_item(stripe_sub)
    if item is None:
        return None, None
    price = item.get("price") if isinstance(item, dict) else getattr(item, "price", None)
    if price is None:
        return None, None
    price_id = price.get("id") if isinstance(price, dict) else getattr(price, "id", None)
    return price_id, price


def _apply_stripe_subscription(sub: Subscription, stripe_sub: Any) -> None:
    """Copy Stripe subscription fields onto our Subscription row."""
    sub_id = stripe_sub.get("id") if isinstance(stripe_sub, dict) else getattr(stripe_sub, "id", None)
    if sub_id:
        sub.stripe_subscription_id = sub_id

    price_id, price_obj = _price_from_subscription(stripe_sub)
    mapped_tier = _tier_from_stripe_price(price_id, price_obj)
    if mapped_tier:
        sub.tier = mapped_tier

    raw_status = (
        stripe_sub.get("status", "active")
        if isinstance(stripe_sub, dict)
        else getattr(stripe_sub, "status", "active")
    )
    if raw_status == "active":
        sub.status = "active"
    elif raw_status == "past_due":
        sub.status = "past_due"
    elif raw_status == "trialing":
        sub.status = "active"
    else:
        sub.status = raw_status or "active"

    period_start, period_end = _subscription_period_bounds(stripe_sub)
    if period_start:
        sub.current_period_start = period_start
    if period_end:
        sub.current_period_end = period_end


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


async def cancel_active_subscription(user_id: str, db: AsyncSession) -> None:
    """Best-effort immediate cancellation of any active Stripe subscription.

    Called on account deletion so billing stops right away instead of
    continuing to charge a card tied to a deleted account. Never raises —
    a Stripe hiccup must not block the rest of account deletion.
    """
    result = await db.execute(select(Subscription).where(Subscription.user_id == user_id))
    sub = result.scalar_one_or_none()
    if not sub or not sub.stripe_subscription_id:
        return
    stripe.api_key = settings.stripe_secret_key
    try:
        stripe.Subscription.delete(sub.stripe_subscription_id)
    except Exception:
        logger.warning(
            "Failed to cancel Stripe subscription %s for deleted user %s",
            sub.stripe_subscription_id,
            user_id,
            exc_info=True,
        )


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
        client_reference_id=user_id,
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


async def fulfill_checkout_session(user_id: str, session_id: str, db: AsyncSession) -> dict:
    """Client-return fulfillment: apply Checkout Session when webhooks lag or fail."""
    stripe.api_key = settings.stripe_secret_key
    session = stripe.checkout.Session.retrieve(session_id, expand=["subscription"])
    meta_uid = _sget(_sget(session, "metadata") or {}, "user_id") or _sget(session, "client_reference_id")
    if meta_uid and meta_uid != user_id:
        raise ValueError("Checkout session does not belong to this user")

    customer_id = _sget(session, "customer")
    sub = await ensure_subscription(user_id, db)
    if customer_id and not sub.stripe_customer_id:
        sub.stripe_customer_id = customer_id

    subscription_obj = _sget(session, "subscription")
    if isinstance(subscription_obj, str):
        subscription_obj = stripe.Subscription.retrieve(subscription_obj)
    if subscription_obj:
        _apply_stripe_subscription(sub, subscription_obj)
    await db.flush()
    return await check_usage_budget(user_id, db)


async def reconcile_subscription_from_stripe(user_id: str, db: AsyncSession) -> bool:
    """If local row still looks unpaid but Stripe has an active sub, sync it.

    Returns True when a Stripe subscription was applied.
    """
    sub = await ensure_subscription(user_id, db)
    if not sub.stripe_customer_id:
        return False
    if sub.tier in _VALID_PAID_TIERS and sub.stripe_subscription_id and sub.status in ("active", "trialing"):
        return False

    stripe.api_key = settings.stripe_secret_key
    listing = stripe.Subscription.list(
        customer=sub.stripe_customer_id,
        status="all",
        limit=5,
    )
    candidates = list(_sget(listing, "data") or [])
    active = next((s for s in candidates if _sget(s, "status") in ("active", "trialing", "past_due")), None)
    if not active:
        return False
    _apply_stripe_subscription(sub, active)
    await db.flush()
    return True


async def get_billing_status(user_id: str, db: AsyncSession) -> dict:
    """Return billing status for frontend consumption."""
    # Self-heal missed webhooks (e.g. Stripe period fields moved onto items).
    await reconcile_subscription_from_stripe(user_id, db)
    return await check_usage_budget(user_id, db)


async def get_usage_summary(user_id: str, db: AsyncSession) -> dict:
    """Usage breakdown for the billing dashboard (current period or trial)."""
    from datetime import datetime, timezone

    from app.core.llm_client import PAID_SUBSCRIPTION_TIERS
    from app.models.subscription import UsageRecord

    budget = await check_usage_budget(user_id, db)
    tier = budget.get("tier", "none")

    result = await db.execute(
        select(Subscription).where(Subscription.user_id == user_id)
    )
    sub = result.scalar_one_or_none()

    period_start = None
    period_end = None
    if sub:
        period_start = sub.current_period_start
        period_end = sub.current_period_end

    if tier == "trial" and sub:
        period_start = sub.created_at
        period_end = None
    elif tier in PAID_SUBSCRIPTION_TIERS and not period_start and sub:
        period_start = sub.created_at

    usage_query = select(UsageRecord).where(UsageRecord.user_id == user_id)
    if period_start:
        usage_query = usage_query.where(UsageRecord.created_at >= period_start)
    if period_end:
        usage_query = usage_query.where(UsageRecord.created_at < period_end)

    records_result = await db.execute(usage_query.order_by(UsageRecord.created_at.desc()).limit(500))
    records = records_result.scalars().all()

    by_model: dict[str, dict] = {}
    by_day: dict[str, float] = {}
    total_input = 0
    total_output = 0

    for record in records:
        model = record.model
        bucket = by_model.setdefault(
            model,
            {
                "model": model,
                "input_tokens": 0,
                "output_tokens": 0,
                "estimated_cost_usd": 0.0,
                "call_count": 0,
            },
        )
        bucket["input_tokens"] += record.input_tokens
        bucket["output_tokens"] += record.output_tokens
        bucket["estimated_cost_usd"] += float(record.estimated_cost_usd)
        bucket["call_count"] += 1
        total_input += record.input_tokens
        total_output += record.output_tokens

        day_key = record.created_at.astimezone(timezone.utc).strftime("%Y-%m-%d")
        by_day[day_key] = by_day.get(day_key, 0.0) + float(record.estimated_cost_usd)

    model_rows = sorted(by_model.values(), key=lambda row: row["estimated_cost_usd"], reverse=True)
    daily_rows = [
        {"date": day, "estimated_cost_usd": round(cost, 6)}
        for day, cost in sorted(by_day.items())
    ]

    return {
        **budget,
        "period_start": period_start.isoformat() if period_start else None,
        "period_end": period_end.isoformat() if period_end else None,
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
        "by_model": model_rows,
        "by_day": daily_rows,
        "recent_calls": [
            {
                "model": r.model,
                "input_tokens": r.input_tokens,
                "output_tokens": r.output_tokens,
                "estimated_cost_usd": float(r.estimated_cost_usd),
                "created_at": r.created_at.isoformat(),
            }
            for r in records[:25]
        ],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


async def handle_webhook_event(payload: bytes, sig_header: str, db: AsyncSession) -> None:
    """Process a Stripe webhook event."""
    stripe.api_key = settings.stripe_secret_key
    event = stripe.Webhook.construct_event(payload, sig_header, settings.stripe_webhook_secret)

    event_type = event["type"]
    data = event["data"]["object"]

    if event_type == "checkout.session.completed":
        await _handle_checkout_completed(data, db)
    elif event_type in ("customer.subscription.created", "customer.subscription.updated"):
        await _handle_subscription_updated(data, db)
    elif event_type == "customer.subscription.deleted":
        await _handle_subscription_deleted(data, db)
    elif event_type == "invoice.payment_failed":
        await _handle_payment_failed(data, db)


async def _handle_checkout_completed(data: Any, db: AsyncSession) -> None:
    customer_id = _sget(data, "customer")
    subscription_id = _sget(data, "subscription")
    user_id = _sget(_sget(data, "metadata") or {}, "user_id") or _sget(data, "client_reference_id")
    if not customer_id and not user_id:
        return

    sub = None
    if customer_id:
        result = await db.execute(
            select(Subscription).where(Subscription.stripe_customer_id == customer_id)
        )
        sub = result.scalar_one_or_none()
    if not sub and user_id:
        result = await db.execute(select(Subscription).where(Subscription.user_id == user_id))
        sub = result.scalar_one_or_none()
    if not sub:
        return

    if customer_id and not sub.stripe_customer_id:
        sub.stripe_customer_id = customer_id

    if subscription_id:
        stripe.api_key = settings.stripe_secret_key
        stripe_sub = (
            subscription_id
            if isinstance(subscription_id, dict)
            else stripe.Subscription.retrieve(subscription_id)
        )
        _apply_stripe_subscription(sub, stripe_sub)
    await db.flush()


async def _handle_subscription_updated(data: Any, db: AsyncSession) -> None:
    sub_id = _sget(data, "id")
    customer_id = _sget(data, "customer")
    result = await db.execute(
        select(Subscription).where(Subscription.stripe_subscription_id == sub_id)
    )
    sub = result.scalar_one_or_none()
    if not sub and customer_id:
        # subscription.created often arrives before checkout.session.completed
        # has written stripe_subscription_id.
        result = await db.execute(
            select(Subscription).where(Subscription.stripe_customer_id == customer_id)
        )
        sub = result.scalar_one_or_none()
    if not sub:
        return
    _apply_stripe_subscription(sub, data)
    await db.flush()


async def _handle_subscription_deleted(data: Any, db: AsyncSession) -> None:
    sub_id = _sget(data, "id")
    result = await db.execute(
        select(Subscription).where(Subscription.stripe_subscription_id == sub_id)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        return
    sub.status = "canceled"
    await db.flush()


async def _handle_payment_failed(data: Any, db: AsyncSession) -> None:
    customer_id = _sget(data, "customer")
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
