from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.models.evidence import EvidenceDoc
from app.models.project_material import ProjectMaterial


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
