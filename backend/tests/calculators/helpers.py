"""Shared helpers for calculator golden fixture tests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

FIXTURES_ROOT = Path(__file__).resolve().parent.parent / "fixtures" / "calculators"

VALID_SOURCE_TYPES = frozenset(
    {
        "validated_independent",
        "validated_internal_methodology",
        "verified_spreadsheet",
        "methodology_worksheet",
        "recorded_external_reference",
        "synthetic_external_format_snapshot",
        "regression_snapshot",
    }
)

PVWATTS_SNAPSHOT_SOURCE_TYPES = frozenset(
    {"recorded_external_reference", "synthetic_external_format_snapshot"}
)

VALIDATION_SOURCE_TYPES = VALID_SOURCE_TYPES - {"regression_snapshot"}


def discover_fixtures(subdir: str) -> list[Path]:
    """Validation fixtures under fixtures/calculators/{subdir}/."""
    directory = FIXTURES_ROOT / subdir
    if not directory.is_dir():
        return []
    return sorted(directory.glob("*.json"))


def discover_regression_fixtures(subdir: str) -> list[Path]:
    """Regression snapshot fixtures under fixtures/calculators/regression/{subdir}/."""
    directory = FIXTURES_ROOT / "regression" / subdir
    if not directory.is_dir():
        return []
    return sorted(directory.glob("*.json"))


def load_fixture(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text())
    for key in ("id", "assessment_id", "description", "source", "source_type", "adapter_input", "expect"):
        if key not in data:
            raise ValueError(f"{path.name}: missing required key '{key}'")
    if data["source_type"] not in VALID_SOURCE_TYPES:
        raise ValueError(f"{path.name}: invalid source_type '{data['source_type']}'")
    if (
        data["assessment_id"] == "lcoe_model"
        and data["source_type"] in VALIDATION_SOURCE_TYPES
        and "methodology_notes" not in data
    ):
        raise ValueError(f"{path.name}: LCOE validation fixture requires methodology_notes")
    if data["source_type"] == "regression_snapshot" and "regression" not in path.parts:
        raise ValueError(f"{path.name}: regression_snapshot fixtures must live under regression/")
    if data["source_type"] in PVWATTS_SNAPSHOT_SOURCE_TYPES and "recorded_response" not in data:
        raise ValueError(f"{path.name}: {data['source_type']} fixture requires recorded_response")
    return data


def assert_scalar(actual: Any, spec: dict[str, Any], *, field: str, fixture_id: str) -> None:
    expected = float(spec["value"])
    tolerance = float(spec["abs_tolerance"])
    assert abs(float(actual) - expected) <= tolerance, (
        f"{fixture_id}.{field}: expected {expected} ± {tolerance}, got {actual}"
    )


def assert_array(actual: Any, spec: dict[str, Any], *, field: str, fixture_id: str) -> None:
    expected = spec["values"]
    tolerance = float(spec["abs_tolerance"])
    actual_list = list(actual)
    assert len(actual_list) == len(expected), (
        f"{fixture_id}.{field}: expected length {len(expected)}, got {len(actual_list)}"
    )
    for idx, (got, want) in enumerate(zip(actual_list, expected, strict=True)):
        if abs(float(got) - float(want)) > tolerance:
            raise AssertionError(
                f"{fixture_id}.{field}[{idx}]: expected {want} ± {tolerance}, got {got}"
            )


def assert_metric(actual: Any, spec: dict[str, Any], *, field: str, fixture_id: str) -> None:
    expected = float(spec["value"])
    pct = float(spec["pct_tolerance"])
    if pct >= 0.01 and not spec.get("tolerance_exception"):
        raise ValueError(f"{fixture_id}.{field}: pct_tolerance >= 0.01 requires tolerance_exception")
    actual_f = float(actual)
    if expected == 0:
        assert actual_f == 0, f"{fixture_id}.{field}: expected 0, got {actual_f}"
        return
    rel_err = abs(actual_f - expected) / abs(expected)
    assert rel_err <= pct, (
        f"{fixture_id}.{field}: expected {expected} ± {pct * 100:.4f}%, got {actual_f} (rel_err={rel_err})"
    )


def assert_golden(output: dict[str, Any], expect: dict[str, Any], *, fixture_id: str) -> None:
    assert output["computable"] == expect["computable"], (
        f"{fixture_id}: computable expected {expect['computable']}, got {output['computable']}"
    )

    if "missing_essentials" in expect:
        assert output.get("missing_essentials") == expect["missing_essentials"]

    if expect.get("warnings_contains"):
        warnings = output.get("warnings") or []
        for fragment in expect["warnings_contains"]:
            assert any(fragment in w for w in warnings), (
                f"{fixture_id}: expected warning containing {fragment!r}, got {warnings}"
            )

    if not expect["computable"]:
        return

    result = output["result"]
    expected_result = expect["result"]

    for field, spec in expected_result.items():
        if field == "period":
            assert result.get(field) == spec, f"{fixture_id}.period: expected {spec!r}, got {result.get(field)!r}"
            continue
        if not isinstance(spec, dict):
            continue
        actual = result.get(field)
        assert actual is not None, f"{fixture_id}.{field}: missing in adapter result"
        if "values" in spec:
            assert_array(actual, spec, field=field, fixture_id=fixture_id)
        elif "abs_tolerance" in spec:
            assert_scalar(actual, spec, field=field, fixture_id=fixture_id)
        elif "pct_tolerance" in spec:
            assert_metric(actual, spec, field=field, fixture_id=fixture_id)
        else:
            raise ValueError(f"{fixture_id}.{field}: metric spec requires abs_tolerance or pct_tolerance")
