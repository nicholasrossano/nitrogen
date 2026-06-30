"""Resolve provider, model, and credentials for LLM calls."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.llm_client import (
    BYOK_PROVIDER_PRIORITY,
    BYOK_SUPPORTED_PROVIDERS,
    _decrypt_api_key,
)
from app.core.model_catalog import (
    Complexity,
    ModelRole,
    ProviderRoute,
    get_model_spec,
    validate_override,
)

settings = get_settings()


@dataclass(frozen=True)
class LLMTarget:
    provider_route: ProviderRoute
    litellm_model: str
    billing_model: str
    api_key: str
    api_base: str | None
    is_byok: bool
    supports_web_search: bool
    use_openai_responses_web_search: bool


async def _load_byok_key(user_id: str, db: AsyncSession, provider: str) -> str | None:
    from app.models.subscription import UserApiKey
    from sqlalchemy import select

    result = await db.execute(
        select(UserApiKey.encrypted_key).where(
            UserApiKey.user_id == user_id,
            UserApiKey.provider == provider,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        return None
    try:
        return _decrypt_api_key(row)
    except Exception:
        return None


async def resolve_provider_route(
    user_id: Optional[str],
    db: Optional[AsyncSession],
) -> tuple[ProviderRoute, bool, str, str | None]:
    """
    Returns (provider_route, is_byok, api_key, api_base).
    provider_route is openai | openrouter (never platform as string).
    """
    if user_id and db and settings.api_key_encryption_key:
        for provider in BYOK_PROVIDER_PRIORITY:
            if provider not in BYOK_SUPPORTED_PROVIDERS:
                continue
            key = await _load_byok_key(user_id, db, provider)
            if key:
                base = settings.openrouter_base_url if provider == "openrouter" else None
                return provider, True, key, base

    if settings.model_routing_enabled and settings.openrouter_api_key:
        return "openrouter", False, settings.openrouter_api_key, settings.openrouter_base_url

    return "openai", False, settings.openai_api_key, None


async def resolve(
    user_id: Optional[str],
    db: Optional[AsyncSession],
    role: ModelRole,
    complexity: Complexity = Complexity.STANDARD,
    *,
    model_override: str | None = None,
    require_web_search: bool = False,
) -> LLMTarget:
    route, is_byok, api_key, api_base = await resolve_provider_route(user_id, db)

    if model_override and validate_override(route, model_override):
        billing = model_override.split("/")[-1].replace(":online", "")
        spec = get_model_spec(route, role, complexity, require_web_search=require_web_search)
        litellm_model = model_override
    else:
        spec = get_model_spec(route, role, complexity, require_web_search=require_web_search)
        litellm_model = spec.litellm_model
        billing = spec.billing_model

    use_responses = route == "openai" and spec.supports_web_search and role == ModelRole.WEB_SEARCH

    return LLMTarget(
        provider_route=route,
        litellm_model=litellm_model,
        billing_model=billing,
        api_key=api_key,
        api_base=api_base,
        is_byok=is_byok,
        supports_web_search=spec.supports_web_search,
        use_openai_responses_web_search=use_responses,
    )


async def primary_byok_provider(user_id: str, db: AsyncSession) -> ProviderRoute | None:
    for provider in BYOK_PROVIDER_PRIORITY:
        key = await _load_byok_key(user_id, db, provider)
        if key:
            return provider  # type: ignore[return-value]
    return None
