"""Generated assessment reports should turn cited "[N]" markers into real,
clickable in-document links (to a References bookmark) rather than leaving
them as inert plain text."""

import re
import zipfile
from io import BytesIO

from app.services.docx_exporter import DocxExporterService


def _document_xml(docx_bytes: bytes) -> str:
    with zipfile.ZipFile(BytesIO(docx_bytes)) as archive:
        return archive.read("word/document.xml").decode("utf-8")


def _rels_xml(docx_bytes: bytes) -> str:
    with zipfile.ZipFile(BytesIO(docx_bytes)) as archive:
        return archive.read("word/_rels/document.xml.rels").decode("utf-8")


def test_generate_assessment_docx_links_known_citations():
    content = {
        "title": "Test Report",
        "executive_summary": "Strong potential [1] and regional alignment [2].",
        "sections": [
            {
                "theme": "Risks",
                "body": "Financing gaps are a concern [1]. Unrelated [999] has no citation.",
            }
        ],
        "recommendations": ["Proceed with diligence [2]"],
        "citations": [
            {
                "number": 1,
                "source_title": "Evidence Doc A",
                "source_url": "https://example.com/a",
                "excerpt": "Some excerpt.",
            },
            {
                "number": 2,
                "source_title": "Case Study B",
                "excerpt": "Another excerpt.",
            },
        ],
    }

    docx_bytes = DocxExporterService().generate_assessment_docx(content, "My Initiative")
    xml = _document_xml(docx_bytes)

    # Known citation numbers become internal hyperlinks anchored to their reference.
    assert sorted(re.findall(r'w:anchor="(cite_\d+)"', xml)) == [
        "cite_1",
        "cite_1",
        "cite_2",
        "cite_2",
    ]
    # Each cited reference entry exposes a matching bookmark to jump to.
    assert set(re.findall(r'w:name="(cite_\d+)"', xml)) == {"cite_1", "cite_2"}
    # A marker with no matching citation is left as plain, unlinked text.
    assert "[999]" in xml
    assert re.search(r'w:anchor="cite_999"', xml) is None

    # The external source URL becomes a real (relationship-based) hyperlink.
    rels = _rels_xml(docx_bytes)
    assert "https://example.com/a" in rels


def test_generate_assessment_docx_without_citations_renders_plain_text():
    content = {
        "title": "No Citations",
        "executive_summary": "Nothing to cite here.",
        "sections": [{"theme": "Overview", "body": "Just plain body text."}],
    }

    docx_bytes = DocxExporterService().generate_assessment_docx(content, "My Initiative")
    xml = _document_xml(docx_bytes)

    assert "<w:hyperlink" not in xml
    assert "<w:bookmarkStart" not in xml
    assert "Just plain body text." in xml
