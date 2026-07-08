import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api import chat as chat_api


@pytest.mark.asyncio
async def test_load_active_editor_assessment_context_includes_lcoe_result():
    instance_id = uuid.uuid4()
    project_id = uuid.uuid4()
    inst = SimpleNamespace(
        id=instance_id,
        project_id=project_id,
        assessment_id="lcoe_model",
        title="LCOE Model #1",
        status="confirmed",
        workflow_state={
            "stages": {
                "results": {
                    "status": "confirmed",
                    "data": {
                        "widget_data": {
                            "computable": True,
                            "inputs": {
                                "capacity_factor": {
                                    "label": "Capacity Factor",
                                    "value": 0.35,
                                    "status": "validated",
                                    "unit": "%",
                                },
                            },
                            "result": {
                                "lcoe": 0.1151,
                                "currency": "USD",
                            },
                        },
                    },
                },
            },
        },
    )

    db = AsyncMock()
    db.get = AsyncMock(return_value=inst)

    with patch("app.core.permissions.require_project_viewer", new=AsyncMock()):
        context = await chat_api._load_active_editor_assessment_context(
            db,
            MagicMock(),
            str(instance_id),
        )

    assert context is not None
    assert "LCOE Model #1" in context
    assert "0.1151" in context
    assert "Capacity Factor" in context


@pytest.mark.asyncio
async def test_load_active_editor_assessment_context_returns_none_for_missing_instance():
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    context = await chat_api._load_active_editor_assessment_context(
        db,
        MagicMock(),
        str(uuid.uuid4()),
    )
    assert context is None
