"""Golden validation tests for Carbon calculator fixtures."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.adapters import get_adapter_registry
from tests.calculators.conftest import golden_ctx
from tests.calculators.helpers import assert_golden, discover_fixtures, load_fixture

CARBON_ADAPTER = get_adapter_registry().get("carbon")
assert CARBON_ADAPTER is not None


@pytest.mark.asyncio
@pytest.mark.validation
@pytest.mark.parametrize(
    "fixture_path",
    discover_fixtures("carbon"),
    ids=lambda path: path.stem,
)
async def test_carbon_golden_validation(fixture_path: Path) -> None:
    fixture = load_fixture(fixture_path)
    assert fixture["assessment_id"] == "carbon_model"
    assert fixture["source_type"] != "regression_snapshot"

    result = await CARBON_ADAPTER.execute(golden_ctx(), None, fixture["adapter_input"])
    assert_golden(result.output, fixture["expect"], fixture_id=fixture["id"])

    if expect_warnings := fixture["expect"].get("adapter_warnings_contains"):
        for fragment in expect_warnings:
            assert any(fragment in warning for warning in result.warnings), (
                f"{fixture['id']}: expected adapter warning containing {fragment!r}, got {result.warnings}"
            )
