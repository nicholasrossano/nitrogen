import io
from unittest.mock import patch

from app.core.upload_types import resolve_document_file_type
from app.services.document_conversion import prepare_uploaded_document
from app.services.document_parser import DocumentParserService, _clean_pdf_pages


def test_clean_pdf_pages_removes_repeated_margin_boilerplate():
    pages = [
        (
            "DocuSign Envelope ID: ABC\n"
            "Shared report title\n"
            "Section heading\n"
            "Important body line A\n"
            "Detail A1\n"
            "Detail A2\n"
            "Detail A3\n"
            "Detail A4\n"
            "Detail A5\n"
            "6",
            1,
        ),
        (
            "DocuSign Envelope ID: ABC\n"
            "Shared report title\n"
            "Section heading\n"
            "Important body line B\n"
            "Detail B1\n"
            "Detail B2\n"
            "Detail B3\n"
            "Detail B4\n"
            "Detail B5\n"
            "7",
            2,
        ),
        (
            "DocuSign Envelope ID: ABC\n"
            "Shared report title\n"
            "Section heading\n"
            "Important body line C\n"
            "Detail C1\n"
            "Detail C2\n"
            "Detail C3\n"
            "Detail C4\n"
            "Detail C5\n"
            "8",
            3,
        ),
    ]

    cleaned = _clean_pdf_pages(pages)

    assert cleaned == [
        ("Section heading\nImportant body line A\nDetail A1\nDetail A2\nDetail A3\nDetail A4\nDetail A5", 1),
        ("Section heading\nImportant body line B\nDetail B1\nDetail B2\nDetail B3\nDetail B4\nDetail B5", 2),
        ("Section heading\nImportant body line C\nDetail C1\nDetail C2\nDetail C3\nDetail C4\nDetail C5", 3),
    ]


def test_clean_pdf_pages_preserves_repeated_body_labels():
    pages = [
        (
            "Repeated header\n"
            "Expected outputs\n"
            "Target: 10 companies\n"
            "Repeated footer",
            1,
        ),
        (
            "Repeated header\n"
            "Expected outputs\n"
            "Target: 20 companies\n"
            "Repeated footer",
            2,
        ),
        (
            "Repeated header\n"
            "Expected outputs\n"
            "Target: 30 companies\n"
            "Repeated footer",
            3,
        ),
    ]

    cleaned = _clean_pdf_pages(pages)

    assert cleaned == [
        ("Expected outputs\nTarget: 10 companies", 1),
        ("Expected outputs\nTarget: 20 companies", 2),
        ("Expected outputs\nTarget: 30 companies", 3),
    ]


def test_resolve_document_file_type_accepts_pptx_and_iwork_extensions():
    assert resolve_document_file_type("", "deck.pptx") == "pptx"
    assert resolve_document_file_type("", "brief.pages") == "pages"
    assert resolve_document_file_type("", "slides.keynote") == "keynote"
    assert resolve_document_file_type("", "model.numbers") == "numbers"
    assert resolve_document_file_type("", "model.dwg") is None


def test_prepare_uploaded_document_converts_pages_to_docx_filename():
    with patch(
        "app.services.document_conversion._convert_with_libreoffice",
        return_value=b"converted",
    ):
        prepared = prepare_uploaded_document(b"raw", "Brief.pages", "pages")

    assert prepared.content == b"converted"
    assert prepared.filename == "Brief.docx"
    assert prepared.file_type == "docx"


def test_prepare_uploaded_document_converts_keynote_to_pptx_filename():
    with patch(
        "app.services.document_conversion._convert_with_libreoffice",
        return_value=b"converted",
    ):
        prepared = prepare_uploaded_document(b"raw", "Deck.key", "keynote")

    assert prepared.content == b"converted"
    assert prepared.filename == "Deck.pptx"
    assert prepared.file_type == "pptx"


def test_prepare_uploaded_document_converts_numbers_to_xlsx_filename():
    with patch(
        "app.services.document_conversion._convert_with_libreoffice",
        return_value=b"converted",
    ):
        prepared = prepare_uploaded_document(b"raw", "Budget.numbers", "numbers")

    assert prepared.content == b"converted"
    assert prepared.filename == "Budget.xlsx"
    assert prepared.file_type == "xlsx"


def test_parse_pptx_extracts_slide_text():
    from pptx import Presentation

    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[5])
    slide.shapes.title.text = "Project Overview"
    textbox = slide.shapes.add_textbox(0, 0, 1000000, 1000000)
    textbox.text = "Revenue case\nBase case"

    buf = io.BytesIO()
    presentation.save(buf)

    text = DocumentParserService().parse_pptx(buf.getvalue())

    assert "[Slide 1]" in text
    assert "Project Overview" in text
    assert "Revenue case" in text
