from uuid import uuid4

import pytest

from app.services import assessment_service


class _FakeScalarResult:
    def __init__(self, items):
        self._items = list(items)

    def all(self):
        return list(self._items)


class _FakeExecuteResult:
    def __init__(self, items):
        self._items = list(items)

    def scalars(self):
        return _FakeScalarResult(self._items)


class _FakeDb:
    def __init__(self):
        self.last_statement = None

    async def execute(self, statement):
        self.last_statement = statement
        return _FakeExecuteResult([])


@pytest.mark.asyncio
async def test_list_instances_includes_drafts_for_active_view():
    db = _FakeDb()

    await assessment_service.list_instances(
        db,
        project_id=uuid4(),
        archived=False,
    )

    sql = str(db.last_statement)
    assert "assessment_instances.archived = false" in sql.lower()
    assert "assessment_instances.status !=" not in sql.lower()
