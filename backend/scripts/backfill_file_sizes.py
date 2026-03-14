"""Backfill file_size for evidence_docs and project_materials where it is NULL."""
import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from sqlalchemy import select, update
from app.core.database import AsyncSessionLocal
from app.core.storage import get_uploads_storage
from app.models.evidence import EvidenceDoc
from app.models.project_material import ProjectMaterial


async def backfill():
    storage = get_uploads_storage()
    updated = 0
    errors = 0

    async with AsyncSessionLocal() as db:
        # --- Evidence docs ---
        result = await db.execute(
            select(EvidenceDoc).where(
                EvidenceDoc.file_size.is_(None),
                EvidenceDoc.storage_path.isnot(None),
            )
        )
        docs = result.scalars().all()
        print(f"Found {len(docs)} evidence_docs with null file_size")

        for doc in docs:
            try:
                content = await storage.load(doc.storage_path)
                doc.file_size = len(content)
                updated += 1
                print(f"  ✓ evidence_doc {doc.id} ({doc.filename}): {len(content):,} bytes")
            except Exception as e:
                errors += 1
                print(f"  ✗ evidence_doc {doc.id} ({doc.filename}): {e}")

        # --- Project materials ---
        result2 = await db.execute(
            select(ProjectMaterial).where(
                ProjectMaterial.file_size.is_(None),
                ProjectMaterial.storage_path.isnot(None),
            )
        )
        mats = result2.scalars().all()
        print(f"Found {len(mats)} project_materials with null file_size")

        for mat in mats:
            try:
                content = await storage.load(mat.storage_path)
                mat.file_size = len(content)
                updated += 1
                print(f"  ✓ material {mat.id} ({mat.filename}): {len(content):,} bytes")
            except Exception as e:
                errors += 1
                print(f"  ✗ material {mat.id} ({mat.filename}): {e}")

        await db.commit()

    print(f"\nDone. Updated: {updated}, Errors: {errors}")


if __name__ == '__main__':
    asyncio.run(backfill())
