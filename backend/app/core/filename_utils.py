import logging
import re
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.models.evidence import EvidenceDoc
from app.models.project_material import ProjectMaterial

_logger = logging.getLogger(__name__)

# Magic-byte signatures for common document types
_MAGIC_SIGNATURES: dict[str, list[bytes]] = {
    "application/pdf": [b"%PDF"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [b"PK\x03\x04"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [b"PK\x03\x04"],
    "application/vnd.ms-excel": [b"\xd0\xcf\x11\xe0"],
    "image/png": [b"\x89PNG"],
    "image/jpeg": [b"\xff\xd8\xff"],
}


def validate_file_magic(content: bytes, claimed_content_type: str) -> bool:
    """Return True if the first bytes of *content* match the expected magic bytes
    for *claimed_content_type*. Returns True (allow) for unknown types so the
    allowlist-based check in each endpoint remains the primary gate.
    """
    expected = _MAGIC_SIGNATURES.get(claimed_content_type)
    if not expected:
        return True
    for sig in expected:
        if content[:len(sig)] == sig:
            return True
    _logger.warning(
        "Magic-byte mismatch: claimed %s but header bytes %r",
        claimed_content_type,
        content[:8],
    )
    return False


def safe_content_disposition(filename: str, disposition: str = "attachment") -> str:
    """Build a Content-Disposition header value safe from injection.

    Uses RFC 5987 filename*= encoding so non-ASCII and special characters
    (quotes, newlines, semicolons) are handled correctly by all modern browsers.
    """
    ascii_safe = re.sub(r'[^\w \-.]', '_', filename).strip() or "file"
    encoded = quote(filename, safe='')
    return f'{disposition}; filename="{ascii_safe}"; filename*=UTF-8\'\'{encoded}'


async def deduplicate_filename(
    db: AsyncSession, initiative_id: UUID, filename: str
) -> str:
    """Return a unique filename within the initiative, appending (1), (2), ... if needed.

    Checks both evidence_docs and project_materials tables to avoid collisions
    across all uploaded files in a project.
    """
    ev_result = await db.execute(
        select(EvidenceDoc.filename).where(
            EvidenceDoc.initiative_id == initiative_id,
            EvidenceDoc.filename.isnot(None),
        )
    )
    mat_result = await db.execute(
        select(ProjectMaterial.filename).where(
            ProjectMaterial.initiative_id == initiative_id,
        )
    )
    existing = {
        (n or "").lower()
        for n in (*ev_result.scalars().all(), *mat_result.scalars().all())
    }

    if filename.lower() not in existing:
        return filename

    dot_idx = filename.rfind(".")
    stem = filename[:dot_idx] if dot_idx > 0 else filename
    ext = filename[dot_idx:] if dot_idx > 0 else ""

    counter = 1
    while True:
        candidate = f"{stem} ({counter}){ext}"
        if candidate.lower() not in existing:
            return candidate
        counter += 1
