"""Unit tests for the async evidence processor.

These cover the parts we can exercise without a real Postgres + pgvector
setup: state-property logic on ``EvidenceDoc``, the lightweight preview
extractor's best-effort error handling, and the assessment-gating readiness
helper's no-docs short-circuit and polling-to-ready transition.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.models.evidence import EvidenceDoc, EvidenceDocStatus
from app.services import evidence_processor


# ---------------------------------------------------------------------------
# EvidenceDoc lifecycle property tests
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "status,expected_light,expected_indexed",
    [
        (EvidenceDocStatus.UPLOADED.value, False, False),
        (EvidenceDocStatus.PROCESSING.value, False, False),
        (EvidenceDocStatus.LIGHTWEIGHT_READY.value, True, False),
        (EvidenceDocStatus.INDEXED.value, True, True),
        (EvidenceDocStatus.FAILED.value, False, False),
    ],
)
def test_evidence_doc_status_properties(status, expected_light, expected_indexed):
    doc = EvidenceDoc(
        id=uuid.uuid4(),
        initiative_id=uuid.uuid4(),
        filename="x.pdf",
        file_type="pdf",
        storage_path="/tmp/x",
        file_size=10,
        processing_status=status,
        created_at=datetime.now(timezone.utc),
    )
    assert doc.is_lightweight_ready is expected_light
    assert doc.is_indexed is expected_indexed


# ---------------------------------------------------------------------------
# _extract_preview — best-effort, must never raise
# ---------------------------------------------------------------------------


class _StubParser:
    def __init__(
        self,
        *,
        pdf_pages=None,
        docx_text=None,
        pptx_text=None,
        xlsx_text=None,
        raise_for=None,
    ):
        self._pdf_pages = pdf_pages
        self._docx_text = docx_text
        self._pptx_text = pptx_text
        self._xlsx_text = xlsx_text
        self._raise_for = raise_for or set()

    def parse_pdf_pages(self, _bytes):
        if "pdf" in self._raise_for:
            raise RuntimeError("boom")
        return self._pdf_pages or []

    def parse_docx(self, _bytes):
        if "docx" in self._raise_for:
            raise RuntimeError("boom")
        return self._docx_text or ""

    def parse_pptx(self, _bytes):
        if "pptx" in self._raise_for:
            raise RuntimeError("boom")
        return self._pptx_text or ""

    def parse_xlsx(self, _bytes):
        if "xlsx" in self._raise_for:
            raise RuntimeError("boom")
        return self._xlsx_text or ""


def test_extract_preview_pdf_returns_truncated_first_page():
    parser = _StubParser(pdf_pages=[("This is the first page.  ", 1), ("ignored", 2)])
    preview = evidence_processor._extract_preview(parser, b"", "pdf")
    assert preview == "This is the first page."


def test_extract_preview_docx_strips_whitespace():
    parser = _StubParser(docx_text="   hello world   ")
    assert evidence_processor._extract_preview(parser, b"", "docx") == "hello world"


def test_extract_preview_pptx_strips_whitespace():
    parser = _StubParser(pptx_text="   slide text   ")
    assert evidence_processor._extract_preview(parser, b"", "pptx") == "slide text"


def test_extract_preview_respects_char_limit():
    big = "x" * (evidence_processor.PREVIEW_CHAR_LIMIT + 500)
    parser = _StubParser(docx_text=big)
    preview = evidence_processor._extract_preview(parser, b"", "docx")
    assert preview is not None
    assert len(preview) == evidence_processor.PREVIEW_CHAR_LIMIT


def test_extract_preview_returns_none_on_parse_error():
    parser = _StubParser(raise_for={"pdf"})
    assert evidence_processor._extract_preview(parser, b"", "pdf") is None


def test_extract_preview_unknown_file_type_returns_none():
    parser = _StubParser()
    assert evidence_processor._extract_preview(parser, b"", "ppt") is None


def test_extract_preview_text_file_type():
    parser = _StubParser()
    assert (
        evidence_processor._extract_preview(parser, b"  raw text  ", "text")
        == "raw text"
    )


# ---------------------------------------------------------------------------
# await_lightweight_readiness — core assessment-gating behaviour
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_await_lightweight_readiness_returns_immediately_with_no_docs():
    """Typed-context-only onboarding: no docs uploaded must not block."""

    async def fake_count(_db, _initiative_id):
        return (0, 0)

    with patch.object(evidence_processor, "_count_docs_by_state", side_effect=fake_count), \
         patch.object(
             evidence_processor,
             "AsyncSessionLocal",
             return_value=_AsyncCtxSession(),
         ):
        result = await evidence_processor.await_lightweight_readiness(
            uuid.uuid4(), timeout_seconds=1.0, poll_seconds=0.01
        )
    assert result is True


@pytest.mark.asyncio
async def test_await_lightweight_readiness_returns_true_when_doc_becomes_ready():
    """With at least one ready doc we should return True, not time out."""

    calls = {"n": 0}

    async def fake_count(_db, _initiative_id):
        calls["n"] += 1
        # First two polls: 1 doc pending. Third poll: doc is lightweight_ready.
        if calls["n"] < 3:
            return (1, 0)
        return (0, 1)

    with patch.object(evidence_processor, "_count_docs_by_state", side_effect=fake_count), \
         patch.object(
             evidence_processor,
             "AsyncSessionLocal",
             return_value=_AsyncCtxSession(),
         ):
        result = await evidence_processor.await_lightweight_readiness(
            uuid.uuid4(), timeout_seconds=1.0, poll_seconds=0.001
        )

    assert result is True
    assert calls["n"] >= 3


@pytest.mark.asyncio
async def test_await_lightweight_readiness_times_out_when_stuck_pending():
    async def fake_count(_db, _initiative_id):
        return (1, 0)  # always pending — never becomes ready

    with patch.object(evidence_processor, "_count_docs_by_state", side_effect=fake_count), \
         patch.object(
             evidence_processor,
             "AsyncSessionLocal",
             return_value=_AsyncCtxSession(),
         ):
        result = await evidence_processor.await_lightweight_readiness(
            uuid.uuid4(), timeout_seconds=0.05, poll_seconds=0.01
        )

    assert result is False


class _AsyncCtxSession:
    """Minimal stand-in so ``async with AsyncSessionLocal() as db`` works."""

    async def __aenter__(self):
        return SimpleNamespace()

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def __call__(self, *_args, **_kwargs):
        return self
