"""Golden regression snapshot tests for LCOE calculator fixtures."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.adapters import get_adapter_registry
from tests.calculators.conftest import golden_ctx
from tests.calculators.helpers import assert_golden, discover_regression_fixtures, load_fixture

LCOE_ADAPTER = get_adapter_registry().get("lcoe")
assert LCOE_ADAPTER is not None

REGRESSION_FIXTURES = discover_regression_fixtures("lcoe")


@pytest.mark.asyncio
@pytest.mark.regression_snapshot
@pytest.mark.parametrize(
    "fixture_path",
    REGRESSION_FIXTURES,
    ids=lambda path: path.stem,
)
async def test_lcoe_golden_regression(fixture_path: Path) -> None:
    fixture = load_fixture(fixture_path)
    assert fixture["assessment_id"] == "lcoe_model"
    assert fixture["source_type"] == "regression_snapshot"

    result = await LCOE_ADAPTER.execute(golden_ctx(), None, fixture["adapter_input"])
    assert_golden(result.output, fixture["expect"], fixture_id=fixture["id"])
