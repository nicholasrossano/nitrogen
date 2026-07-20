import logging

import stripe
from fastapi import APIRouter, Depends, Request, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, AuthUser
from app.core.database import get_db
from app.config import get_settings
from app.core.redirect_validation import validate_billing_redirect_url
from app.services.billing import (
    create_checkout_session,
    create_portal_session,
    ensure_subscription,
    fulfill_checkout_session,
    get_billing_status,
    get_usage_summary,
    handle_webhook_event,
    redeem_access_code,
)

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter(prefix="/billing", tags=["billing"])


class CheckoutRequest(BaseModel):
    success_url: str
    cancel_url: str
    # Optional; defaults to settings.stripe_price_id (individual plan).
    price_id: str | None = None


class PortalRequest(BaseModel):
    return_url: str


class ConfirmCheckoutRequest(BaseModel):
    session_id: str


class RedeemCodeRequest(BaseModel):
    code: str


@router.get("/catalog")
async def billing_catalog():
    """Public plan labels for the UI — price/usage-cap come from the live Stripe
    Price (source of truth) when configured, else the static Settings fallback."""
    from app.core.stripe_pricing import (
        ensure_price_fresh,
        get_subscription_price_usd,
        get_subscription_usage_limit_usd,
        is_key_invalid,
    )

    await ensure_price_fresh(settings)
    return {
        "billing_enabled": settings.billing_enabled,
        "subscription_price_usd": get_subscription_price_usd(settings),
        "subscription_usage_limit_usd": get_subscription_usage_limit_usd(settings),
        "usage_budget_buffer_pct": settings.usage_budget_buffer_pct,
        "stripe_price_id": settings.stripe_price_id or None,
        # False once Stripe has explicitly rejected STRIPE_SECRET_KEY — lets the
        # frontend disable Subscribe with an accurate message instead of a
        # generic error after a failed checkout round-trip.
        "stripe_key_valid": not is_key_invalid(),
    }


@router.get("/status")
async def billing_status(
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not settings.billing_enabled:
        return {"allowed": True, "tier": "unlimited", "used_usd": 0, "limit_usd": 0}
    await ensure_subscription(user.uid, db)
    status = await get_billing_status(user.uid, db)
    await db.commit()
    return status


@router.get("/usage")
async def billing_usage(
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not settings.billing_enabled:
        return {
            "allowed": True,
            "tier": "unlimited",
            "used_usd": 0,
            "limit_usd": 0,
            "by_model": [],
            "by_day": [],
            "recent_calls": [],
        }
    await ensure_subscription(user.uid, db)
    summary = await get_usage_summary(user.uid, db)
    await db.commit()
    return summary


@router.post("/checkout")
async def checkout(
    body: CheckoutRequest,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not settings.billing_enabled:
        raise HTTPException(status_code=503, detail="Billing is not configured")
    price_id = body.price_id or settings.stripe_price_id
    if not price_id:
        raise HTTPException(status_code=503, detail="Subscription price is not configured")
    success_url = validate_billing_redirect_url(body.success_url)
    cancel_url = validate_billing_redirect_url(body.cancel_url)
    try:
        url = await create_checkout_session(
            user_id=user.uid,
            email=user.email,
            price_id=price_id,
            db=db,
            success_url=success_url,
            cancel_url=cancel_url,
        )
    except stripe.AuthenticationError:
        logger.error("Checkout failed: STRIPE_SECRET_KEY was rejected by Stripe (401)")
        raise HTTPException(
            status_code=503,
            detail="Stripe is misconfigured on this deployment (invalid API key). Contact support.",
        )
    except stripe.InvalidRequestError as e:
        logger.error("Checkout failed: Stripe rejected the request: %s", e)
        raise HTTPException(
            status_code=503,
            detail="Stripe is misconfigured on this deployment (invalid price). Contact support.",
        )
    await db.commit()
    return {"url": url}


@router.post("/confirm-checkout")
async def confirm_checkout(
    body: ConfirmCheckoutRequest,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fulfill a Checkout Session on browser return (webhook backup)."""
    if not settings.billing_enabled:
        raise HTTPException(status_code=503, detail="Billing is not configured")
    session_id = (body.session_id or "").strip()
    if not session_id.startswith("cs_"):
        raise HTTPException(status_code=400, detail="Invalid checkout session id")
    try:
        status = await fulfill_checkout_session(user.uid, session_id, db)
        await db.commit()
        return status
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except stripe.InvalidRequestError as e:
        logger.error("Confirm checkout failed: %s", e)
        raise HTTPException(status_code=400, detail="Invalid checkout session")
    except stripe.AuthenticationError:
        logger.error("Confirm checkout failed: STRIPE_SECRET_KEY rejected by Stripe")
        raise HTTPException(
            status_code=503,
            detail="Stripe is misconfigured on this deployment (invalid API key). Contact support.",
        )


@router.post("/portal")
async def portal(
    body: PortalRequest,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not settings.billing_enabled:
        raise HTTPException(status_code=503, detail="Billing is not configured")
    return_url = validate_billing_redirect_url(body.return_url)
    try:
        url = await create_portal_session(
            user_id=user.uid,
            db=db,
            return_url=return_url,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except stripe.AuthenticationError:
        logger.error("Portal session failed: STRIPE_SECRET_KEY was rejected by Stripe (401)")
        raise HTTPException(
            status_code=503,
            detail="Stripe is misconfigured on this deployment (invalid API key). Contact support.",
        )
    await db.commit()
    return {"url": url}


@router.post("/webhook")
async def webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    if not sig_header:
        raise HTTPException(status_code=400, detail="Missing stripe-signature header")
    try:
        await handle_webhook_event(payload, sig_header, db)
        await db.commit()
    except stripe.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")
    except Exception:
        logger.exception("Webhook processing failed")
        raise HTTPException(status_code=500, detail="Webhook processing failed")
    return {"status": "ok"}


@router.post("/redeem-code")
async def redeem_code(
    body: RedeemCodeRequest,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not settings.billing_enabled:
        raise HTTPException(status_code=503, detail="Billing is not configured")
    result = await redeem_access_code(user.uid, body.code, db)
    await db.commit()
    return result
