"""Tests for relevance-gated assessment recommendations."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.assessments.recommendation import (
    MIN_RECOMMENDATIONS,
    build_recommendation_rows,
    confidence_from_score,
    merge_llm_with_floor,
    score_assessments,
    select_recommended_ids,
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
            "and an memo for funding recommendation."
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
