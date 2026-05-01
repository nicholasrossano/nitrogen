from types import SimpleNamespace

from app.assumptions.config import expected_assumptions_for_assessments
from app.services.assumptions import (
    _assessment_ids_from_initiative,
    apply_assumptions_to_items,
    format_assumptions_for_prompt,
    normalize_missing_value,
    normalize_assumption_status,
)


def test_expected_assumptions_include_common_and_assessment_required_keys():
    definitions = expected_assumptions_for_assessments(["lcoe_model"])
    keys = {definition.key for definition in definitions}

    assert "project_location" in keys
    assert "total_capex" in keys
    assert "annual_opex" in keys


def test_apply_assumptions_to_items_prefills_matching_assessment_input():
    items = [
        {
            "id": "item-1",
            "content": {
                "field_name": "total_capex",
                "variable": "Total CAPEX",
                "value": None,
                "unit": "",
                "status": "missing",
            },
        }
    ]
    assumptions = [
        {
            "id": "assumption-1",
            "key": "total_capex",
            "label": "Total CAPEX",
            "value": 180000,
            "unit": "USD",
            "status": "validated",
            "used_in_assessments": ["lcoe_model"],
            "source_reference": {"source_type": "material"},
        }
    ]

    result = apply_assumptions_to_items(items, assumptions, assessment_id="lcoe_model")

    content = result[0]["content"]
    assert content["value"] == 180000
    assert content["unit"] == "USD"
    assert content["status"] == "validated"
    assert content["source"] == "assumption"
    assert content["assumption_id"] == "assumption-1"


def test_apply_assumptions_to_items_uses_configured_assessment_field_aliases():
    items = [
        {
            "id": "item-1",
            "content": {
                "field_name": "net_capacity_kw",
                "variable": "Net capacity",
                "value": None,
                "unit": "",
                "status": "missing",
            },
        }
    ]
    assumptions = [
        {
            "id": "assumption-1",
            "key": "system_size_kw",
            "label": "System size",
            "value": 50,
            "unit": "kW",
            "status": "validated",
            "used_in_assessments": ["lcoe_model"],
            "source_reference": None,
        }
    ]

    result = apply_assumptions_to_items(items, assumptions, assessment_id="lcoe_model")

    assert result[0]["content"]["value"] == 50
    assert result[0]["content"]["source"] == "assumption"


def test_format_assumptions_for_prompt_buckets_statuses():
    assumptions = [
        SimpleNamespace(
            status="validated",
            label="System size",
            value=50,
            unit="kW",
            used_in_assessments=["solar_estimate"],
        ),
        SimpleNamespace(
            status="missing",
            label="Total CAPEX",
            value=None,
            unit="USD",
            used_in_assessments=["lcoe_model"],
        ),
        SimpleNamespace(
            status="rejected",
            label="Rejected",
            value="ignore",
            unit=None,
            used_in_assessments=[],
        ),
        SimpleNamespace(
            status="needs_review",
            label="Fuel savings",
            value=0.2,
            unit="%",
            used_in_assessments=["carbon"],
        ),
    ]

    formatted = format_assumptions_for_prompt(assumptions)

    assert "Validated:" in formatted
    assert "System size: 50 kW" in formatted
    assert "Missing:" in formatted
    assert "Total CAPEX: missing USD" in formatted
    assert "Extracted:" in formatted
    assert "Fuel savings: 0.2 %" in formatted
    assert "Rejected" not in formatted


def test_normalize_assumption_status_maps_legacy_values():
    assert normalize_assumption_status("validated") == "validated"
    assert normalize_assumption_status("needs_review") == "extracted"
    assert normalize_assumption_status("assumed") == "assumed"


def test_assessment_ids_from_initiative_uses_active_instances_only():
    initiative = SimpleNamespace(
        selected_tools=["lcoe_model", "carbon_model"],
        assessment_instances=[
            SimpleNamespace(assessment_id="carbon_model", archived=False),
            SimpleNamespace(assessment_id="solar_estimate", archived=True),
        ],
    )

    assert _assessment_ids_from_initiative(initiative) == ["carbon_model"]


def test_normalize_missing_value_coerces_placeholder_tokens():
    assert normalize_missing_value("—") is None
    assert normalize_missing_value(" unknown years ") is None
    assert normalize_missing_value("N/A") is None
    assert normalize_missing_value("Malawi") == "Malawi"
