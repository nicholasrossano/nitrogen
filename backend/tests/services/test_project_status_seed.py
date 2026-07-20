"""Unit tests for race-safe project status category seeding."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from app.services import project_status


def _integrity_error() -> IntegrityError:
    return IntegrityError("INSERT", {}, Exception("duplicate key"))


@pytest.mark.asyncio
async def test_get_or_seed_recovers_when_parallel_seed_hits_unique_violation():
    project = SimpleNamespace(id=uuid4())
    existing_row = SimpleNamespace(category_key="evidence_credibility", is_active=True)

    db = AsyncMock()
    # 1) no active rows  2) no prior (soft-deleted) rows  3) re-fetch after race
    db.execute = AsyncMock(
        side_effect=[
            MagicMock(scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))),
            MagicMock(scalar_one_or_none=MagicMock(return_value=None)),
            MagicMock(
                scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[existing_row])))
            ),
        ]
    )

    nested = AsyncMock()
    nested.__aenter__ = AsyncMock(return_value=None)
    nested.__aexit__ = AsyncMock(return_value=False)
    db.begin_nested = MagicMock(return_value=nested)
    db.add = MagicMock()
    db.flush = AsyncMock(side_effect=_integrity_error())

    with patch.object(project_status, "get_default_status_categories") as defaults:
        defaults.return_value = SimpleNamespace(
            categories=(
                SimpleNamespace(
                    category_key="evidence_credibility",
                    label="Evidence & credibility",
                    definition_text="Claims are backed by sources.",
                ),
            )
        )
        rows = await project_status.get_or_seed_status_categories(db, project)

    assert rows == [existing_row]
    assert db.flush.await_count == 1


@pytest.mark.asyncio
async def test_list_status_category_configs_does_not_seed():
    project = SimpleNamespace(id=uuid4())
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=MagicMock(
            scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))
        )
    )

    with patch.object(project_status, "get_or_seed_status_categories", AsyncMock()) as seed:
        rows = await project_status.list_status_category_configs(db, project)

    assert rows == []
    seed.assert_not_awaited()
