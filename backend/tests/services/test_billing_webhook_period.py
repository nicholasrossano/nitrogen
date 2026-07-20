"""Stripe webhook period bounds: API 2025+ puts periods on items."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services import billing as billing_service


def test_subscription_period_bounds_from_item():
    stripe_sub = {
        "id": "sub_x",
        "status": "active",
        "items": {
            "data": [
                {
                    "current_period_start": 1_700_000_000,
                    "current_period_end": 1_702_592_000,
                    "price": {
                        "id": "price_ind",
                        "metadata": {"app_tier": "individual"},
                    },
                }
            ]
        },
    }
    start, end = billing_service._subscription_period_bounds(stripe_sub)
    assert start == datetime.fromtimestamp(1_700_000_000, tz=timezone.utc)
    assert end == datetime.fromtimestamp(1_702_592_000, tz=timezone.utc)


def test_subscription_period_bounds_prefers_root_when_present():
    stripe_sub = {
        "current_period_start": 100,
        "current_period_end": 200,
        "items": {
            "data": [
                {
                    "current_period_start": 1_700_000_000,
                    "current_period_end": 1_702_592_000,
                }
            ]
        },
    }
    start, end = billing_service._subscription_period_bounds(stripe_sub)
    assert start == datetime.fromtimestamp(100, tz=timezone.utc)
    assert end == datetime.fromtimestamp(200, tz=timezone.utc)


def test_tier_from_price_metadata_fallback(monkeypatch):
    monkeypatch.setattr(billing_service.settings, "stripe_price_id", "price_other")
    monkeypatch.setattr(billing_service.settings, "stripe_starter_price_id", "")
    monkeypatch.setattr(billing_service.settings, "stripe_pro_price_id", "")
    assert (
        billing_service._tier_from_stripe_price(
            "price_unknown",
            {"id": "price_unknown", "metadata": {"app_tier": "individual"}},
        )
        == "individual"
    )


@pytest.mark.asyncio
async def test_handle_checkout_completed_item_period_does_not_crash(monkeypatch):
    monkeypatch.setattr(billing_service.settings, "stripe_price_id", "price_ind")
    monkeypatch.setattr(billing_service.settings, "stripe_secret_key", "sk_test")

    sub = MagicMock()
    sub.stripe_customer_id = "cus_1"
    sub.stripe_subscription_id = None
    sub.tier = "trial"
    sub.status = "active"

    result = MagicMock()
    result.scalar_one_or_none.return_value = sub
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    db.flush = AsyncMock()

    stripe_sub = {
        "id": "sub_1",
        "status": "active",
        # No root current_period_* — mirrors live Stripe flexible billing payloads.
        "items": {
            "data": [
                {
                    "current_period_start": 1_700_000_000,
                    "current_period_end": 1_702_592_000,
                    "price": {"id": "price_ind", "metadata": {}},
                }
            ]
        },
    }

    class _FakeStripe:
        class Subscription:
            @staticmethod
            def retrieve(_sid):
                return stripe_sub

    monkeypatch.setattr(billing_service, "stripe", _FakeStripe)

    await billing_service._handle_checkout_completed(
        {"customer": "cus_1", "subscription": "sub_1"},
        db,
    )

    assert sub.tier == "individual"
    assert sub.stripe_subscription_id == "sub_1"
    assert sub.current_period_start == datetime.fromtimestamp(1_700_000_000, tz=timezone.utc)
    assert sub.current_period_end == datetime.fromtimestamp(1_702_592_000, tz=timezone.utc)
    db.flush.assert_awaited()
