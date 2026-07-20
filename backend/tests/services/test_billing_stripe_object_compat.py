"""Regression coverage for stripe-python StripeObject/.get() incompatibility.

Recent stripe-python versions stopped subclassing dict, so `.get()` is no
longer a real method on `StripeObject` / `ListObject` — plain-dict test
fixtures elsewhere in this suite don't exercise that path and previously
masked a live 500 on GET /api/v1/billing/status (AttributeError: get) that
fired whenever `reconcile_subscription_from_stripe` inspected a real Stripe
API response object instead of a dict.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from stripe._stripe_object import StripeObject

from app.services import billing as billing_service


def _stripe_object(data: dict) -> StripeObject:
    """Build a real StripeObject the same way the SDK does for API responses."""
    return StripeObject.construct_from(data, "sk_test")


def test_sget_reads_dict_and_stripe_object_the_same_way():
    plain = {"status": "active"}
    boxed = _stripe_object({"status": "active"})

    assert billing_service._sget(plain, "status") == "active"
    assert billing_service._sget(boxed, "status") == "active"
    assert billing_service._sget(boxed, "missing_key") is None
    assert billing_service._sget(boxed, "missing_key", "fallback") == "fallback"


def test_stripe_object_get_raises_like_the_live_bug():
    """Sanity check that the underlying SDK behavior we're guarding against is real."""
    boxed = _stripe_object({"status": "active"})
    with pytest.raises(AttributeError):
        boxed.get("status")


@pytest.mark.asyncio
async def test_reconcile_subscription_from_stripe_handles_real_stripe_objects(monkeypatch):
    """The exact codepath that crashed /billing/status: stripe.Subscription.list()
    returns a ListObject of Subscription StripeObjects, not dicts."""
    sub = MagicMock()
    sub.stripe_customer_id = "cus_1"
    sub.stripe_subscription_id = None
    sub.tier = "trial"
    sub.status = "canceled"

    result = MagicMock()
    result.scalar_one_or_none.return_value = sub
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    db.flush = AsyncMock()

    active_sub = _stripe_object(
        {
            "id": "sub_live",
            "status": "active",
            "items": {
                "data": [
                    {
                        "current_period_start": 1_700_000_000,
                        "current_period_end": 1_702_592_000,
                        "price": {"id": "price_ind", "metadata": {"app_tier": "individual"}},
                    }
                ]
            },
        }
    )
    listing = _stripe_object({"data": [active_sub]})

    class _FakeStripe:
        class Subscription:
            @staticmethod
            def list(**_kwargs):
                return listing

    monkeypatch.setattr(billing_service, "stripe", _FakeStripe)
    monkeypatch.setattr(billing_service.settings, "stripe_secret_key", "sk_test")
    monkeypatch.setattr(billing_service.settings, "stripe_price_id", "price_ind")

    applied = await billing_service.reconcile_subscription_from_stripe("user-1", db)

    assert applied is True
    assert sub.tier == "individual"
    assert sub.stripe_subscription_id == "sub_live"


@pytest.mark.asyncio
async def test_fulfill_checkout_session_handles_real_stripe_objects(monkeypatch):
    """The exact codepath that ran right after a live Stripe Checkout redirect."""
    sub = MagicMock()
    sub.stripe_customer_id = None
    sub.tier = "trial"
    sub.status = "trial"

    result = MagicMock()
    result.scalar_one_or_none.return_value = sub
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    db.flush = AsyncMock()

    subscription_obj = _stripe_object(
        {
            "id": "sub_live",
            "status": "active",
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
    )
    checkout_session = _stripe_object(
        {
            "metadata": {"user_id": "user-1"},
            "client_reference_id": "user-1",
            "customer": "cus_1",
            "subscription": subscription_obj,
        }
    )

    class _FakeStripe:
        class checkout:
            class Session:
                @staticmethod
                def retrieve(_session_id, expand=None):
                    return checkout_session

    monkeypatch.setattr(billing_service, "stripe", _FakeStripe)
    monkeypatch.setattr(billing_service.settings, "stripe_price_id", "price_ind")
    monkeypatch.setattr(billing_service.settings, "stripe_secret_key", "sk_test")
    monkeypatch.setattr(
        billing_service,
        "check_usage_budget",
        AsyncMock(return_value={"tier": "individual"}),
    )

    result = await billing_service.fulfill_checkout_session("user-1", "cs_live_1", db)

    assert result == {"tier": "individual"}
    assert sub.stripe_customer_id == "cus_1"
    assert sub.tier == "individual"


@pytest.mark.asyncio
async def test_webhook_handlers_accept_real_stripe_objects(monkeypatch):
    """Stripe webhook payloads (event["data"]["object"]) are StripeObjects too,
    despite the historical `data: dict` type hints on these handlers."""
    sub = MagicMock()
    sub.stripe_customer_id = "cus_1"
    sub.tier = "trial"
    sub.status = "trial"

    result = MagicMock()
    result.scalar_one_or_none.return_value = sub
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    db.flush = AsyncMock()

    monkeypatch.setattr(billing_service.settings, "stripe_price_id", "price_ind")

    subscription_updated = _stripe_object(
        {
            "id": "sub_live",
            "status": "active",
            "customer": "cus_1",
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
    )

    await billing_service._handle_subscription_updated(subscription_updated, db)

    assert sub.tier == "individual"
    assert sub.stripe_subscription_id == "sub_live"
    db.flush.assert_awaited()
