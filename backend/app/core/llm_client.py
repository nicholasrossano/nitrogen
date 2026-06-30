"""
Centralized OpenAI client factory with per-user key resolution and usage tracking.

Prefer `app.core.llm_invoke.acompletion` / `aembedding` / `run_web_search` for LLM calls.
This module remains for BYOK key management, usage recording, and budget checks.
"""

import logging
from decimal import Decimal
from typing import Optional

from openai import AsyncOpenAI
from sqlalchemy import select, func as sa_func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# BYOK providers supported in billing v1 (OpenAI-compatible embeddings).
# Anthropic/Gemini direct keys are deferred until embedding strategy changes.
BYOK_SUPPORTED_PROVIDERS: frozenset[str] = frozenset({"openai", "openrouter"})
BYOK_PROVIDER_PRIORITY: tuple[str, ...] = ("openai", "openrouter")

PAID_SUBSCRIPTION_TIERS: frozenset[str] = frozenset({"individual", "starter", "pro"})

# ── Model pricing (per 1M tokens, USD) ─────────────────────────
MODEL_PRICING: dict[str, dict[str, float]] = {
    "gpt-4o":                  {"input": 2.50,  "output": 10.00},
    "gpt-4o-mini":             {"input": 0.15,  "output": 0.60},
    "gpt-4.1":                 {"input": 2.00,  "output": 8.00},
    "gpt-4.1-mini":            {"input": 0.40,  "output": 1.60},
    "gpt-4.1-nano":            {"input": 0.10,  "output": 0.40},
    "o3-mini":                 {"input": 1.10,  "output": 4.40},
    "text-embedding-ada-002":  {"input": 0.10,  "output": 0.00},
    "text-embedding-3-small":  {"input": 0.02,  "output": 0.00},
    "text-embedding-3-large":  {"input": 0.13,  "output": 0.00},
}

_FALLBACK_PRICING = {"input": 5.00, "output": 15.00}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> Decimal:
    pricing = MODEL_PRICING.get(model, _FALLBACK_PRICING)
    cost = (
        input_tokens * pricing["input"] / 1_000_000
        + output_tokens * pricing["output"] / 1_000_000
    )
    return Decimal(str(round(cost, 6)))


# ── BYOK key decryption ────────────────────────────────────────

def _decrypt_api_key(encrypted_key: str) -> str:
    from cryptography.fernet import Fernet
    f = Fernet(settings.api_key_encryption_key.encode())
    return f.decrypt(encrypted_key.encode()).decode()


def encrypt_api_key(raw_key: str) -> str:
    from cryptography.fernet import Fernet
    f = Fernet(settings.api_key_encryption_key.encode())
    return f.encrypt(raw_key.encode()).decode()


# ── Client factory ──────────────────────────────────────────────

async def user_has_byok(user_id: str, db: AsyncSession) -> bool:
    """True when the user has a stored OpenAI or OpenRouter API key."""
    from app.models.subscription import UserApiKey

    result = await db.execute(
        select(UserApiKey.id).where(
            UserApiKey.user_id == user_id,
            UserApiKey.provider.in_(BYOK_SUPPORTED_PROVIDERS),
        )
    )
    return result.scalar_one_or_none() is not None


async def get_user_byok_providers(user_id: str, db: AsyncSession) -> list[str]:
    from app.models.subscription import UserApiKey

    result = await db.execute(
        select(UserApiKey.provider).where(
            UserApiKey.user_id == user_id,
            UserApiKey.provider.in_(BYOK_SUPPORTED_PROVIDERS),
        )
    )
    return sorted({row for row in result.scalars().all()})


async def get_openai_client(
    user_id: Optional[str],
    db: Optional[AsyncSession],
) -> tuple[AsyncOpenAI, bool]:
    """
    Returns (client, is_byok).

    Resolution order:
      1. User's OpenAI BYOK key (direct OpenAI API)
      2. User's OpenRouter BYOK key (OpenAI-compatible base URL)
      3. Platform OpenAI key
    """
    if user_id and db and settings.api_key_encryption_key:
        from app.models.subscription import UserApiKey

        for provider in BYOK_PROVIDER_PRIORITY:
            result = await db.execute(
                select(UserApiKey.encrypted_key).where(
                    UserApiKey.user_id == user_id,
                    UserApiKey.provider == provider,
                )
            )
            row = result.scalar_one_or_none()
            if not row:
                continue
            try:
                decrypted = _decrypt_api_key(row)
                if provider == "openrouter":
                    return (
                        AsyncOpenAI(
                            api_key=decrypted,
                            base_url=settings.openrouter_base_url,
                        ),
                        True,
                    )
                return AsyncOpenAI(api_key=decrypted), True
            except Exception:
                logger.warning(
                    "Failed to decrypt BYOK key for user %s provider %s, trying next",
                    user_id,
                    provider,
                )

    if settings.openrouter_api_key:
        return (
            AsyncOpenAI(
                api_key=settings.openrouter_api_key,
                base_url=settings.openrouter_base_url,
            ),
            False,
        )

    return AsyncOpenAI(api_key=settings.openai_api_key), False


# ── Usage recording ─────────────────────────────────────────────

async def record_usage(
    user_id: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    db: AsyncSession,
    *,
    is_byok: bool = False,
) -> None:
    """
    Record a usage event. Skipped for BYOK users and when billing is disabled.
    Also increments trial_cost_used for trial users.
    """
    if is_byok or not settings.billing_enabled:
        return

    cost = estimate_cost(model, input_tokens, output_tokens)

    from app.models.subscription import UsageRecord, Subscription
    record = UsageRecord(
        user_id=user_id,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        estimated_cost_usd=cost,
    )
    db.add(record)

    # Bump trial counters if on trial
    result = await db.execute(
        select(Subscription).where(Subscription.user_id == user_id)
    )
    sub = result.scalar_one_or_none()
    if sub and sub.tier == "trial":
        sub.trial_cost_used = (sub.trial_cost_used or Decimal("0")) + cost

    await db.flush()


async def record_usage_from_response(
    user_id: str,
    model: str,
    response,
    db: AsyncSession,
    *,
    is_byok: bool = False,
) -> None:
    """Extract usage from an OpenAI response object and record it."""
    usage = getattr(response, "usage", None)
    if not usage:
        return
    input_tokens = getattr(usage, "prompt_tokens", 0) or getattr(usage, "input_tokens", 0) or 0
    output_tokens = getattr(usage, "completion_tokens", 0) or getattr(usage, "output_tokens", 0) or 0
    await record_usage(user_id, model, input_tokens, output_tokens, db, is_byok=is_byok)


# ── Budget check ────────────────────────────────────────────────

async def check_usage_budget(user_id: str, db: AsyncSession) -> dict:
    """
    Returns dict with keys:
      allowed (bool), tier, used_usd, limit_usd, trial_messages_remaining,
      access_code_redeemed, access_code_available
    """
    if not settings.billing_enabled:
        return {"allowed": True, "tier": "unlimited", "used_usd": 0, "limit_usd": 0}

    from app.models.subscription import Subscription, UsageRecord

    if await user_has_byok(user_id, db):
        providers = await get_user_byok_providers(user_id, db)
        return {
            "allowed": True,
            "tier": "byok",
            "used_usd": 0,
            "limit_usd": 0,
            "byok_providers": providers,
        }

    result = await db.execute(
        select(Subscription).where(Subscription.user_id == user_id)
    )
    sub = result.scalar_one_or_none()

    if not sub:
        return {
            "allowed": False,
            "tier": "none",
            "used_usd": 0,
            "limit_usd": 0,
            "access_code_available": bool(settings.access_code),
        }

    tier = sub.tier
    access_code_available = bool(settings.access_code) and not sub.access_code_redeemed

    if tier == "trial":
        if sub.access_code_redeemed:
            limit = Decimal(str(settings.subscription_usage_limit_usd))
        else:
            limit = Decimal(str(settings.trial_cost_limit_usd))
        used = sub.trial_cost_used or Decimal("0")
        messages_remaining = max(0, settings.trial_message_limit - (sub.trial_messages_used or 0))
        allowed = float(used) < float(limit) and messages_remaining > 0
        if sub.access_code_redeemed:
            # Access code trial: only cost limit applies (no message cap)
            allowed = float(used) < float(limit)
        return {
            "allowed": allowed,
            "tier": "trial",
            "used_usd": float(used),
            "limit_usd": float(limit),
            "trial_messages_remaining": messages_remaining if not sub.access_code_redeemed else None,
            "access_code_redeemed": sub.access_code_redeemed,
            "access_code_available": access_code_available,
            "status": sub.status,
        }

    if tier in PAID_SUBSCRIPTION_TIERS:
        if sub.status not in ("active", "trialing"):
            return {
                "allowed": False,
                "tier": tier,
                "used_usd": 0,
                "limit_usd": 0,
                "status": sub.status,
                "access_code_available": access_code_available,
            }
        if tier in ("starter", "pro"):
            limit_usd = (
                settings.starter_usage_limit_usd if tier == "starter"
                else settings.pro_usage_limit_usd
            )
        else:
            limit_usd = settings.subscription_usage_limit_usd
        period_start = sub.current_period_start
        if period_start:
            usage_result = await db.execute(
                select(sa_func.coalesce(sa_func.sum(UsageRecord.estimated_cost_usd), 0)).where(
                    UsageRecord.user_id == user_id,
                    UsageRecord.created_at >= period_start,
                )
            )
            used = float(usage_result.scalar())
        else:
            used = 0.0
        return {
            "allowed": used < limit_usd,
            "tier": tier,
            "used_usd": used,
            "limit_usd": limit_usd,
            "status": sub.status,
            "access_code_available": access_code_available,
            "period_start": period_start.isoformat() if period_start else None,
            "period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
        }

    return {"allowed": True, "tier": tier, "used_usd": 0, "limit_usd": 0}
