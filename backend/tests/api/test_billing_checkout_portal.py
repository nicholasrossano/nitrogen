"""Billing checkout confirm + portal misconfig regressions."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
import stripe

from app.api import billing as billing_api
from app.services import billing as billing_service


@pytest.mark.asyncio
async def test_fulfill_checkout_session_applies_subscription(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(billing_service.settings, "stripe_secret_key", "sk_test")
    monkeypatch.setattr(billing_service.settings, "stripe_price_id", "price_ind")

    sub = MagicMock()
    sub.stripe_customer_id = None
    sub.stripe_subscription_id = None
    sub.tier = "trial"
    sub.status = "active"
    sub.current_period_start = None
    sub.current_period_end = None

    async def fake_ensure(user_id, db):
        return sub

    async def fake_budget(user_id, db):
        return {"allowed": True, "tier": "individual", "used_usd": 0, "limit_usd": 50}

    monkeypatch.setattr(billing_service, "ensure_subscription", fake_ensure)
    monkeypatch.setattr(billing_service, "check_usage_budget", fake_budget)

    stripe_sub = {
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

    class _FakeStripe:
        class checkout:
            class Session:
                @staticmethod
                def retrieve(_sid, expand=None):
                    return {
                        "metadata": {"user_id": "user-1"},
                        "client_reference_id": "user-1",
                        "customer": "cus_1",
                        "subscription": stripe_sub,
                    }

    monkeypatch.setattr(billing_service, "stripe", _FakeStripe)

    status = await billing_service.fulfill_checkout_session(
        "user-1",
        "cs_test_123",
        AsyncMock(),
    )

    assert status["tier"] == "individual"
    assert sub.stripe_customer_id == "cus_1"
    assert sub.stripe_subscription_id == "sub_live"
    assert sub.tier == "individual"
    assert sub.current_period_start == datetime.fromtimestamp(1_700_000_000, tz=timezone.utc)


@pytest.mark.asyncio
async def test_portal_surfaces_misconfigured_stripe_key(
    api_client,
    override_db,
    auth_user_override,
    monkeypatch: pytest.MonkeyPatch,
):
    override_db()
    auth_user_override()
    monkeypatch.setattr(billing_api, "settings", MagicMock(billing_enabled=True))

    async def boom(**_kwargs):
        raise stripe.AuthenticationError("Invalid API Key")

    monkeypatch.setattr(billing_api, "create_portal_session", boom)
    monkeypatch.setattr(
        billing_api,
        "validate_billing_redirect_url",
        lambda url: url,
    )

    response = await api_client.post(
        "/api/v1/billing/portal",
        json={"return_url": "http://localhost:3000/chat"},
    )

    assert response.status_code == 503
    assert "misconfigured" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_confirm_checkout_rejects_non_cs_session_id(
    api_client,
    override_db,
    auth_user_override,
    monkeypatch: pytest.MonkeyPatch,
):
    override_db()
    auth_user_override()
    monkeypatch.setattr(billing_api, "settings", MagicMock(billing_enabled=True))

    response = await api_client.post(
        "/api/v1/billing/confirm-checkout",
        json={"session_id": "not-a-checkout-session"},
    )

    assert response.status_code == 400
    assert "Invalid checkout session id" in response.json()["detail"]
