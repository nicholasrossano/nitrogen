"""Assessment retrieval must attribute usage to a real user, never 'system'."""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.assessments.retrieval import retrieve_evidence


@pytest.mark.asyncio
async def test_retrieve_evidence_passes_real_user_id_to_execution_context():
    project_id = uuid4()
    db = AsyncMock()
    adapter = MagicMock()
    adapter.execute = AsyncMock(return_value=MagicMock(output={"facts": []}))
    registry = MagicMock()
    registry.get.return_value = adapter

    captured = {}

    class FakeCtx:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    with (
        patch("app.adapters.get_adapter_registry", return_value=registry),
        patch("app.core.execution_context.ExecutionContext", FakeCtx),
        patch("app.services.variables.suggest_variable_candidates", return_value=[]),
    ):
        await retrieve_evidence(
            ["solar risk kenya"],
            db,
            project_id,
            user_id="real-user-uid",
        )

    assert captured["user_id"] == "real-user-uid"
    adapter.execute.assert_awaited()


@pytest.mark.asyncio
async def test_retrieve_evidence_never_uses_system_user_id():
    project_id = uuid4()
    db = AsyncMock()
    adapter = MagicMock()
    adapter.execute = AsyncMock(return_value=MagicMock(output={"facts": []}))
    registry = MagicMock()
    registry.get.return_value = adapter

    captured = {}

    class FakeCtx:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    with (
        patch("app.adapters.get_adapter_registry", return_value=registry),
        patch("app.core.execution_context.ExecutionContext", FakeCtx),
        patch("app.services.variables.suggest_variable_candidates", return_value=[]),
    ):
        await retrieve_evidence(
            ["solar risk kenya"],
            db,
            project_id,
            user_id="system",
        )

    assert captured["user_id"] == ""
    assert captured["user_id"] != "system"


@pytest.mark.asyncio
async def test_retrieve_evidence_noop_without_db_or_project():
    context_str, citations = await retrieve_evidence(["q"], None, None)
    assert context_str == ""
    assert citations == []
