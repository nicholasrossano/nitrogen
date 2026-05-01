"""Contract tests for reusable plan handlers."""

from app.plans import get_plan_registry
from app.plans.base import BasePlanHandler


def test_default_plan_handler_is_registered() -> None:
    registry = get_plan_registry()
    assert "project_plan" in registry.list_plan_ids()


def test_project_plan_handler_exposes_plan_workspace_contract() -> None:
    handler = get_plan_registry().default_handler(db=None, user_id=None)
    assert isinstance(handler, BasePlanHandler)
    assert handler.definition.id == "project_plan"
    assert handler.definition.primary_ui_object == "plan_workspace"
    assert handler.definition.structure_widget_type == "tool_checklist"
    assert handler.definition.summary_widget_type == "plan_summary"


def test_project_plan_handler_attaches_metadata_and_widget_shapes() -> None:
    handler = get_plan_registry().default_handler(db=None, user_id=None)
    raw_plan = {
        "generated_at": "2026-01-01T00:00:00Z",
        "pillars": [
            {
                "id": "authorization",
                "name": "Authorization",
                "icon": "Shield",
                "summary": "Permits and approvals",
                "items": [
                    {"id": "auth-001", "classification": "required"},
                    {"id": "auth-002", "classification": "optional"},
                ],
            },
            {
                "id": "capital",
                "name": "Capital",
                "icon": "Banknote",
                "summary": "Financing workstream",
                "items": [{"id": "cap-001", "classification": "required"}],
            },
        ],
    }

    plan = handler.attach_metadata(raw_plan)
    assert plan["plan_type"] == "project_plan"
    assert plan["schema_version"] == handler.schema_version

    summary_data = handler.build_summary_widget_data(plan)
    assert summary_data["planType"] == "project_plan"
    assert summary_data["title"] == "Framework"
    assert summary_data["totalItems"] == 3
    assert len(summary_data["groups"]) == 2

    structure_data = handler.build_structure_widget_data([
        {"id": "authorization", "name": "Authorization", "summary": "Permits", "icon": "Shield"},
        {"id": "capital", "name": "Capital", "summary": "Financing", "icon": "Banknote"},
    ])
    assert structure_data["title"] == "Recommended Framework Assessments"
    assert structure_data["confirmLabel"] == "Confirm Framework Assessments"
    assert structure_data["recommendations"][0]["id"] == "authorization"
