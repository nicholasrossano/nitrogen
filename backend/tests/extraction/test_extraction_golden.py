"""Golden tests for variable extraction (deterministic recorded LLM path)."""

from __future__ import annotations

import pytest

from tests.extraction.helpers import (
    discover_fixtures,
    load_fixture,
    match_assumptions,
    run_recorded_extraction,
)


EXTRACTION_FIXTURES = [
    path for path in discover_fixtures() if load_fixture(path).get("source_type") == "authored_labeled"
]


@pytest.mark.parametrize("fixture_path", EXTRACTION_FIXTURES, ids=lambda p: p.stem)
def test_extraction_golden(fixture_path):
    fixture = load_fixture(fixture_path)
    predicted = run_recorded_extraction(fixture)
    expected = fixture["expect"].get("variables") or []
    precision, recall, unmatched = match_assumptions(predicted, expected)

    assert unmatched == [], f"{fixture['id']}: unmatched expected variables: {unmatched}"
    assert precision >= 0.99, f"{fixture['id']}: precision {precision:.3f} (false positives)"
    assert recall >= 0.99, f"{fixture['id']}: recall {recall:.3f}"

    rejected = fixture["expect"].get("rejected") or []
    predicted_labels = {str(p.get("label") or "").lower() for p in predicted}
    for label in rejected:
        assert label.lower() not in predicted_labels, f"{fixture['id']}: rejected '{label}' was kept"


def test_emit_all_tanks_precision_emit_nothing_tanks_recall():
    fixture = load_fixture(next(p for p in EXTRACTION_FIXTURES if p.stem == "feasibility_memo_solar_kenya"))
    expected = fixture["expect"]["variables"]
    predicted_like = [
        {
            "label": e["label"],
            "key": e.get("key"),
            "value": e.get("value"),
            "source_quote": e.get("quote_contains") or e["label"],
        }
        for e in expected
    ]

    emit_all = predicted_like + [{"label": "Noise", "value": "x", "source_quote": "noise"}]
    precision, recall, _ = match_assumptions(emit_all, expected)
    assert precision < 1.0
    assert recall == 1.0

    precision, recall, _ = match_assumptions([], expected)
    assert recall == 0.0
    assert precision == 1.0


def test_config_gating_sensitivity_open_vocab_would_fail():
    """If we re-enabled config-only gating, open-vocab NPV would disappear."""
    from app.variables.config import VARIABLE_BY_KEY

    fixture = load_fixture(next(p for p in EXTRACTION_FIXTURES if p.stem == "feasibility_memo_solar_kenya"))
    predicted = run_recorded_extraction(fixture)
    open_vocab = [p for p in predicted if p["key"] == "comparable_project_npv"]
    assert open_vocab, "open-vocab comparable NPV should survive post-gate path"

    gated = [p for p in predicted if p["key"] in VARIABLE_BY_KEY]
    assert all(p["key"] != "comparable_project_npv" or p["key"] in VARIABLE_BY_KEY for p in gated)
    # Config gate would drop comparable_project_npv
    assert "comparable_project_npv" not in VARIABLE_BY_KEY
