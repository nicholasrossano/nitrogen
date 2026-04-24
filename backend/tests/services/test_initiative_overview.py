from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services import initiative_overview


def _make_initiative(**overrides):
    defaults = dict(
        id=uuid4(),
        title="Rural Solar Mini-Grid",
        geography="Kenya",
        project_type="solar_pv",
        project_description="Develop a distributed energy project for underserved communities.",
        goal="Expand reliable electricity access.",
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_build_overview_prompt_includes_context_and_sources():
    initiative = _make_initiative()
    system_prompt, user_prompt = initiative_overview._build_overview_prompt(
        initiative,
        [
            {
                "source_type": "evidence",
                "filename": "feasibility-study.pdf",
                "excerpt": "The study outlines projected demand, proposed system size, and implementation constraints.",
            }
        ],
    )

    assert "concise project overview summaries" in system_prompt
    assert "Rural Solar Mini-Grid" in user_prompt
    assert "Kenya" in user_prompt
    assert "Solar Pv" in user_prompt
    assert "feasibility-study.pdf" in user_prompt


@pytest.mark.asyncio
async def test_generate_initiative_overview_requires_uploaded_files(monkeypatch: pytest.MonkeyPatch):
    initiative = _make_initiative()

    async def _no_sources(_db, _initiative_id):
        return []

    monkeypatch.setattr(initiative_overview, "_load_source_summaries", _no_sources)

    with pytest.raises(ValueError, match="Upload files to generate a project summary."):
        await initiative_overview.generate_initiative_overview(
            db=SimpleNamespace(),
            initiative=initiative,
            user_id="user-1",
        )


@pytest.mark.asyncio
async def test_generate_initiative_overview_returns_llm_content(monkeypatch: pytest.MonkeyPatch):
    initiative = _make_initiative()
    recorded = {"called": False}

    async def _fake_sources(_db, _initiative_id):
        return [
            {
                "source_type": "material",
                "filename": "project-brief.docx",
                "excerpt": "A compact summary of the project scope and delivery model.",
            }
        ]

    class _FakeCompletions:
        async def create(self, **_kwargs):
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="A short generated overview."))],
                usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5),
            )

    class _FakeClient:
        chat = SimpleNamespace(completions=_FakeCompletions())

    async def _fake_get_client(_user_id, _db):
        return _FakeClient(), False

    async def _fake_record_usage(*_args, **_kwargs):
        recorded["called"] = True

    monkeypatch.setattr(initiative_overview, "_load_source_summaries", _fake_sources)
    monkeypatch.setattr(initiative_overview, "get_openai_client", _fake_get_client)
    monkeypatch.setattr(initiative_overview, "record_usage_from_response", _fake_record_usage)

    result = await initiative_overview.generate_initiative_overview(
        db=SimpleNamespace(),
        initiative=initiative,
        user_id="user-1",
    )

    assert result == "A short generated overview."
    assert recorded["called"] is True
