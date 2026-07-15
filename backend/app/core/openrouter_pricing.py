"""Live-ish OpenRouter model pricing with TTL cache and static fallback.

OpenRouter GET /models returns USD *per token*; we store USD *per 1M tokens*
to match MODEL_PRICING. Refresh is best-effort — estimate_cost never blocks
on a network call (callers should await ensure_pricing_fresh first).
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from app.config import get_settings
from app.core.http_client import get_http_client

logger = logging.getLogger(__name__)

# model key → {"input": $/1M, "output": $/1M}
_pricing_by_key: dict[str, dict[str, float]] = {}
_fetched_at: float | None = None
_refresh_lock = asyncio.Lock()


def _ttl_seconds() -> float:
    return float(get_settings().openrouter_pricing_ttl_seconds)


def cache_age_seconds() -> float | None:
    if _fetched_at is None:
        return None
    return max(0.0, time.monotonic() - _fetched_at)


def is_cache_stale() -> bool:
    age = cache_age_seconds()
    return age is None or age >= _ttl_seconds()


def clear_pricing_cache() -> None:
    """Test helper."""
    global _pricing_by_key, _fetched_at
    _pricing_by_key = {}
    _fetched_at = None


def _per_token_to_per_million(raw: Any) -> float | None:
    try:
        per_token = float(raw)
    except (TypeError, ValueError):
        return None
    if per_token < 0:
        return None
    return round(per_token * 1_000_000, 6)


def _index_model(target: dict[str, dict[str, float]], model: dict[str, Any]) -> None:
    pricing = model.get("pricing") or {}
    inp = _per_token_to_per_million(pricing.get("prompt"))
    out = _per_token_to_per_million(pricing.get("completion"))
    if inp is None or out is None:
        return
    rates = {"input": inp, "output": out}

    keys: list[str] = []
    mid = (model.get("id") or "").strip()
    if mid:
        keys.append(mid)
        keys.append(mid.split("/")[-1])
    slug = (model.get("canonical_slug") or "").strip()
    if slug and slug not in keys:
        keys.append(slug)
        keys.append(slug.split("/")[-1])

    for key in keys:
        cleaned = key.replace(":online", "")
        if not cleaned:
            continue
        if "/" in cleaned:
            target[cleaned] = rates
        elif cleaned not in target:
            # Short name: first writer wins (avoid clobbering openai/* with a later vendor).
            target[cleaned] = rates


def _parse_models_payload(payload: dict[str, Any]) -> dict[str, dict[str, float]]:
    indexed: dict[str, dict[str, float]] = {}
    for model in payload.get("data") or []:
        if isinstance(model, dict):
            _index_model(indexed, model)
    return indexed


async def refresh_openrouter_pricing(*, force: bool = False) -> bool:
    """Fetch OpenRouter /models and replace the in-memory cache. Returns True on success."""
    global _pricing_by_key, _fetched_at

    if not force and not is_cache_stale():
        return True

    async with _refresh_lock:
        if not force and not is_cache_stale():
            return True

        settings = get_settings()
        base = (settings.openrouter_base_url or "https://openrouter.ai/api/v1").rstrip("/")
        url = f"{base}/models"
        headers: dict[str, str] = {}
        if settings.openrouter_api_key:
            headers["Authorization"] = f"Bearer {settings.openrouter_api_key}"

        try:
            client = get_http_client()
            resp = await client.get(url, headers=headers, timeout=20.0)
            resp.raise_for_status()
            payload = resp.json()
            indexed = _parse_models_payload(payload if isinstance(payload, dict) else {})
            if not indexed:
                logger.warning("OpenRouter /models returned no usable pricing entries")
                return False
            _pricing_by_key = indexed
            _fetched_at = time.monotonic()
            logger.info("Refreshed OpenRouter pricing cache (%d keys)", len(indexed))
            return True
        except Exception:
            logger.warning("Failed to refresh OpenRouter pricing; keeping prior cache", exc_info=True)
            return False


async def ensure_pricing_fresh() -> None:
    """Best-effort refresh when the TTL has expired. Never raises."""
    try:
        await refresh_openrouter_pricing(force=False)
    except Exception:
        logger.debug("ensure_pricing_fresh failed", exc_info=True)


def lookup_openrouter_pricing(model: str) -> dict[str, float] | None:
    """Return cached $/1M rates for a billing/litellm model id, or None."""
    if not _pricing_by_key:
        return None
    key = (model or "").strip().replace(":online", "")
    if not key:
        return None
    if key in _pricing_by_key:
        return _pricing_by_key[key]
    # openrouter/openai/gpt-4o → openai/gpt-4o → gpt-4o
    parts = key.split("/")
    for candidate in (
        "/".join(parts[-2:]) if len(parts) >= 2 else None,
        parts[-1],
    ):
        if candidate and candidate in _pricing_by_key:
            return _pricing_by_key[candidate]
    return None
