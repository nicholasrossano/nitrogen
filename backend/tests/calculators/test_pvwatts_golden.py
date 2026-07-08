"""Golden tests for PVWatts fixtures using NREL v8-format snapshots (no live API in CI)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.adapters import get_adapter_registry
from tests.calculators.conftest import golden_ctx
from tests.calculators.helpers import assert_golden, discover_fixtures, load_fixture

PVWATTS_ADAPTER = get_adapter_registry().get("pvwatts")
assert PVWATTS_ADAPTER is not None

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "calculators" / "pvwatts"


def _load_recorded_response(fixture: dict[str, Any]) -> dict[str, Any]:
    rel = fixture.get("recorded_response")
    if not rel:
        raise ValueError(f"{fixture['id']}: missing recorded_response path")
    path = FIXTURES_DIR / rel
    return json.loads(path.read_text())


def _install_pvwatts_http_mock(recorded: dict[str, Any]) -> MagicMock:
    """Patch httpx.AsyncClient so PVWattsEngine.call_pvwatts gets the recorded payload."""
    response = MagicMock()
    response.status_code = 200
    response.text = ""
    response.json.return_value = recorded
    response.raise_for_status = MagicMock()

    client = AsyncMock()
    client.get = AsyncMock(return_value=response)

    mock_client_cls = MagicMock()
    mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=client)
    mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=None)
    return mock_client_cls


@pytest.mark.asyncio
@pytest.mark.validation
@pytest.mark.parametrize(
    "fixture_path",
    discover_fixtures("pvwatts"),
    ids=lambda path: path.stem,
)
async def test_pvwatts_golden(fixture_path: Path) -> None:
    fixture = load_fixture(fixture_path)
    assert fixture["assessment_id"] == "solar_estimate"
    assert fixture["source_type"] in {
        "synthetic_external_format_snapshot",
        "recorded_external_reference",
    }

    recorded = _load_recorded_response(fixture)
    mock_client_cls = _install_pvwatts_http_mock(recorded)

    with patch("app.domain.energy.services.pvwatts_engine.httpx.AsyncClient", mock_client_cls):
        result = await PVWATTS_ADAPTER.execute(golden_ctx(), None, fixture["adapter_input"])

    assert_golden(result.output, fixture["expect"], fixture_id=fixture["id"])
