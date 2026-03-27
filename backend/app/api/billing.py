import logging

import stripe
from fastapi import APIRouter, Depends, Request, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, AuthUser
from app.core.database import get_db
from app.config import get_settings
from app.services.billing import (
    get_billing_status,
    create_checkout_session,
    create_portal_session,
    handle_webhook_event,
    redeem_access_code,
    ensure_subscription,
)

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter(prefix="/billing", tags=["billing"])


class CheckoutRequest(BaseModel):
    price_id: str
    success_url: str
    cancel_url: str


class PortalRequest(BaseModel):
    return_url: str


class RedeemCodeRequest(BaseModel):
    code: str


@router.get("/status")
async def billing_status(
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not settings.billing_enabled:
        return {"allowed": True, "tier": "unlimited", "used_usd": 0, "limit_usd": 0}
    await ensure_subscription(user.uid, db)
    await db.commit()
    status = await get_billing_status(user.uid, db)
    return status


@router.post("/checkout")
async def checkout(
    body: CheckoutRequest,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not settings.billing_enabled:
        raise HTTPException(status_code=503, detail="Billing is not configured")
    url = await create_checkout_session(
        user_id=user.uid,
        email=user.email,
        price_id=body.price_id,
        db=db,
        success_url=body.success_url,
        cancel_url=body.cancel_url,
    )
    await db.commit()
    return {"url": url}


@router.post("/portal")
async def portal(
    body: PortalRequest,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not settings.billing_enabled:
        raise HTTPException(status_code=503, detail="Billing is not configured")
    try:
        url = await create_portal_session(
            user_id=user.uid,
            db=db,
            return_url=body.return_url,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
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
