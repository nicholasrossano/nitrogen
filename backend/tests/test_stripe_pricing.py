"""Stripe price cache: TTL refresh, live-price precedence, static fallback."""

from unittest.mock import AsyncMock, MagicMock

import pytest
import stripe

from app.core import stripe_pricing as sp


@pytest.fixture(autouse=True)
def _clear_cache():
    sp.clear_price_cache()
    yield
    sp.clear_price_cache()


def _settings(**overrides):
    defaults = dict(
        stripe_secret_key="sk_test",
        stripe_price_id="price_123",
        stripe_price_ttl_seconds=3600,
        subscription_price_usd=20.0,
        subscription_usage_limit_usd=19.0,
        usage_budget_buffer_pct=0.05,
    )
    defaults.update(overrides)
    return MagicMock(**defaults)


def test_get_subscription_price_falls_back_to_static_when_cache_cold():
    settings = _settings()
    assert sp.get_subscription_price_usd(settings) == 20.0
    assert sp.get_subscription_usage_limit_usd(settings) == 19.0


@pytest.mark.asyncio
async def test_refresh_stripe_price_success(monkeypatch):
    price = {"unit_amount": 2000}
    retrieve_mock = AsyncMock(return_value=price)
    monkeypatch.setattr(sp.stripe.Price, "retrieve_async", retrieve_mock)
    settings = _settings()

    ok = await sp.refresh_stripe_price(force=True, settings=settings)
    assert ok is True
    assert sp.get_subscription_price_usd(settings) == 20.0
    # Derived, not the stale static override: price * (1 - 5%)
    assert sp.get_subscription_usage_limit_usd(settings) == 19.0
    retrieve_mock.assert_awaited_once_with("price_123", api_key="sk_test")


@pytest.mark.asyncio
async def test_refresh_stripe_price_overrides_stale_static_limit(monkeypatch):
    """A live $20 Stripe price wins even if a stale $30 override secret is set."""
    price = {"unit_amount": 2000}
    monkeypatch.setattr(sp.stripe.Price, "retrieve_async", AsyncMock(return_value=price))
    settings = _settings(subscription_price_usd=30.0, subscription_usage_limit_usd=30.0)

    assert await sp.refresh_stripe_price(force=True, settings=settings) is True
    assert sp.get_subscription_price_usd(settings) == 20.0
    assert sp.get_subscription_usage_limit_usd(settings) == 19.0


@pytest.mark.asyncio
async def test_refresh_keeps_fallback_on_failure(monkeypatch):
    monkeypatch.setattr(
        sp.stripe.Price, "retrieve_async", AsyncMock(side_effect=RuntimeError("network down"))
    )
    settings = _settings()

    ok = await sp.refresh_stripe_price(force=True, settings=settings)
    assert ok is False
    assert sp.get_subscription_price_usd(settings) == 20.0
    assert sp.get_subscription_usage_limit_usd(settings) == 19.0


@pytest.mark.asyncio
async def test_refresh_skipped_without_stripe_configured(monkeypatch):
    retrieve_mock = AsyncMock()
    monkeypatch.setattr(sp.stripe.Price, "retrieve_async", retrieve_mock)
    settings = _settings(stripe_price_id="")

    ok = await sp.refresh_stripe_price(force=True, settings=settings)
    assert ok is False
    retrieve_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_ensure_price_fresh_never_raises(monkeypatch):
    monkeypatch.setattr(
        sp.stripe.Price, "retrieve_async", AsyncMock(side_effect=RuntimeError("boom"))
    )
    settings = _settings()

    await sp.ensure_price_fresh(settings)  # should not raise


@pytest.mark.asyncio
async def test_refresh_flags_invalid_key_on_auth_error(monkeypatch):
    """A bad/placeholder STRIPE_SECRET_KEY must be distinguishable from a
    transient network failure so the catalog endpoint can warn accurately."""
    monkeypatch.setattr(
        sp.stripe.Price,
        "retrieve_async",
        AsyncMock(side_effect=stripe.AuthenticationError("Invalid API Key provided")),
    )
    settings = _settings()

    assert sp.is_key_invalid() is False
    ok = await sp.refresh_stripe_price(force=True, settings=settings)
    assert ok is False
    assert sp.is_key_invalid() is True


@pytest.mark.asyncio
async def test_refresh_does_not_flag_invalid_key_on_generic_failure(monkeypatch):
    monkeypatch.setattr(
        sp.stripe.Price, "retrieve_async", AsyncMock(side_effect=RuntimeError("network down"))
    )
    settings = _settings()

    await sp.refresh_stripe_price(force=True, settings=settings)
    assert sp.is_key_invalid() is False


@pytest.mark.asyncio
async def test_refresh_clears_invalid_key_flag_on_recovery(monkeypatch):
    monkeypatch.setattr(
        sp.stripe.Price,
        "retrieve_async",
        AsyncMock(side_effect=stripe.AuthenticationError("Invalid API Key provided")),
    )
    settings = _settings()
    await sp.refresh_stripe_price(force=True, settings=settings)
    assert sp.is_key_invalid() is True

    monkeypatch.setattr(
        sp.stripe.Price, "retrieve_async", AsyncMock(return_value={"unit_amount": 2000})
    )
    ok = await sp.refresh_stripe_price(force=True, settings=settings)
    assert ok is True
    assert sp.is_key_invalid() is False
