import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.api import assessment_catalog as catalog_api
from app.core.auth import AuthUser
from app.models.project import Project


@pytest.mark.asyncio
async def test_get_recommended_tools_returns_empty_when_project_has_no_description(
    monkeypatch: pytest.MonkeyPatch,
):
    project = Project(
        id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        name="New Project",
        slug="new-project",
        created_by="firebase-user-1",
        archived=False,
        sector="general",
        stage="describe",
        stage_1_complete=False,
        evidence_ready=False,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )

    async def fake_require_project_viewer(_db, _project_id, _user):
        return project

    monkeypatch.setattr(catalog_api, "require_project_viewer", fake_require_project_viewer)

    response = await catalog_api.get_recommended_tools(
        project_id=str(project.id),
        db=SimpleNamespace(),
        user=AuthUser(uid="firebase-user-1", email="owner@example.com"),
    )

    assert response.recommendations == []
    assert response.project_type is None
