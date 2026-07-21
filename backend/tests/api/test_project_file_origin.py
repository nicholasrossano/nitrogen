"""Classification helpers for uploaded vs generated project files."""

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

from app.api.project_materials import (
    MATERIAL_ORIGIN_GENERATED,
    MATERIAL_ORIGIN_UPLOAD,
    _evidence_response,
    _generated_material_response,
    _material_response,
)


def test_material_response_preserves_generated_origin():
    m = SimpleNamespace(
        id=uuid4(),
        filename="landscape_n1_user_report.docx",
        file_type="docx",
        file_size=100,
        created_at=datetime.now(timezone.utc),
        origin=MATERIAL_ORIGIN_GENERATED,
    )
    resp = _material_response(m)
    assert resp.origin == MATERIAL_ORIGIN_GENERATED
    assert resp.source == "material"


def test_evidence_response_is_always_upload():
    e = SimpleNamespace(
        id=uuid4(),
        filename="budget.xlsx",
        file_type="xlsx",
        file_size=50,
        created_at=datetime.now(timezone.utc),
        processing_status="indexed",
        processing_error=None,
    )
    resp = _evidence_response(e)
    assert resp.origin == MATERIAL_ORIGIN_UPLOAD
    assert resp.source == "evidence"


def test_generated_material_response_is_downloadable_file_row():
    mid = uuid4()
    m = SimpleNamespace(
        id=mid,
        filename="stakeholder_n2_user_report.docx",
        file_type="docx",
        file_size=2048,
        created_at=datetime.now(timezone.utc),
        origin=MATERIAL_ORIGIN_GENERATED,
    )
    resp = _generated_material_response(m)
    assert resp.id == str(mid)
    assert resp.title == m.filename
    assert resp.source == "material"
    assert resp.exportable is True
    assert resp.export_format == "docx"
    assert resp.file_size == 2048
    assert resp.download_url == f"/api/v1/materials/{mid}/download"
