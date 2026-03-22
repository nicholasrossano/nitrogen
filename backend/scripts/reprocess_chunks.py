"""Backfill content_html and page_number for existing evidence and corpus chunks.

Re-parses original files from storage to extract rich content without
re-chunking or re-embedding.  Matches existing chunks by chunk_index.

Usage:
    cd backend
    python scripts/reprocess_chunks.py
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.storage import get_uploads_storage
from app.models.evidence import EvidenceDoc, EvidenceChunk
from app.models.corpus import CorpusDocument, CorpusChunk
from app.services.document_parser import DocumentParserService


async def reprocess_evidence():
    storage = get_uploads_storage()
    parser = DocumentParserService()
    updated = 0
    skipped = 0
    errors = 0

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(EvidenceDoc).where(EvidenceDoc.storage_path.isnot(None))
        )
        docs = result.scalars().all()
        print(f"Found {len(docs)} evidence docs with files")

        for doc in docs:
            try:
                content = await storage.load(doc.storage_path)
            except Exception as e:
                errors += 1
                print(f"  [skip] evidence {doc.id} ({doc.filename}): file not found — {e}")
                continue

            ft = doc.file_type or ""

            chunks_result = await db.execute(
                select(EvidenceChunk)
                .where(EvidenceChunk.evidence_doc_id == doc.id)
                .order_by(EvidenceChunk.chunk_index)
            )
            chunks = chunks_result.scalars().all()

            if ft == "pdf":
                pages = parser.parse_pdf_pages(content)
                page_chunks = parser.chunk_pdf_pages(pages)
                for chunk in chunks:
                    if chunk.chunk_index < len(page_chunks):
                        _, pg = page_chunks[chunk.chunk_index]
                        chunk.page_number = pg
                updated += 1
                print(f"  [pdf]  evidence {doc.id} ({doc.filename}): {len(chunks)} chunks updated with page numbers")

            elif ft == "docx":
                html = parser.parse_docx_html(content)
                html_chunks = parser.chunk_html(html)
                for chunk in chunks:
                    if chunk.chunk_index < len(html_chunks):
                        _, h = html_chunks[chunk.chunk_index]
                        chunk.content_html = h
                updated += 1
                print(f"  [docx] evidence {doc.id} ({doc.filename}): {len(chunks)} chunks updated with HTML")

            elif ft in ("xlsx", "xls"):
                html = parser.parse_xlsx_html(content)
                html_chunks = parser.chunk_html(html)
                for chunk in chunks:
                    if chunk.chunk_index < len(html_chunks):
                        _, h = html_chunks[chunk.chunk_index]
                        chunk.content_html = h
                updated += 1
                print(f"  [xlsx] evidence {doc.id} ({doc.filename}): {len(chunks)} chunks updated with HTML")

            else:
                skipped += 1

        await db.commit()

    print(f"\nEvidence: updated {updated}, skipped {skipped}, errors {errors}")
    return updated, skipped, errors


async def reprocess_corpus():
    storage = get_uploads_storage()
    parser = DocumentParserService()
    updated = 0
    skipped = 0
    errors = 0

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(CorpusDocument).where(CorpusDocument.storage_path.isnot(None))
        )
        docs = result.scalars().all()
        print(f"\nFound {len(docs)} corpus docs with files")

        for doc in docs:
            try:
                content = await storage.load(doc.storage_path)
            except Exception as e:
                errors += 1
                print(f"  [skip] corpus {doc.id} ({doc.title}): file not found — {e}")
                continue

            ft = doc.file_type or ""

            chunks_result = await db.execute(
                select(CorpusChunk)
                .where(CorpusChunk.corpus_doc_id == doc.id)
                .order_by(CorpusChunk.chunk_index)
            )
            chunks = chunks_result.scalars().all()

            if ft == "pdf":
                pages = parser.parse_pdf_pages(content)
                page_chunks = parser.chunk_pdf_pages(pages)
                for chunk in chunks:
                    if chunk.chunk_index < len(page_chunks):
                        _, pg = page_chunks[chunk.chunk_index]
                        chunk.page_number = pg
                updated += 1
                print(f"  [pdf]  corpus {doc.id} ({doc.title}): {len(chunks)} chunks updated with page numbers")

            elif ft == "docx":
                html = parser.parse_docx_html(content)
                html_chunks = parser.chunk_html(html)
                for chunk in chunks:
                    if chunk.chunk_index < len(html_chunks):
                        _, h = html_chunks[chunk.chunk_index]
                        chunk.content_html = h
                updated += 1
                print(f"  [docx] corpus {doc.id} ({doc.title}): {len(chunks)} chunks updated with HTML")

            else:
                skipped += 1

        await db.commit()

    print(f"Corpus: updated {updated}, skipped {skipped}, errors {errors}")
    return updated, skipped, errors


async def main():
    print("=== Reprocessing chunks for content_html / page_number ===\n")
    e_up, e_sk, e_err = await reprocess_evidence()
    c_up, c_sk, c_err = await reprocess_corpus()
    print("\n=== Done ===")
    print(f"Total updated: {e_up + c_up}")
    print(f"Total skipped: {e_sk + c_sk}")
    print(f"Total errors:  {e_err + c_err}")


if __name__ == '__main__':
    asyncio.run(main())
