"""Billing: usage budget, BYOK providers, and Stripe tier mapping."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.llm_client import (
    BYOK_SUPPORTED_PROVIDERS,
    check_usage_budget,
    user_has_byok,
)
from app.services.billing import _tier_from_stripe_price


def test_byok_supported_providers():
    assert BYOK_SUPPORTED_PROVIDERS == frozenset({"openai", "openrouter"})


def test_tier_from_stripe_price_individual(monkeypatch):
    monkeypatch.setattr("app.services.billing.settings.stripe_price_id", "price_ind")
    monkeypatch.setattr("app.services.billing.settings.stripe_starter_price_id", "price_st")
    monkeypatch.setattr("app.services.billing.settings.stripe_pro_price_id", "price_pro")

    assert _tier_from_stripe_price("price_ind") == "individual"
    assert _tier_from_stripe_price("price_st") == "starter"
    assert _tier_from_stripe_price("price_pro") == "pro"
    assert _tier_from_stripe_price("unknown") is None


@pytest.mark.asyncio
async def test_check_usage_budget_byok_openrouter(monkeypatch):
    monkeypatch.setattr("app.core.llm_client.settings.stripe_secret_key", "sk_test")

    db = AsyncMock()
    byok_result = MagicMock()
    byok_result.scalar_one_or_none.return_value = "key-id"
    providers_result = MagicMock()
    providers_result.scalars.return_value.all.return_value = ["openrouter"]

    db.execute = AsyncMock(side_effect=[byok_result, providers_result])

    budget = await check_usage_budget("user-1", db)
    assert budget["allowed"] is True
    assert budget["tier"] == "byok"
    assert budget["byok_providers"] == ["openrouter"]


@pytest.mark.asyncio
async def test_check_usage_budget_individual_over_cap(monkeypatch):
    monkeypatch.setattr("app.core.llm_client.settings.stripe_secret_key", "sk_test")
    monkeypatch.setattr("app.core.llm_client.settings.subscription_usage_limit_usd", 10.0)

    sub = MagicMock()
    sub.tier = "individual"
    sub.status = "active"
    sub.current_period_start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    sub.current_period_end = datetime(2026, 2, 1, tzinfo=timezone.utc)
    sub.access_code_redeemed = False

    db = AsyncMock()
    byok_miss = MagicMock()
    byok_miss.scalar_one_or_none.return_value = None
    sub_result = MagicMock()
    sub_result.scalar_one_or_none.return_value = sub
    usage_result = MagicMock()
    usage_result.scalar.return_value = 12.5

    db.execute = AsyncMock(side_effect=[byok_miss, sub_result, usage_result])

    budget = await check_usage_budget("user-2", db)
    assert budget["allowed"] is False
    assert budget["tier"] == "individual"
    assert budget["used_usd"] == 12.5
    assert budget["limit_usd"] == 10.0


@pytest.mark.asyncio
async def test_user_has_byok_filters_providers():
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = "exists"
    db.execute = AsyncMock(return_value=result)

    assert await user_has_byok("user-3", db) is True
    assert db.execute.await_count == 1


@pytest.mark.asyncio
async def test_llm_json_records_usage(monkeypatch):
    from app.assessments.utils import llm_json

    acompletion_json_mock = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr("app.core.llm_invoke.acompletion_json", acompletion_json_mock)

    db = AsyncMock()
    result = await llm_json("sys", "user", user_id="u1", db=db)
    assert result == {"ok": True}
    acompletion_json_mock.assert_awaited_once()
