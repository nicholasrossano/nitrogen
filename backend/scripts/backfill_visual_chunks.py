"""Backfill cropped visual chunks for uploaded PDF evidence.

By default this only processes evidence owned by nar2175@columbia.edu.

Usage:
    cd backend
    python scripts/backfill_visual_chunks.py
    python scripts/backfill_visual_chunks.py --email someone@example.com
    python scripts/backfill_visual_chunks.py --force
"""

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import func, select, delete as sql_delete

from app.core.database import AsyncSessionLocal
from app.core.storage import get_uploads_storage
from app.models.evidence import EvidenceChunk, EvidenceDoc
from app.models.initiative import Initiative
from app.models.user import User
from app.services.embeddings import EmbeddingsService
from app.services.pdf_visual_chunks import extract_pdf_visual_chunks


async def backfill_visual_chunks(email: str, *, force: bool = False) -> None:
    storage = get_uploads_storage()
    processed = 0
    skipped = 0
    created = 0
    errors = 0

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(EvidenceDoc, Initiative)
            .join(Initiative, Initiative.id == EvidenceDoc.initiative_id)
            .join(User, User.id == Initiative.user_id)
            .where(
                User.email == email,
                EvidenceDoc.file_type == "pdf",
                EvidenceDoc.storage_path.isnot(None),
            )
            .order_by(EvidenceDoc.created_at)
        )
        docs = result.all()
        print(f"Found {len(docs)} PDF evidence docs for {email}")

        for doc, initiative in docs:
            existing_result = await db.execute(
                select(EvidenceChunk)
                .where(
                    EvidenceChunk.evidence_doc_id == doc.id,
                    EvidenceChunk.chunk_kind == "visual",
                )
            )
            existing_visual_chunks = existing_result.scalars().all()

            if existing_visual_chunks and not force:
                skipped += 1
                print(f"  [skip] {doc.filename}: already has visual chunks")
                continue

            if existing_visual_chunks and force:
                for chunk in existing_visual_chunks:
                    if chunk.preview_image_path:
                        await storage.delete(chunk.preview_image_path)
                await db.execute(
                    sql_delete(EvidenceChunk).where(
                        EvidenceChunk.evidence_doc_id == doc.id,
                        EvidenceChunk.chunk_kind == "visual",
                    )
                )
                await db.commit()

            try:
                file_bytes = await storage.load(doc.storage_path)
                visual_chunks = extract_pdf_visual_chunks(file_bytes)
            except Exception as exc:  # noqa: BLE001
                errors += 1
                print(f"  [error] {doc.filename}: {exc}")
                continue

            if not visual_chunks:
                skipped += 1
                print(f"  [none] {doc.filename}: no visual regions detected")
                continue

            max_idx_result = await db.execute(
                select(func.max(EvidenceChunk.chunk_index)).where(
                    EvidenceChunk.evidence_doc_id == doc.id
                )
            )
            next_idx = (max_idx_result.scalar() or -1) + 1
            embeddings_service = EmbeddingsService(user_id=initiative.user_id, db=db)
            embeddings = await embeddings_service.embed_texts(
                [chunk.content for chunk in visual_chunks]
            )

            for offset, (visual, embedding) in enumerate(zip(visual_chunks, embeddings)):
                preview_path = await storage.save(
                    visual.image_bytes,
                    f"visual-chunk-{offset}.png",
                    folder=f"{initiative.id}/previews",
                )
                db.add(
                    EvidenceChunk(
                        evidence_doc_id=doc.id,
                        chunk_index=next_idx + offset,
                        content=visual.content,
                        page_number=visual.page_number,
                        chunk_kind="visual",
                        bbox=visual.bbox,
                        preview_image_path=preview_path,
                        preview_mime_type=visual.mime_type,
                        embedding=embedding,
                    )
                )

            await db.commit()
            processed += 1
            created += len(visual_chunks)
            print(f"  [ok] {doc.filename}: added {len(visual_chunks)} visual chunks")

    print("\nDone")
    print(f"Processed docs: {processed}")
    print(f"Created chunks:  {created}")
    print(f"Skipped docs:    {skipped}")
    print(f"Errors:          {errors}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", default="nar2175@columbia.edu")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    asyncio.run(backfill_visual_chunks(args.email, force=args.force))


if __name__ == "__main__":
    main()
