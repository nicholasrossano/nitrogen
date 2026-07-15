"""Hosted mode must never auto-join users to a shared team workspace."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.models.workspace import WorkspaceMembership, WorkspaceRole, WorkspaceType
from app.services import workspaces as workspaces_service


def _settings(*, single_org_mode: bool) -> SimpleNamespace:
    return SimpleNamespace(single_org_mode=single_org_mode)


@pytest.mark.asyncio
async def test_default_workspace_is_personal_when_not_single_org(
    monkeypatch: pytest.MonkeyPatch,
):
    personal = SimpleNamespace(
        id=uuid4(),
        workspace_type=WorkspaceType.PERSONAL.value,
        name="Personal",
    )
    membership = WorkspaceMembership(
        workspace_id=personal.id,
        user_id="user-1",
        role=WorkspaceRole.OWNER.value,
    )
    company_calls: list[str] = []

    async def fake_personal(_db, user_id: str):
        assert user_id == "user-1"
        return personal

    async def fake_company(_db, user_id: str):
        company_calls.append(user_id)
        raise AssertionError("ensure_company_workspace must not run in hosted mode")

    async def fake_membership(_db, workspace_id, user_id: str):
        assert workspace_id == personal.id
        assert user_id == "user-1"
        return membership

    monkeypatch.setattr(workspaces_service, "get_settings", lambda: _settings(single_org_mode=False))
    monkeypatch.setattr(workspaces_service, "ensure_personal_workspace", fake_personal)
    monkeypatch.setattr(workspaces_service, "ensure_company_workspace", fake_company)
    monkeypatch.setattr(workspaces_service, "get_workspace_membership", fake_membership)

    workspace, resolved = await workspaces_service.resolve_workspace_for_user(
        AsyncMock(), "user-1", None
    )

    assert workspace is personal
    assert resolved is membership
    assert company_calls == []


@pytest.mark.asyncio
async def test_default_workspace_uses_company_in_single_org_mode(
    monkeypatch: pytest.MonkeyPatch,
):
    company = SimpleNamespace(
        id=uuid4(),
        workspace_type=WorkspaceType.TEAM.value,
        name="Company",
    )
    membership = WorkspaceMembership(
        workspace_id=company.id,
        user_id="user-1",
        role=WorkspaceRole.MEMBER.value,
    )
    personal_calls: list[str] = []

    async def fake_personal(_db, user_id: str):
        personal_calls.append(user_id)
        raise AssertionError("ensure_personal_workspace must not run in single-org mode")

    async def fake_company(_db, user_id: str):
        assert user_id == "user-1"
        return company

    async def fake_membership(_db, workspace_id, user_id: str):
        assert workspace_id == company.id
        assert user_id == "user-1"
        return membership

    monkeypatch.setattr(workspaces_service, "get_settings", lambda: _settings(single_org_mode=True))
    monkeypatch.setattr(workspaces_service, "ensure_personal_workspace", fake_personal)
    monkeypatch.setattr(workspaces_service, "ensure_company_workspace", fake_company)
    monkeypatch.setattr(workspaces_service, "get_workspace_membership", fake_membership)

    workspace, resolved = await workspaces_service.resolve_workspace_for_user(
        AsyncMock(), "user-1", None
    )

    assert workspace is company
    assert resolved is membership
    assert personal_calls == []
