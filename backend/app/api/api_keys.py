import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI

from app.core.auth import get_current_user, AuthUser
from app.core.database import get_db
from app.core.llm_client import encrypt_api_key
from app.config import get_settings
from app.models.subscription import UserApiKey, Subscription

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter(prefix="/settings/api-keys", tags=["api-keys"])


class StoreKeyBody(BaseModel):
    api_key: str
    provider: str = "openai"


class KeyOut(BaseModel):
    provider: str
    masked_key: str
    created_at: str


def _mask(key: str) -> str:
    if len(key) <= 9:
        return "***"
    return key[:5] + "..." + key[-4:]


# ── POST / — store (or update) an API key ───────────────────────
@router.post("/", response_model=KeyOut)
async def store_api_key(
    body: StoreKeyBody,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Validate the key against OpenAI
    try:
        await AsyncOpenAI(api_key=body.api_key).models.list()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid API key: {exc}")

    if not settings.api_key_encryption_key:
        raise HTTPException(
            status_code=503,
            detail="API-key storage is not configured on this server",
        )

    encrypted = encrypt_api_key(body.api_key)

    # Upsert: update existing row or create new one
    result = await db.execute(
        select(UserApiKey).where(
            UserApiKey.user_id == user.uid,
            UserApiKey.provider == body.provider,
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.encrypted_key = encrypted
        row = existing
    else:
        row = UserApiKey(
            user_id=user.uid,
            provider=body.provider,
            encrypted_key=encrypted,
        )
        db.add(row)

    # Ensure subscription tier is "byok"
    sub_result = await db.execute(
        select(Subscription).where(Subscription.user_id == user.uid)
    )
    sub = sub_result.scalar_one_or_none()
    if sub:
        if sub.tier in ("trial",):
            sub.tier = "byok"
    else:
        db.add(Subscription(user_id=user.uid, tier="byok", status="active"))

    await db.commit()
    await db.refresh(row)

    return KeyOut(
        provider=row.provider,
        masked_key=_mask(body.api_key),
        created_at=row.created_at.isoformat(),
    )


# ── GET / — list stored keys (masked) ───────────────────────────
@router.get("/", response_model=list[KeyOut])
async def list_api_keys(
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserApiKey).where(UserApiKey.user_id == user.uid)
    )
    keys = result.scalars().all()
    out: list[KeyOut] = []
    for k in keys:
        # Decrypt just to produce a masked preview
        try:
            from app.core.llm_client import _decrypt_api_key
            raw = _decrypt_api_key(k.encrypted_key)
            masked = _mask(raw)
        except Exception:
            masked = "***"
        out.append(
            KeyOut(
                provider=k.provider,
                masked_key=masked,
                created_at=k.created_at.isoformat(),
            )
        )
    return out


# ── DELETE /{provider} — remove a stored key ─────────────────────
@router.delete("/{provider}")
async def delete_api_key(
    provider: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        delete(UserApiKey).where(
            UserApiKey.user_id == user.uid,
            UserApiKey.provider == provider,
        )
    )
    if result.rowcount == 0:  # type: ignore[attr-defined]
        raise HTTPException(status_code=404, detail="Key not found")

    # If no BYOK keys remain, revert tier to "trial" (unless Stripe-backed)
    remaining = await db.execute(
        select(UserApiKey.id).where(UserApiKey.user_id == user.uid)
    )
    if remaining.first() is None:
        sub_result = await db.execute(
            select(Subscription).where(Subscription.user_id == user.uid)
        )
        sub = sub_result.scalar_one_or_none()
        if sub and sub.tier == "byok" and not sub.stripe_subscription_id:
            sub.tier = "trial"

    await db.commit()
    return {"success": True}
