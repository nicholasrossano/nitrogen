"""usage_records must never be written for synthetic system user ids."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core import llm_client


@pytest.mark.asyncio
async def test_record_usage_skips_system_user_ids(monkeypatch):
    db = AsyncMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.execute = AsyncMock()

    monkeypatch.setattr(
        llm_client,
        "settings",
        SimpleNamespace(billing_enabled=True),
    )

    ensure = AsyncMock()
    monkeypatch.setattr("app.core.openrouter_pricing.ensure_pricing_fresh", ensure)

    for bad_id in ("system", "system:auto", "", "  system  "):
        await llm_client.record_usage(bad_id, "gpt-4o", 10, 5, db)
        db.add.assert_not_called()
        db.flush.assert_not_called()
        ensure.assert_not_called()


@pytest.mark.asyncio
async def test_record_usage_records_real_user(monkeypatch):
    db = AsyncMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=result)

    monkeypatch.setattr(
        llm_client,
        "settings",
        SimpleNamespace(billing_enabled=True),
    )
    monkeypatch.setattr(
        "app.core.openrouter_pricing.ensure_pricing_fresh",
        AsyncMock(),
    )
    monkeypatch.setattr(llm_client, "estimate_cost", lambda *a, **k: 0.01)

    await llm_client.record_usage("firebase-uid-abc", "gpt-4o", 10, 5, db)

    db.add.assert_called_once()
    record = db.add.call_args[0][0]
    assert record.user_id == "firebase-uid-abc"
    db.flush.assert_awaited_once()
