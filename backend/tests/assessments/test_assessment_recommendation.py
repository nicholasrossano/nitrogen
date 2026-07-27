"""Tests for relevance-gated assessment recommendations."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.assessments.recommendation import (
    MIN_RECOMMENDATIONS,
    _signal_present,
    build_recommendation_rows,
    confidence_from_score,
    inapplicable_ids,
    merge_llm_with_floor,
    recommend_for_project,
    score_assessments,
    select_recommended_ids,
)

MANGROVE_ARR_CONTEXT = (
    "VCS1764 Reforestation and restoration of degraded mangrove lands, sustainable "
    "livelihood and community development in Myanmar. AR-AM0014 A/R Large-scale "
    "Methodology: afforestation and reforestation of degraded mangrove habitats. "
    "Non-permanence risk report, verified carbon units, tCO2e, baseline emissions, "
    "leakage from increased use of non-renewable woody biomass, charcoal harvesting "
    "pressure, livestock grazing, community livelihoods, deep due diligence."
)


def test_no_signal_does_not_collapse_all_confidences_to_one():
    scores = score_assessments(project_description="", project_type=None)
    assert scores
    assert all(value == 0.0 for value in scores.values())
    assert all(confidence_from_score(value) == 0.0 for value in scores.values())


def test_no_signal_still_proposes_at_least_two_not_full_catalog():
    scores = score_assessments(
        project_description="A short note about tomorrow's meeting.",
        project_type=None,
    )
    recommended = select_recommended_ids(scores)
    assert len(recommended) == MIN_RECOMMENDATIONS
    assert len(recommended) < len(scores)


def test_carbon_and_lcoe_language_recommends_those_not_unrelated():
    scores = score_assessments(
        project_description=(
            "This cookstove project needs carbon credits and emission reductions, "
            "plus an LCOE and capex feasibility model."
        ),
        project_type=None,
    )
    recommended = select_recommended_ids(scores)
    assert "carbon_model" in recommended
    assert "lcoe_model" in recommended
    # Should not dump the full catalog just because some tools matched
    assert len(recommended) < len(scores)


def test_solar_and_stakeholder_keywords_are_covered():
    scores = score_assessments(
        project_description="Community solar mini-grid with stakeholder engagement partners.",
        project_type=None,
    )
    recommended = select_recommended_ids(scores)
    assert "solar_estimate" in recommended
    assert "stakeholder_assessment" in recommended


def test_project_type_boosts_energy_access_without_selecting_everything():
    scores = score_assessments(
        project_description="Rural electrification pilot in Kenya.",
        project_type="energy_access",
    )
    recommended = select_recommended_ids(scores)
    assert "solar_estimate" in recommended or "lcoe_model" in recommended
    assert len(recommended) < len(scores)


def test_broad_multi_theme_project_can_exceed_two():
    scores = score_assessments(
        project_description=(
            "Solar PV mini-grid with LCOE economics, carbon emission reductions, "
            "stakeholder engagement, landscape ecosystem mapping, implementation roadmap, "
            "and a risk-summary memo for the diligence file."
        ),
        project_type="energy_access",
    )
    recommended = select_recommended_ids(scores)
    assert len(recommended) > MIN_RECOMMENDATIONS
    for tool_id in (
        "solar_estimate",
        "lcoe_model",
        "carbon_model",
        "stakeholder_assessment",
        "landscape_mapping",
        "implementation_plan",
        "memo",
    ):
        assert tool_id in recommended


def test_llm_invalid_ids_filtered_and_floor_applied():
    heuristic = score_assessments(project_description="", project_type=None)
    valid_ids = set(heuristic.keys())
    scores, recommended = merge_llm_with_floor(
        llm_picks=[("not_a_real_tool", 0.9), ("carbon_model", 0.8)],
        heuristic_scores=heuristic,
        valid_ids=valid_ids,
    )
    assert "not_a_real_tool" not in recommended
    assert "carbon_model" in recommended
    assert len(recommended) >= MIN_RECOMMENDATIONS


def test_empty_llm_falls_back_without_selecting_everything():
    heuristic = score_assessments(
        project_description="Carbon credits for cookstoves.",
        project_type=None,
    )
    scores, recommended = merge_llm_with_floor(
        llm_picks=[],
        heuristic_scores=heuristic,
        valid_ids=set(heuristic.keys()),
    )
    assert "carbon_model" in recommended
    assert len(recommended) < len(heuristic)
    assert len(recommended) >= MIN_RECOMMENDATIONS


def _all_assessment_ids() -> set[str]:
    return set(score_assessments(project_description="", project_type=None).keys())


def test_land_use_carbon_project_gates_out_avoided_emissions_calculator():
    # The carbon engine only models avoided emissions; an ARR/removals project
    # cannot be represented by it even though it is unmistakably a carbon project.
    blocked = inapplicable_ids(MANGROVE_ARR_CONTEXT, _all_assessment_ids())
    assert "carbon_model" in blocked
    assert "risk_assessment" not in blocked
    assert "stakeholder_assessment" not in blocked


def test_land_use_carbon_project_still_recommends_applicable_assessments():
    scores = score_assessments(
        project_description=MANGROVE_ARR_CONTEXT,
        project_type="carbon offset project",
    )
    blocked = inapplicable_ids(MANGROVE_ARR_CONTEXT, set(scores.keys()))
    scores = {k: v for k, v in scores.items() if k not in blocked}
    recommended = select_recommended_ids(scores)
    assert "carbon_model" not in recommended
    assert len(recommended) >= MIN_RECOMMENDATIONS


def test_supported_method_pack_projects_are_not_gated():
    ids = _all_assessment_ids()
    for description in (
        "Improved cookstove distribution with fNRB and carbon credits.",
        "Fuel switch to LPG for household cooking.",
        "Safe water supply using ceramic filter technology.",
        "Solar home systems replacing kerosene lighting.",
        "Biodigester program with manure management.",
    ):
        assert "carbon_model" not in inapplicable_ids(description, ids), description


def test_signal_present_requires_word_boundary():
    # Substring matching would let unrelated prose open a scope gate.
    assert _signal_present("we distribute cfl bulbs", "cfl")
    assert not _signal_present("the baseline is modelled and detailed", "led")
    assert not _signal_present("solarium refurbishment", "solar")


@pytest.mark.asyncio
async def test_recommend_for_project_drops_out_of_scope_llm_pick(monkeypatch: pytest.MonkeyPatch):
    assessments = [
        SimpleNamespace(definition=SimpleNamespace(id=tool_id))
        for tool_id in ("carbon_model", "risk_assessment", "stakeholder_assessment")
    ]

    async def fake_llm(**_kwargs):
        # Mirrors the real failure: the model picked the calculator on name alone.
        return [("carbon_model", 1.0), ("risk_assessment", 0.9), ("stakeholder_assessment", 0.85)]

    monkeypatch.setattr("app.assessments.recommendation.propose_with_llm", fake_llm)

    rows = await recommend_for_project(
        assessments=assessments,  # type: ignore[arg-type]
        project_title="VCS1764",
        project_description=MANGROVE_ARR_CONTEXT,
        project_type="carbon offset project",
    )
    recommended = {row[0].definition.id for row in rows if row[2]}
    assert "carbon_model" not in recommended
    assert recommended == {"risk_assessment", "stakeholder_assessment"}


def test_build_recommendation_rows_marks_recommended_flag():
    assessments = [
        SimpleNamespace(definition=SimpleNamespace(id="carbon_model")),
        SimpleNamespace(definition=SimpleNamespace(id="lcoe_model")),
        SimpleNamespace(definition=SimpleNamespace(id="risk_assessment")),
    ]
    scores = {"carbon_model": 2.0, "lcoe_model": 0.0, "risk_assessment": 0.0}
    recommended_ids = select_recommended_ids(scores)
    rows = build_recommendation_rows(
        assessments=assessments,  # type: ignore[arg-type]
        scores=scores,
        recommended_ids=recommended_ids,
    )
    by_id = {row[0].definition.id: row for row in rows}
    assert by_id["carbon_model"][2] is True
    assert len([row for row in rows if row[2]]) >= MIN_RECOMMENDATIONS


@pytest.mark.asyncio
async def test_propose_structure_returns_only_recommended(monkeypatch: pytest.MonkeyPatch):
    from app.plans.project_plan_handler import ProjectPlanHandler

    async def fake_wait(_project_id):
        return True

    async def fake_preview(_db, _project_id, **_kwargs):
        return ""

    async def fake_recommend(**_kwargs):
        carbon = SimpleNamespace(
            definition=SimpleNamespace(
                id="carbon_model",
                to_dict=lambda: {
                    "id": "carbon_model",
                    "name": "Carbon",
                    "description": "d",
                    "icon": "Leaf",
                    "output_type": "analysis",
                    "category": "impact",
                },
            )
        )
        lcoe = SimpleNamespace(
            definition=SimpleNamespace(
                id="lcoe_model",
                to_dict=lambda: {
                    "id": "lcoe_model",
                    "name": "LCOE",
                    "description": "d",
                    "icon": "Calculator",
                    "output_type": "analysis",
                    "category": "feasibility",
                },
            )
        )
        risk = SimpleNamespace(
            definition=SimpleNamespace(
                id="risk_assessment",
                to_dict=lambda: {
                    "id": "risk_assessment",
                    "name": "Risk",
                    "description": "d",
                    "icon": "Alert",
                    "output_type": "analysis",
                    "category": "risk",
                },
            )
        )
        return [
            (carbon, 0.9, True),
            (lcoe, 0.8, True),
            (risk, 0.1, False),
        ]

    monkeypatch.setattr(
        "app.plans.project_plan_handler.await_lightweight_readiness",
        fake_wait,
        raising=False,
    )
    monkeypatch.setattr(
        "app.services.evidence_processor.await_lightweight_readiness",
        fake_wait,
    )
    monkeypatch.setattr(
        "app.plans.project_plan_handler.load_materials_preview",
        fake_preview,
    )
    monkeypatch.setattr(
        "app.plans.project_plan_handler.recommend_for_project",
        fake_recommend,
    )

    handler = ProjectPlanHandler(db=SimpleNamespace(), user_id="u1")
    initiative = SimpleNamespace(
        id="proj-1",
        selected_tools=None,
        title="Cookstove program",
        project_description="Carbon credits for clean cooking.",
        project_type="clean_cooking",
    )
    structure = await handler.propose_structure(initiative)
    ids = [item["tool"]["id"] for item in structure]
    assert ids == ["carbon_model", "lcoe_model"]
    assert all(item["recommended"] is True for item in structure)
