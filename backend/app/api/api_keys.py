import logging

from fastapi import APIRouter, Depends, HTTPException
from openai import AsyncOpenAI
from pydantic import BaseModel, field_validator
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.auth import AuthUser, get_current_user
from app.core.database import get_db
from app.core.llm_client import BYOK_SUPPORTED_PROVIDERS, encrypt_api_key, user_has_byok
from app.models.subscription import Subscription, UserApiKey

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter(prefix="/settings/api-keys", tags=["api-keys"])


class StoreKeyBody(BaseModel):
    api_key: str
    provider: str = "openai"

    @field_validator("provider")
    @classmethod
    def validate_provider(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in BYOK_SUPPORTED_PROVIDERS:
            supported = ", ".join(sorted(BYOK_SUPPORTED_PROVIDERS))
            raise ValueError(
                f"Unsupported provider '{value}'. Supported BYOK providers: {supported}"
            )
        return normalized


class KeyOut(BaseModel):
    provider: str
    masked_key: str
    created_at: str


def _mask(key: str) -> str:
    if len(key) <= 9:
        return "***"
    return key[:5] + "..." + key[-4:]


async def _validate_api_key(provider: str, api_key: str) -> None:
    try:
        if provider == "openrouter":
            client = AsyncOpenAI(
                api_key=api_key,
                base_url=settings.openrouter_base_url,
            )
        else:
            client = AsyncOpenAI(api_key=api_key)
        await client.models.list()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid API key: {exc}") from exc


@router.post("/", response_model=KeyOut)
async def store_api_key(
    body: StoreKeyBody,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _validate_api_key(body.provider, body.api_key)

    if not settings.api_key_encryption_key:
        raise HTTPException(
            status_code=503,
            detail="API-key storage is not configured on this server",
        )

    encrypted = encrypt_api_key(body.api_key)

    # One active BYOK key: replace the other provider when switching.
    other_providers = [p for p in BYOK_SUPPORTED_PROVIDERS if p != body.provider]
    if other_providers:
        await db.execute(
            delete(UserApiKey).where(
                UserApiKey.user_id == user.uid,
                UserApiKey.provider.in_(other_providers),
            )
        )

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

    sub_result = await db.execute(
        select(Subscription).where(Subscription.user_id == user.uid)
    )
    sub = sub_result.scalar_one_or_none()
    if sub:
        if sub.tier == "trial":
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
        select(UserApiKey).where(
            UserApiKey.user_id == user.uid,
            UserApiKey.provider.in_(BYOK_SUPPORTED_PROVIDERS),
        )
    )
    keys = result.scalars().all()
    out: list[KeyOut] = []
    for k in keys:
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
    normalized = provider.strip().lower()
    if normalized not in BYOK_SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unsupported provider")

    result = await db.execute(
        delete(UserApiKey).where(
            UserApiKey.user_id == user.uid,
            UserApiKey.provider == normalized,
        )
    )
    if result.rowcount == 0:  # type: ignore[attr-defined]
        raise HTTPException(status_code=404, detail="Key not found")

    if not await user_has_byok(user.uid, db):
        sub_result = await db.execute(
            select(Subscription).where(Subscription.user_id == user.uid)
        )
        sub = sub_result.scalar_one_or_none()
        if sub and sub.tier == "byok" and not sub.stripe_subscription_id:
            sub.tier = "trial"

    await db.commit()
    return {"success": True}
