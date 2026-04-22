from types import SimpleNamespace

from app.services.lcoe_engine import LCOEEngine
from app.services.chat import ChatService


def _message(widget_type: str, widget_data: dict) -> SimpleNamespace:
    return SimpleNamespace(role="assistant", widget_type=widget_type, widget_data=widget_data)


def test_format_model_inputs_from_messages_includes_active_field_context_and_solar_inputs():
    messages = [
        _message(
            "solar_inputs",
            {
                "inputs": {
                    "tilt": {
                        "value": 25,
                        "status": "assumed",
                        "unit": "deg",
                        "label": "Tilt",
                    },
                },
            },
        ),
    ]

    context = ChatService._format_model_inputs_from_messages(
        messages,
        {
            "field_name": "annual_degradation",
            "label": "Annual Degradation",
            "current_value": 1.0,
            "unit": "%/yr",
            "status": "assumed",
        },
    )

    assert "### Active Investigation" in context
    assert "Annual Degradation (field_name=annual_degradation): 1.0 %/yr [assumed]" in context
    assert "### Solar Model Inputs" in context
    assert "Tilt (field_name=tilt): 25 deg [assumed]" in context


def test_requires_distinct_proposal_detects_alternative_requests():
    assert ChatService._requires_distinct_proposal(
        "Can you research and propose a better value for annual degradation?",
    )
    assert ChatService._requires_distinct_proposal(
        "Can you investigate the value for annual degradation and propose a specific alternative?",
    )
    assert not ChatService._requires_distinct_proposal(
        "Can you validate the current value for annual degradation?",
        {"status": "confirmed"},
    )
    assert ChatService._requires_distinct_proposal(
        "Can you investigate the value for discount rate (WACC)?",
        {"status": "assumed"},
    )


def test_proposal_matches_current_uses_numeric_comparison():
    assert ChatService._proposal_matches_current(
        {"field_name": "tilt", "proposed_value": 20},
        {"field_name": "tilt", "current_value": 20.0},
    )
    assert not ChatService._proposal_matches_current(
        {"field_name": "tilt", "proposed_value": 25},
        {"field_name": "tilt", "current_value": 20.0},
    )


def test_resolve_current_value_reads_from_model_inputs_context_when_missing():
    context = (
        "### Active Investigation\n"
        "- Discount Rate (WACC) (field_name=discount_rate): —  [assumed]\n\n"
        "### LCOE Model Inputs\n"
        "- Discount Rate (WACC) (field_name=discount_rate): 0.08  [assumed]\n"
    )

    resolved = ChatService._resolve_current_value(
        {"field_name": "discount_rate", "current_value": None},
        context,
    )

    assert resolved == 0.08


def test_normalize_proposal_unit_strips_unitless_placeholder():
    assert ChatService._normalize_proposal_unit("unitless") == ""
    assert ChatService._normalize_proposal_unit(" USD/yr ") == "USD/yr"


def test_coordinate_lookup_fields_skip_scholarly_search():
    field_context = {
        "field_name": "lat",
        "label": "Latitude",
    }

    assert ChatService._is_coordinate_lookup_field(field_context)
    assert not ChatService._should_run_scholarly_search(field_context)


def test_fallback_external_search_query_focuses_coordinate_lookup():
    query = ChatService._fallback_external_search_query(
        "Can you investigate and propose a value for Latitude? Just pick a city in Malawi",
        {
            "field_name": "lat",
            "label": "Latitude",
        },
    )

    assert query == "Malawi city latitude"


def test_normalize_external_tool_query_replaces_conversational_prompt():
    fallback_query = "Malawi city latitude"

    query = ChatService._normalize_external_tool_query(
        'Can you investigate and propose a value for Latitude? Just pick a city in Malawi',
        fallback_query,
    )

    assert query == fallback_query


def test_lcoe_construction_period_uses_years_unit():
    inputs = LCOEEngine.build_default_inputs("solar_pv")

    assert inputs["construction_years"].unit == "years"
