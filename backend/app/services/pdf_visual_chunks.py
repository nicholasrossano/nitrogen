"""Extract cropped visual regions from PDFs for citation previews."""

from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PdfVisualChunk:
    page_number: int
    bbox: dict
    content: str
    image_bytes: bytes
    mime_type: str = "image/png"


def extract_pdf_visual_chunks(
    file_bytes: bytes,
    *,
    max_chunks: int = 8,
    max_regions_per_page: int = 2,
) -> list[PdfVisualChunk]:
    """Return cropped visual regions from a PDF.

    This intentionally extracts element-sized regions, not page thumbnails. It
    handles embedded raster images and vector-heavy figure/table regions. If a
    PDF exposes no reliable visual regions, it returns an empty list and the
    normal text/html citation path remains unchanged.
    """

    try:
        import fitz  # PyMuPDF
    except Exception as exc:  # noqa: BLE001
        logger.warning("PyMuPDF unavailable; skipping visual PDF chunks: %s", exc)
        return []

    visual_chunks: list[PdfVisualChunk] = []

    try:
        with fitz.open(stream=file_bytes, filetype="pdf") as doc:
            for page_idx, page in enumerate(doc):
                if len(visual_chunks) >= max_chunks:
                    break

                page_rect = page.rect
                text_blocks = _text_blocks(page)
                candidates = _visual_region_candidates(page, page_rect)
                candidates = _merge_overlapping_rects(candidates, page_rect)

                for rect in candidates[:max_regions_per_page]:
                    if len(visual_chunks) >= max_chunks:
                        break

                    crop_text = _text_for_rect(text_blocks, rect)
                    if not crop_text:
                        crop_text = _nearby_text_for_rect(text_blocks, rect)
                    label = f"Visual element from page {page_idx + 1}"
                    content = f"{label}\n\n{crop_text}".strip()

                    try:
                        pix = page.get_pixmap(
                            matrix=fitz.Matrix(2, 2),
                            clip=rect,
                            alpha=False,
                        )
                        if pix.width < 80 or pix.height < 80:
                            continue
                        image_bytes = pix.tobytes("png")
                    except Exception as exc:  # noqa: BLE001
                        logger.debug(
                            "Skipping PDF visual crop on page %s: %s",
                            page_idx + 1,
                            exc,
                        )
                        continue

                    visual_chunks.append(
                        PdfVisualChunk(
                            page_number=page_idx + 1,
                            bbox={
                                "x0": round(float(rect.x0), 2),
                                "y0": round(float(rect.y0), 2),
                                "x1": round(float(rect.x1), 2),
                                "y1": round(float(rect.y1), 2),
                            },
                            content=content,
                            image_bytes=image_bytes,
                        )
                    )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to extract PDF visual chunks: %s", exc, exc_info=True)

    return visual_chunks


def _text_blocks(page) -> list[tuple[object, str]]:
    blocks = []
    rect_cls = page.rect.__class__
    for block in page.get_text("blocks"):
        if len(block) < 5:
            continue
        text = str(block[4]).strip()
        if not text:
            continue
        blocks.append((rect_cls(block[:4]), text))
    return blocks


def _visual_region_candidates(page, page_rect) -> list[object]:
    candidates = []

    for image in page.get_images(full=True):
        xref = image[0]
        for rect in page.get_image_rects(xref):
            expanded = _expand_rect(rect, page_rect, margin=8)
            if _is_candidate_rect(expanded, page_rect, min_area_ratio=0.02):
                candidates.append(expanded)

    drawing_rects = []
    for drawing in page.get_drawings():
        rect = drawing.get("rect")
        if rect is None or rect.is_empty:
            continue
        if rect.get_area() < 16:
            continue
        drawing_rects.append(rect)

    if len(drawing_rects) >= 6:
        union = _rect_union(drawing_rects)
        expanded = _expand_rect(union, page_rect, margin=12)
        if _is_candidate_rect(expanded, page_rect, min_area_ratio=0.04):
            candidates.append(expanded)

    return candidates


def _is_candidate_rect(
    rect,
    page_rect,
    *,
    min_area_ratio: float,
    max_area_ratio: float = 0.75,
) -> bool:
    page_area = page_rect.get_area() or 1
    ratio = rect.get_area() / page_area
    if ratio < min_area_ratio or ratio > max_area_ratio:
        return False
    if rect.width < 72 or rect.height < 72:
        return False
    if rect.width / (page_rect.width or 1) > 0.96 and rect.height / (page_rect.height or 1) > 0.9:
        return False
    return True


def _expand_rect(rect, page_rect, *, margin: float):
    expanded = rect + (-margin, -margin, margin, margin)
    return expanded & page_rect


def _rect_union(rects: list[object]):
    union = rects[0]
    for rect in rects[1:]:
        union = union | rect
    return union


def _merge_overlapping_rects(rects: list[object], page_rect) -> list[object]:
    merged: list[object] = []
    for rect in sorted(rects, key=lambda r: r.get_area(), reverse=True):
        if any(_intersection_ratio(rect, existing) > 0.55 for existing in merged):
            continue
        if _is_candidate_rect(rect, page_rect, min_area_ratio=0.02):
            merged.append(rect)
    return sorted(merged, key=lambda r: (r.y0, r.x0))


def _intersection_ratio(a, b) -> float:
    inter = a & b
    if inter.is_empty:
        return 0.0
    return inter.get_area() / max(1.0, min(a.get_area(), b.get_area()))


def _text_for_rect(text_blocks: list[tuple[object, str]], rect) -> str:
    parts = []
    for block_rect, text in text_blocks:
        center_x = (block_rect.x0 + block_rect.x1) / 2
        center_y = (block_rect.y0 + block_rect.y1) / 2
        center_in_rect = (
            rect.x0 <= center_x <= rect.x1 and rect.y0 <= center_y <= rect.y1
        )
        if center_in_rect or _intersection_ratio(block_rect, rect) > 0.15:
            parts.append(text)
    return "\n".join(parts).strip()[:2500]


def _nearby_text_for_rect(text_blocks: list[tuple[object, str]], rect) -> str:
    nearby = []
    for block_rect, text in text_blocks:
        vertically_close = (
            0 <= block_rect.y0 - rect.y1 <= 64
            or 0 <= rect.y0 - block_rect.y1 <= 64
        )
        horizontally_overlap = not (
            block_rect.x1 < rect.x0 or block_rect.x0 > rect.x1
        )
        if vertically_close and horizontally_overlap:
            nearby.append(text)
    return "\n".join(nearby).strip()[:1000]
