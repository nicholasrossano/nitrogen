"""Fixtures for calculator golden tests."""

import pytest

from app.core.execution_context import ExecutionContext


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "validation: methodology-backed golden validation fixtures")
    config.addinivalue_line("markers", "regression_snapshot: engine-output snapshot fixtures")


def golden_ctx() -> ExecutionContext:
    return ExecutionContext(
        user_id="test-user",
        user_email="test@example.com",
        project_id=None,
        initiative_role=None,
        ai_access_granted=True,
        is_byok=False,
        request_id="golden-fixture-test",
    )
