"""Structured PDF text extraction via OpenDataLoader PDF.

OpenDataLoader (Apache-2.0) wraps a Java CLI that produces layout-aware output
with correct reading order, table structure, and per-element page numbers. We
use it as the primary text extractor because the legacy ``pdfplumber`` path
flattens tables and mis-orders multi-column pages.

This module is intentionally defensive: it converts to the same
``list[(page_text, page_number)]`` shape that :func:`parse_pdf_pages` already
returns, and returns ``None`` on *any* failure (missing package, no JRE on the
host, malformed output) so the caller can fall back to pdfplumber without the
upload pipeline ever hard-failing.
"""

from __future__ import annotations

import json
import logging
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

_MAX_HEADING_LEVEL = 6


def extract_pdf_pages_structured(file_bytes: bytes) -> list[tuple[str, int]] | None:
    """Return ``(page_text, page_number)`` pairs, or ``None`` to signal fallback.

    ``None`` means "use the legacy parser" — it is not an error the caller
    needs to handle beyond falling back. A structured result may still be an
    empty list if the PDF genuinely has no extractable text.
    """

    try:
        import opendataloader_pdf
    except Exception as exc:  # noqa: BLE001 — ImportError or transitive failure
        logger.info("opendataloader-pdf unavailable; using pdfplumber: %s", exc)
        return None

    try:
        with tempfile.TemporaryDirectory(prefix="odl-pdf-") as tmp:
            tmp_path = Path(tmp)
            input_path = tmp_path / "input.pdf"
            output_dir = tmp_path / "out"
            input_path.write_bytes(file_bytes)
            output_dir.mkdir(parents=True, exist_ok=True)

            # JSON carries per-element page numbers + table structure. Images are
            # handled separately by pdf_visual_chunks (PyMuPDF), so skip them here.
            opendataloader_pdf.convert(
                input_path=[str(input_path)],
                output_dir=str(output_dir),
                format="json",
                image_output="off",
                quiet=True,
            )

            doc = _load_output_json(output_dir)
            if doc is None:
                return None

            return _pages_from_document(doc)
    except FileNotFoundError as exc:
        # Typically "java" not on PATH — expected on hosts without a JRE.
        logger.warning("opendataloader-pdf could not run (no JRE?); using pdfplumber: %s", exc)
        return None
    except Exception as exc:  # noqa: BLE001 — never let parsing crash the pipeline
        logger.warning("opendataloader-pdf failed; using pdfplumber: %s", exc, exc_info=True)
        return None


def _load_output_json(output_dir: Path) -> dict | None:
    json_files = sorted(output_dir.rglob("*.json"))
    if not json_files:
        logger.warning("opendataloader-pdf produced no JSON output; using pdfplumber")
        return None
    try:
        with json_files[0].open(encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError) as exc:
        logger.warning("Could not read opendataloader-pdf JSON: %s", exc)
        return None
    return data if isinstance(data, dict) else None


def _pages_from_document(doc: dict) -> list[tuple[str, int]]:
    """Group rendered top-level elements by their page number, in reading order."""

    kids = doc.get("kids")
    if not isinstance(kids, list):
        return []

    ordered_pages: list[int] = []
    page_texts: dict[int, list[str]] = {}

    for element in kids:
        if not isinstance(element, dict):
            continue
        rendered = _render_element(element).strip()
        if not rendered:
            continue
        page = _element_page(element)
        if page not in page_texts:
            page_texts[page] = []
            ordered_pages.append(page)
        page_texts[page].append(rendered)

    pages: list[tuple[str, int]] = []
    for page in sorted(ordered_pages):
        text = "\n\n".join(page_texts[page]).strip()
        if text:
            pages.append((text, page))
    return pages


def _element_page(element: dict) -> int:
    """Best-effort 1-indexed page for an element (falls back to first descendant)."""
    page = element.get("page number")
    if isinstance(page, int) and page > 0:
        return page
    for child in _child_nodes(element):
        if isinstance(child, dict):
            found = _element_page(child)
            if found:
                return found
    return 1


def _child_nodes(element: dict) -> list:
    """Return the child collection regardless of which key the type uses."""
    for key in ("kids", "rows", "cells", "list items"):
        value = element.get(key)
        if isinstance(value, list):
            return value
    return []


def _render_element(element: dict) -> str:
    el_type = element.get("type", "")

    if el_type == "heading":
        level = element.get("heading level")
        prefix = "#" * min(int(level), _MAX_HEADING_LEVEL) if isinstance(level, int) and level > 0 else "#"
        return f"{prefix} {element.get('content', '').strip()}".strip()

    if el_type in ("paragraph", "caption", "list item", "formula"):
        return element.get("content", "").strip()

    if el_type == "table":
        return _render_table(element)

    if el_type == "list":
        return _render_list(element)

    # header/footer/text block/page wrappers and unknown types: recurse.
    parts = [
        _render_element(child)
        for child in _child_nodes(element)
        if isinstance(child, dict)
    ]
    joined = "\n\n".join(p for p in parts if p.strip())
    if joined.strip():
        return joined
    return element.get("content", "").strip()


def _render_list(element: dict) -> str:
    items = element.get("list items", [])
    ordered = str(element.get("numbering style", "")).lower() in ("ordered", "decimal", "number")
    lines: list[str] = []
    for idx, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            continue
        text = item.get("content", "").strip()
        nested = [
            _render_element(child)
            for child in item.get("kids", [])
            if isinstance(child, dict)
        ]
        nested_text = " ".join(n.strip() for n in nested if n.strip())
        full = f"{text} {nested_text}".strip()
        if not full:
            continue
        marker = f"{idx}." if ordered else "-"
        lines.append(f"{marker} {full}")
    return "\n".join(lines)


def _render_table(element: dict) -> str:
    rows = element.get("rows", [])
    rendered_rows: list[list[str]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        cells = row.get("cells", [])
        rendered_rows.append([_render_cell(cell) for cell in cells if isinstance(cell, dict)])

    rendered_rows = [r for r in rendered_rows if r]
    if not rendered_rows:
        return ""

    ncols = max(len(r) for r in rendered_rows)
    lines: list[str] = []
    for r_idx, row_cells in enumerate(rendered_rows):
        padded = row_cells + [""] * (ncols - len(row_cells))
        lines.append("| " + " | ".join(padded) + " |")
        if r_idx == 0:
            lines.append("| " + " | ".join(["---"] * ncols) + " |")
    return "\n".join(lines)


def _render_cell(cell: dict) -> str:
    parts = [
        _render_element(child)
        for child in cell.get("kids", [])
        if isinstance(child, dict)
    ]
    text = " ".join(p.strip() for p in parts if p.strip())
    # Cells must stay on one Markdown line and not break the pipe layout.
    return text.replace("\n", " ").replace("|", "\\|").strip()
