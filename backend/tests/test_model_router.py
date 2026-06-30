"""Tests for model routing and cost attribution."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.model_catalog import Complexity, ModelRole, get_model_spec
from app.core.model_router import resolve


def test_catalog_openai_orchestration_heavy():
    spec = get_model_spec("openai", ModelRole.ORCHESTRATION, Complexity.HEAVY)
    assert spec.litellm_model == "gpt-4.1"
    assert spec.supports_web_search is True


def test_catalog_openrouter_embedding():
    spec = get_model_spec("openrouter", ModelRole.EMBEDDING, Complexity.STANDARD)
    assert "embedding" in spec.litellm_model


@pytest.mark.asyncio
async def test_resolve_platform_openrouter_when_routing_enabled(monkeypatch):
    monkeypatch.setattr("app.core.model_router.settings.model_routing_enabled", True)
    monkeypatch.setattr("app.core.model_router.settings.openrouter_api_key", "sk-or-platform")
    monkeypatch.setattr(
        "app.core.model_router.settings.openrouter_base_url",
        "https://openrouter.ai/api/v1",
    )

    target = await resolve(None, None, ModelRole.GENERATION, Complexity.STANDARD)
    assert target.is_byok is False
    assert target.provider_route == "openrouter"
    assert target.api_key == "sk-or-platform"


@pytest.mark.asyncio
async def test_resolve_byok_openai(monkeypatch):
    monkeypatch.setattr("app.core.model_router.settings.api_key_encryption_key", "test")
    monkeypatch.setattr(
        "app.core.model_router._load_byok_key",
        AsyncMock(return_value="sk-user"),
    )

    db = AsyncMock()
    target = await resolve("user-1", db, ModelRole.EMBEDDING, Complexity.STANDARD)
    assert target.is_byok is True
    assert target.provider_route == "openai"
    assert target.api_key == "sk-user"
