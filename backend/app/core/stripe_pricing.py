"""Live Stripe list price for the Individual plan, with TTL cache and static fallback.

Stripe is the source of truth for what customers are actually charged — Price
objects are immutable, so whoever changes the price in Stripe (creating a new
Price and repointing STRIPE_PRICE_ID) automatically updates the catalog label
and the derived usage budget here too, with no separate value to keep in sync.

Refresh is best-effort and never blocks a request on a network call (callers
should await ensure_price_fresh first, same pattern as openrouter_pricing).
Falls back to Settings.subscription_price_usd when Stripe isn't configured or
the fetch fails (e.g. self-hosted deployments without billing).

Callers that already hold a `Settings` instance should pass it in explicitly
(rather than relying on the default `get_settings()` lookup here) — several
tests call `get_settings.cache_clear()`, which would otherwise silently swap
in a freshly-constructed Settings object built from real process env vars.
"""

from __future__ import annotations

import asyncio
import logging
import time

import stripe

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

_price_usd: float | None = None
_fetched_at: float | None = None
_refresh_lock = asyncio.Lock()


def _ttl_seconds(settings: Settings) -> float:
    return float(settings.stripe_price_ttl_seconds)


def cache_age_seconds() -> float | None:
    if _fetched_at is None:
        return None
    return max(0.0, time.monotonic() - _fetched_at)


def is_cache_stale(settings: Settings | None = None) -> bool:
    age = cache_age_seconds()
    if age is None:
        return True
    return age >= _ttl_seconds(settings or get_settings())


def clear_price_cache() -> None:
    """Test helper."""
    global _price_usd, _fetched_at
    _price_usd = None
    _fetched_at = None


async def refresh_stripe_price(*, force: bool = False, settings: Settings | None = None) -> bool:
    """Fetch the live Stripe Price for settings.stripe_price_id. Returns True on success."""
    global _price_usd, _fetched_at

    settings = settings or get_settings()

    if not force and not is_cache_stale(settings):
        return True
    if not settings.stripe_secret_key or not settings.stripe_price_id:
        return False

    async with _refresh_lock:
        if not force and not is_cache_stale(settings):
            return True
        try:
            price = await stripe.Price.retrieve_async(
                settings.stripe_price_id, api_key=settings.stripe_secret_key
            )
            unit_amount = price["unit_amount"]
            if unit_amount is None:
                logger.warning("Stripe price %s has no unit_amount", settings.stripe_price_id)
                return False
            _price_usd = round(unit_amount / 100, 2)
            _fetched_at = time.monotonic()
            return True
        except Exception:
            logger.warning("Failed to refresh Stripe price; keeping prior cache/fallback", exc_info=True)
            return False


async def ensure_price_fresh(settings: Settings | None = None) -> None:
    """Best-effort refresh when the TTL has expired. Never raises."""
    try:
        await refresh_stripe_price(force=False, settings=settings)
    except Exception:
        logger.debug("ensure_price_fresh failed", exc_info=True)


def get_subscription_price_usd(settings: Settings | None = None) -> float:
    """Live Stripe price when cached, else the static Settings fallback."""
    if _price_usd is not None:
        return _price_usd
    return (settings or get_settings()).subscription_price_usd


def get_subscription_usage_limit_usd(settings: Settings | None = None) -> float:
    """Included AI budget for the period.

    Always derived from the live Stripe price × (1 − buffer) once that price is
    cached, so it can never silently drift out of sync with what Stripe charges.
    Falls back to Settings.subscription_usage_limit_usd (already derived from
    the static fallback price — see config.py) only when no live price is
    available yet.
    """
    settings = settings or get_settings()
    if _price_usd is not None:
        return round(_price_usd * (1.0 - settings.usage_budget_buffer_pct), 2)
    return settings.subscription_usage_limit_usd or 0.0
