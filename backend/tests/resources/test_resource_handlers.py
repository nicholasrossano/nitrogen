from uuid import uuid4

import pytest

import app.resources as resource_handlers
from app.core.execution_context import ExecutionContext


class _DummyResult:
    def scalar_one_or_none(self):
        return None


class _DummyDb:
    async def execute(self, _statement):
        return _DummyResult()


def _ctx() -> ExecutionContext:
    return ExecutionContext(
        user_id="test-user",
        user_email="test@example.com",
        initiative_id=None,
        initiative_role=None,
        ai_access_granted=True,
        is_byok=False,
        request_id="test-request-id",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "handler_name,uri,expected_error",
    [
        (
            "_read_evidence_doc",
            f"nitrogen://initiatives/{uuid4()}/evidence/docs/{uuid4()}",
            "EvidenceDoc not found.",
        ),
        (
            "_read_evidence_chunk",
            f"nitrogen://initiatives/{uuid4()}/evidence/chunks/{uuid4()}",
            "EvidenceChunk not found.",
        ),
        (
            "_read_project_material",
            f"nitrogen://initiatives/{uuid4()}/materials/{uuid4()}",
            "ProjectMaterial not found.",
        ),
        (
            "_read_memo_version",
            f"nitrogen://initiatives/{uuid4()}/memos/{uuid4()}",
            "MemoVersion not found.",
        ),
        (
            "_read_assessment_instance",
            f"nitrogen://initiatives/{uuid4()}/assessments/{uuid4()}",
            "AssessmentInstance not found.",
        ),
        (
            "_read_artifact",
            f"nitrogen://initiatives/{uuid4()}/artifacts/{uuid4()}",
            "AssessmentInstance not found.",
        ),
    ],
)
async def test_initiative_scoped_handlers_parse_valid_uri_before_db_lookup(
    monkeypatch: pytest.MonkeyPatch,
    handler_name: str,
    uri: str,
    expected_error: str,
) -> None:
    async def _allow_access(_db, _ctx, _initiative_id):
        return object()

    monkeypatch.setattr(resource_handlers, "_ensure_initiative_access", _allow_access)
    handler = getattr(resource_handlers, handler_name)

    with pytest.raises(ValueError, match=expected_error):
        await handler(uri, _DummyDb(), _ctx())
