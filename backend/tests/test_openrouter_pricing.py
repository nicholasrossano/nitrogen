"""OpenRouter pricing cache: parse, lookup, TTL refresh, static fallback."""

from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core import openrouter_pricing as orp
from app.core.llm_client import estimate_cost


@pytest.fixture(autouse=True)
def _clear_cache():
    orp.clear_pricing_cache()
    yield
    orp.clear_pricing_cache()


def test_parse_models_converts_per_token_to_per_million():
    # $2.50 / 1M input = 0.0000025 per token
    indexed = orp._parse_models_payload(
        {
            "data": [
                {
                    "id": "openai/gpt-4o",
                    "pricing": {"prompt": "0.0000025", "completion": "0.00001"},
                }
            ]
        }
    )
    assert indexed["openai/gpt-4o"] == {"input": 2.5, "output": 10.0}
    assert indexed["gpt-4o"] == {"input": 2.5, "output": 10.0}


def test_lookup_resolves_short_and_prefixed_ids():
    orp._pricing_by_key = {
        "openai/gpt-4o-mini": {"input": 0.15, "output": 0.6},
        "gpt-4o-mini": {"input": 0.15, "output": 0.6},
    }
    orp._fetched_at = 1.0
    assert orp.lookup_openrouter_pricing("gpt-4o-mini")["input"] == 0.15
    assert orp.lookup_openrouter_pricing("openai/gpt-4o-mini")["input"] == 0.15
    assert orp.lookup_openrouter_pricing("openrouter/openai/gpt-4o-mini")["input"] == 0.15
    assert orp.lookup_openrouter_pricing("unknown-model") is None


def test_estimate_cost_prefers_live_cache_over_static():
    orp._pricing_by_key = {"gpt-4o": {"input": 9.0, "output": 0.0}}
    orp._fetched_at = 1.0
    # 1M input tokens @ $9/1M
    assert estimate_cost("gpt-4o", 1_000_000, 0) == Decimal("9.0")


def test_estimate_cost_falls_back_to_static_when_cache_cold():
    assert estimate_cost("gpt-4o-mini", 1_000_000, 0) == Decimal("0.15")


@pytest.mark.asyncio
async def test_refresh_openrouter_pricing_success(monkeypatch):
    payload = {
        "data": [
            {
                "id": "openai/gpt-4.1",
                "pricing": {"prompt": "0.000002", "completion": "0.000008"},
            }
        ]
    }
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json = MagicMock(return_value=payload)
    client = MagicMock()
    client.get = AsyncMock(return_value=resp)
    monkeypatch.setattr(orp, "get_http_client", lambda: client)
    monkeypatch.setattr(
        "app.core.openrouter_pricing.get_settings",
        lambda: MagicMock(
            openrouter_base_url="https://openrouter.ai/api/v1",
            openrouter_api_key="sk-test",
            openrouter_pricing_ttl_seconds=3600,
        ),
    )

    ok = await orp.refresh_openrouter_pricing(force=True)
    assert ok is True
    assert orp.lookup_openrouter_pricing("gpt-4.1") == {"input": 2.0, "output": 8.0}
    client.get.assert_awaited_once()
    headers = client.get.await_args.kwargs.get("headers") or {}
    assert headers.get("Authorization") == "Bearer sk-test"


@pytest.mark.asyncio
async def test_refresh_keeps_cache_on_failure(monkeypatch):
    orp._pricing_by_key = {"gpt-4o": {"input": 2.5, "output": 10.0}}
    orp._fetched_at = 1.0

    client = MagicMock()
    client.get = AsyncMock(side_effect=RuntimeError("network down"))
    monkeypatch.setattr(orp, "get_http_client", lambda: client)
    monkeypatch.setattr(
        "app.core.openrouter_pricing.get_settings",
        lambda: MagicMock(
            openrouter_base_url="https://openrouter.ai/api/v1",
            openrouter_api_key="",
            openrouter_pricing_ttl_seconds=0,  # force stale
        ),
    )

    ok = await orp.refresh_openrouter_pricing(force=True)
    assert ok is False
    assert orp.lookup_openrouter_pricing("gpt-4o")["input"] == 2.5
