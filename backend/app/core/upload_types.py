from __future__ import annotations

from pathlib import Path


PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
XLS_MIME = "application/vnd.ms-excel"
PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
PAGES_MIME = "application/vnd.apple.pages"
KEYNOTE_MIME = "application/vnd.apple.keynote"
NUMBERS_MIME = "application/vnd.apple.numbers"


DOCUMENT_CONTENT_TYPES = {
    PDF_MIME: "pdf",
    DOCX_MIME: "docx",
    XLSX_MIME: "xlsx",
    XLS_MIME: "xls",
    PPTX_MIME: "pptx",
    PAGES_MIME: "pages",
    "application/x-iwork-pages-sffpages": "pages",
    "application/vnd.apple.iwork.pages.sffpages": "pages",
    KEYNOTE_MIME: "keynote",
    "application/x-iwork-keynote-sffkey": "keynote",
    "application/vnd.apple.iwork.keynote.sffkey": "keynote",
    NUMBERS_MIME: "numbers",
    "application/x-iwork-numbers-sffnumbers": "numbers",
    "application/vnd.apple.iwork.numbers.sffnumbers": "numbers",
}

DOCUMENT_EXTENSION_TYPES = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".xlsx": "xlsx",
    ".xls": "xls",
    ".pptx": "pptx",
    ".pages": "pages",
    ".key": "keynote",
    ".keynote": "keynote",
    ".numbers": "numbers",
}

FILE_TYPE_CONTENT_TYPES = {
    "pdf": PDF_MIME,
    "docx": DOCX_MIME,
    "xlsx": XLSX_MIME,
    "xls": XLS_MIME,
    "pptx": PPTX_MIME,
    "pages": PAGES_MIME,
    "keynote": KEYNOTE_MIME,
    "numbers": NUMBERS_MIME,
}


def resolve_document_file_type(content_type: str | None, filename: str | None) -> str | None:
    """Resolve an upload to an internal document file type using MIME, then extension."""

    if content_type and content_type in DOCUMENT_CONTENT_TYPES:
        return DOCUMENT_CONTENT_TYPES[content_type]
    extension = Path(filename or "").suffix.lower()
    return DOCUMENT_EXTENSION_TYPES.get(extension)


def content_type_for_file_type(file_type: str) -> str | None:
    return FILE_TYPE_CONTENT_TYPES.get(file_type)
