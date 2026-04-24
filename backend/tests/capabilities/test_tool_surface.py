from app.capabilities.registry import get_capability_registry


def _tool_names(surface: str) -> set[str]:
    return {
        tool["function"]["name"]
        for tool in get_capability_registry().to_openai_tools(surface)
    }


def test_orchestration_surface_exposes_scripted_onboarding_tools():
    names = _tool_names("orchestration")

    assert "send_message" in names
    assert "ask_for_documents" in names
    assert "ask_clarifying_questions" in names
    assert "run_lcoe" in names
    assert "run_carbon" in names
    assert "search_web_sources" not in names


def test_project_surface_exposes_research_tools_and_plan_updates():
    names = _tool_names("project")

    assert "search_web_sources" in names
    assert "search_scholarly_literature" in names
    assert "generate_project_plan" in names
    assert "update_project_plan" in names
    assert "run_lcoe" in names
    assert "send_message" not in names
    assert "ask_for_documents" not in names


def test_standalone_surface_excludes_onboarding_only_tools():
    names = _tool_names("standalone")

    assert "search_web_sources" in names
    assert "search_scholarly_literature" in names
    assert "run_lcoe" in names
    assert "run_carbon" in names
    assert "send_message" not in names
    assert "ask_for_documents" not in names
