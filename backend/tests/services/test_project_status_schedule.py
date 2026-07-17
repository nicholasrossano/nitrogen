"""Unit tests for debounced project-status refresh scheduling."""

from __future__ import annotations

import asyncio
import uuid
from unittest.mock import AsyncMock, patch

import pytest

from app.services import project_status


@pytest.mark.asyncio
async def test_schedule_project_status_refresh_debounces_bursts():
    project_id = uuid.uuid4()
    run_mock = AsyncMock()

    project_status._pending_status_refresh_handles.clear()
    project_status._pending_status_refresh_meta.clear()

    with patch.object(project_status, "_run_scheduled_project_status_refresh", run_mock):
        with patch.object(project_status, "_STATUS_REFRESH_DEBOUNCE_SECONDS", 0.05):
            project_status.schedule_project_status_refresh(
                project_id,
                source="evidence_indexed",
                user_id="user-1",
            )
            project_status.schedule_project_status_refresh(
                project_id,
                source="material_upload",
                user_id="user-1",
            )
            await asyncio.sleep(0.12)

    assert run_mock.await_count == 1
    args, kwargs = run_mock.await_args
    assert args[0] == str(project_id)
    assert kwargs["source"] == "material_upload"
    assert kwargs["user_id"] == "user-1"
