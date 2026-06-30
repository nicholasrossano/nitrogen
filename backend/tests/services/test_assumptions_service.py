from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services import assumptions as assumptions_service
from app.assumptions.config import expected_assumptions_for_assessments
from app.services.assumptions import (
    _assessment_ids_from_initiative,
    AssumptionActor,
    apply_assumptions_to_items,
    build_chat_assumption_candidate,
    ensure_expected_assumptions,
    extract_assumptions_from_cited_chat_sources,
    format_assumptions_for_prompt,
    normalize_missing_value,
    normalize_assumption_status,
)
from app.services.tiered_retrieval import RetrievedFact, SourceType


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


def test_extraction_quality_gate_accepts_explicit_string_assertion():
    definition = assumptions_service.ASSUMPTION_BY_KEY["operator_model"]
    raw = {
        "value": "XYZ Supplier",
        "source_quote": "The panel supplier is XYZ Supplier for the first deployment phase.",
    }

    assert assumptions_service._passes_extraction_quality_gate(raw, definition) is True


def test_extraction_quality_gate_rejects_bare_entity_mention_for_string():
    definition = assumptions_service.ASSUMPTION_BY_KEY["operator_model"]
    raw = {
        "value": "OpenStreetMap Malawi Community",
        "source_quote": "OpenStreetMap Malawi Community",
    }

    assert assumptions_service._passes_extraction_quality_gate(raw, definition) is False


def test_extraction_quality_gate_rejects_numeric_without_numeric_evidence():
    definition = assumptions_service.ASSUMPTION_BY_KEY["discount_rate"]
    raw = {
        "value": 0.08,
        "source_quote": "The financing assumptions are still under discussion.",
    }

    assert assumptions_service._passes_extraction_quality_gate(raw, definition) is False


@pytest.mark.asyncio
async def test_ensure_expected_assumptions_is_config_guidance_only():
    created, touched = await ensure_expected_assumptions(
        SimpleNamespace(),
        SimpleNamespace(id=uuid4()),
        assessment_ids=["lcoe_model"],
        actor=AssumptionActor.system(),
    )

    assert created == 0
    assert touched == []


@pytest.mark.asyncio
async def test_sync_stage_assumptions_ignores_rows_without_field_name(
    monkeypatch: pytest.MonkeyPatch,
):
    called = False

    async def fake_upsert_assumption(*_args, **_kwargs):
        nonlocal called
        called = True
        return SimpleNamespace(id=uuid4()), True

    async def fake_upsert_binding(*_args, **_kwargs):
        return SimpleNamespace(assumption_id=uuid4())

    monkeypatch.setattr(assumptions_service, "upsert_assumption", fake_upsert_assumption)
    monkeypatch.setattr(assumptions_service, "upsert_assumption_binding", fake_upsert_binding)

    touched, item_map = await assumptions_service.sync_stage_assumptions(
        SimpleNamespace(),
        project_id=uuid4(),
        assessment_id="landscape_mapping",
        stage_id="entities",
        stage_data={
            "items": [
                {
                    "id": "entity-1",
                    "content": {
                        "name": "OpenStreetMap Malawi Community",
                        "category": "Data Ecosystem",
                        "description": "Community group",
                    },
                }
            ]
        },
        actor=AssumptionActor.system(),
    )

    assert called is False
    assert touched == []
    assert item_map == {}


@pytest.mark.asyncio
async def test_sync_stage_assumptions_ignores_unmapped_field_name(
    monkeypatch: pytest.MonkeyPatch,
):
    called = False

    async def fake_upsert_assumption(*_args, **_kwargs):
        nonlocal called
        called = True
        return SimpleNamespace(id=uuid4()), True

    async def fake_upsert_binding(*_args, **_kwargs):
        return SimpleNamespace(assumption_id=uuid4())

    monkeypatch.setattr(assumptions_service, "upsert_assumption", fake_upsert_assumption)
    monkeypatch.setattr(assumptions_service, "upsert_assumption_binding", fake_upsert_binding)

    touched, item_map = await assumptions_service.sync_stage_assumptions(
        SimpleNamespace(),
        project_id=uuid4(),
        assessment_id="landscape_mapping",
        stage_id="entities",
        stage_data={
            "items": [
                {
                    "id": "item-1",
                    "content": {
                        "field_name": "open_street_map_community",
                        "value": "OpenStreetMap Malawi Community",
                    },
                }
            ]
        },
        actor=AssumptionActor.system(),
    )

    assert called is False
    assert touched == []
    assert item_map == {}


def test_build_chat_assumption_candidate_extracts_cited_project_country_indicator():
    fact = RetrievedFact(
        content="Access to electricity (% of population) (EG.ELC.ACCS.ZS) for Malawi in 2023: 15.6.",
        source_type=SourceType.WORLDBANK_INDICATOR,
        source_title="Access to electricity (% of population) (Malawi)",
        source_url="https://data.worldbank.org/indicator/EG.ELC.ACCS.ZS",
        chunk_id="MWI:EG.ELC.ACCS.ZS:2023",
        publisher="World Bank Open Data",
    )
    answer = (
        "Malawi's electricity access was 15.6% "
        "[Country Indicator: Access to electricity (% of population) (Malawi)]."
    )

    candidate = build_chat_assumption_candidate(
        fact,
        answer_content=answer,
    )

    assert candidate is not None
    assert candidate["key"] == "electricity_access_total"
    assert candidate["value"] == 15.6
    assert candidate["unit"] == "%"
    assert candidate["source_reference"]["country"] == "Malawi"


def test_build_chat_assumption_candidate_allows_llm_to_decide_project_relevance():
    fact = RetrievedFact(
        content="Access to electricity (% of population) (EG.ELC.ACCS.ZS) for Kenya in 2023: 76.5.",
        source_type=SourceType.WORLDBANK_INDICATOR,
        source_title="Access to electricity (% of population) (Kenya)",
        source_url="https://data.worldbank.org/indicator/EG.ELC.ACCS.ZS",
        chunk_id="KEN:EG.ELC.ACCS.ZS:2023",
        publisher="World Bank Open Data",
    )
    answer = (
        "Kenya's electricity access was 76.5% "
        "[Country Indicator: Access to electricity (% of population) (Kenya)]."
    )

    candidate = build_chat_assumption_candidate(
        fact,
        answer_content=answer,
    )

    assert candidate is not None
    assert candidate["key"] == "electricity_access_total"
    assert candidate["source_reference"]["country"] == "Kenya"


def test_build_chat_assumption_candidate_requires_final_answer_citation():
    fact = RetrievedFact(
        content="Access to electricity (% of population) (EG.ELC.ACCS.ZS) for Malawi in 2023: 15.6.",
        source_type=SourceType.WORLDBANK_INDICATOR,
        source_title="Access to electricity (% of population) (Malawi)",
        source_url="https://data.worldbank.org/indicator/EG.ELC.ACCS.ZS",
        chunk_id="MWI:EG.ELC.ACCS.ZS:2023",
        publisher="World Bank Open Data",
    )

    candidate = build_chat_assumption_candidate(
        fact,
        answer_content="Malawi's electricity access was 15.6%.",
    )

    assert candidate is None


@pytest.mark.asyncio
async def test_extract_assumptions_from_cited_chat_sources_respects_relevance_decision(
    monkeypatch: pytest.MonkeyPatch,
):
    fact = RetrievedFact(
        content="Access to electricity (% of population) (EG.ELC.ACCS.ZS) for Kenya in 2023: 76.5.",
        source_type=SourceType.WORLDBANK_INDICATOR,
        source_title="Access to electricity (% of population) (Kenya)",
        source_url="https://data.worldbank.org/indicator/EG.ELC.ACCS.ZS",
        chunk_id="KEN:EG.ELC.ACCS.ZS:2023",
        publisher="World Bank Open Data",
    )
    answer = (
        "Kenya's electricity access was 76.5% "
        "[Country Indicator: Access to electricity (% of population) (Kenya)]."
    )
    initiative = SimpleNamespace(
        id=uuid4(),
        title="Malawi mini-grid",
        geography="Malawi",
        project_type="energy_access",
        project_description="Solar mini-grid project in Malawi",
        sector="energy",
        goal=None,
    )

    async def fake_should_log(*_args, **_kwargs):
        return False, "The cited fact answers a side question, not this project."

    async def fail_upsert(*_args, **_kwargs):
        raise AssertionError("irrelevant candidates should not be persisted")

    monkeypatch.setattr(assumptions_service, "_should_log_chat_assumption", fake_should_log)
    monkeypatch.setattr(assumptions_service, "upsert_assumption", fail_upsert)

    touched = await extract_assumptions_from_cited_chat_sources(
        SimpleNamespace(),
        initiative,
        [fact],
        answer_content=answer,
        actor=AssumptionActor(user_id="user-1", email="test@example.com"),
        user_message="What is the electricity access of Kenya?",
        chat_id="chat-1",
    )

    assert touched == []


@pytest.mark.asyncio
async def test_extract_assumptions_from_cited_chat_sources_persists_relevant_llm_candidate(
    monkeypatch: pytest.MonkeyPatch,
):
    fact = RetrievedFact(
        content="Access to electricity (% of population) (EG.ELC.ACCS.ZS) for Malawi in 2023: 15.6.",
        source_type=SourceType.WORLDBANK_INDICATOR,
        source_title="Access to electricity (% of population) (Malawi)",
        source_url="https://data.worldbank.org/indicator/EG.ELC.ACCS.ZS",
        chunk_id="MWI:EG.ELC.ACCS.ZS:2023",
        publisher="World Bank Open Data",
    )
    answer = (
        "Malawi's electricity access was 15.6% "
        "[Country Indicator: Access to electricity (% of population) (Malawi)]."
    )
    initiative = SimpleNamespace(
        id=uuid4(),
        title="Malawi mini-grid",
        geography="Malawi",
        project_type="energy_access",
        project_description="Solar mini-grid project in Malawi",
        sector="energy",
        goal=None,
    )

    async def fake_should_log(*_args, **_kwargs):
        return True, "The cited fact establishes a project baseline."

    async def fake_upsert(_db, **kwargs):
        return SimpleNamespace(**kwargs), True

    monkeypatch.setattr(assumptions_service, "_should_log_chat_assumption", fake_should_log)
    monkeypatch.setattr(assumptions_service, "upsert_assumption", fake_upsert)

    touched = await extract_assumptions_from_cited_chat_sources(
        SimpleNamespace(),
        initiative,
        [fact],
        answer_content=answer,
        actor=AssumptionActor(user_id="user-1", email="test@example.com"),
        user_message="What is the energy access in Malawi?",
        chat_id="chat-1",
    )

    assert len(touched) == 1
    assert touched[0].key == "electricity_access_total"
    assert touched[0].value == 15.6
    assert touched[0].source_reference["relevance_reason"] == "The cited fact establishes a project baseline."
