"""
Diagnostic script to check RAG system for a specific initiative.
Run with: python debug_rag.py <initiative_id>
"""

import asyncio
import sys
from uuid import UUID
from sqlalchemy import select, func, text
from app.core.database import AsyncSessionLocal
from app.models.initiative import Initiative
from app.models.evidence import EvidenceDoc, EvidenceChunk
from app.models.memo import MemoVersion
from app.services.rag import RAGService


async def diagnose_rag(initiative_id_str: str):
    """Diagnose RAG for an initiative"""
    try:
        initiative_id = UUID(initiative_id_str)
    except ValueError:
        print(f"❌ Invalid UUID: {initiative_id_str}")
        return
    
    async with AsyncSessionLocal() as db:
        # 1. Check initiative exists
        result = await db.execute(
            select(Initiative).where(Initiative.id == initiative_id)
        )
        initiative = result.scalar_one_or_none()
        
        if not initiative:
            print(f"❌ Initiative {initiative_id} not found")
            return
        
        print(f"✅ Initiative: {initiative.title or 'Untitled'}")
        print(f"   Description: {(initiative.project_description or 'None')[:100]}...")
        print(f"   Evidence ready: {initiative.evidence_ready}")
        print()
        
        # 2. Check evidence documents
        docs_result = await db.execute(
            select(EvidenceDoc).where(EvidenceDoc.initiative_id == initiative_id)
        )
        docs = docs_result.scalars().all()
        
        print(f"📄 Evidence documents: {len(docs)}")
        for doc in docs:
            chunk_count_result = await db.execute(
                select(func.count(EvidenceChunk.id)).where(
                    EvidenceChunk.evidence_doc_id == doc.id
                )
            )
            chunk_count = chunk_count_result.scalar() or 0
            print(f"   - {doc.filename} ({doc.file_type}): {chunk_count} chunks")
        print()
        
        # 3. Test RAG retrieval
        if docs:
            print("🔍 Testing RAG retrieval...")
            rag = RAGService(db)
            
            test_queries = [
                "What is this project about?",
                "What evidence supports this initiative?",
                "What are the key outcomes expected?",
            ]
            
            for query in test_queries:
                print(f"\n   Query: '{query}'")
                chunks = await rag.retrieve(
                    query=query,
                    initiative_id=initiative_id,
                    sources=["evidence", "corpus"],
                    evidence_top_k=3,
                    corpus_top_k=5,
                )
                
                if chunks:
                    print(f"   ✅ Found {len(chunks)} chunks:")
                    for chunk in chunks[:3]:  # Show top 3
                        print(f"      - [{chunk.source_type}] {chunk.source_title}")
                        print(f"        Similarity: {chunk.similarity:.3f}")
                        print(f"        Content: {chunk.content[:100]}...")
                else:
                    print(f"   ❌ No chunks found")
        else:
            print("⚠️  No evidence documents to test retrieval")
        
        print()
        
        # 4. Check memo versions
        memo_result = await db.execute(
            select(MemoVersion)
            .where(MemoVersion.initiative_id == initiative_id)
            .order_by(MemoVersion.created_at.desc())
        )
        memos = memo_result.scalars().all()
        
        print(f"📝 Memo versions: {len(memos)}")
        if memos:
            latest = memos[0]
            content = latest.content
            citations = content.get("citations", [])
            print(f"   Latest memo:")
            print(f"   - Created: {latest.created_at}")
            print(f"   - Citations: {len(citations)}")
            if citations:
                for citation in citations[:3]:  # Show first 3
                    print(f"      [{citation['number']}] {citation['source_type']}: {citation['source_title']}")
            else:
                print(f"   ❌ No citations in latest memo")
        print()
        
        # 5. Check embeddings are actually created
        if docs:
            sample_chunk_result = await db.execute(
                select(EvidenceChunk)
                .where(EvidenceChunk.evidence_doc_id.in_([d.id for d in docs]))
                .limit(1)
            )
            sample_chunk = sample_chunk_result.scalar_one_or_none()
            
            if sample_chunk:
                if sample_chunk.embedding is not None:
                    print(f"✅ Sample chunk has embedding (dim: {len(sample_chunk.embedding)})")
                else:
                    print(f"❌ Sample chunk has NULL embedding!")
            print()
        
        # 6. Test vector search directly
        if docs:
            print("🧪 Testing raw vector search...")
            # Get a sample query embedding
            from app.services.embeddings import EmbeddingsService
            embeddings_service = EmbeddingsService()
            query_embedding = await embeddings_service.embed_text("project goals and outcomes")
            
            embedding_str = f"[{','.join(map(str, query_embedding))}]"
            doc_ids = [doc.id for doc in docs]
            
            query_sql = text("""
                SELECT 
                    id,
                    evidence_doc_id,
                    content,
                    1 - (embedding <=> CAST(:embedding AS vector)) as similarity
                FROM evidence_chunks
                WHERE evidence_doc_id = ANY(:doc_ids)
                ORDER BY embedding <=> CAST(:embedding AS vector)
                LIMIT 5
            """)
            
            result = await db.execute(
                query_sql,
                {
                    "embedding": embedding_str,
                    "doc_ids": doc_ids,
                }
            )
            rows = result.fetchall()
            
            print(f"   Found {len(rows)} results from vector search:")
            for row in rows:
                print(f"   - Similarity: {row.similarity:.3f}")
                print(f"     Content: {row.content[:100]}...")
            print()


async def list_recent_initiatives():
    """List recent initiatives to help find the right ID"""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Initiative)
            .order_by(Initiative.updated_at.desc())
            .limit(10)
        )
        initiatives = result.scalars().all()
        
        print("Recent initiatives:")
        for init in initiatives:
            print(f"  {init.id}")
            print(f"    Title: {init.title or 'Untitled'}")
            print(f"    Updated: {init.updated_at}")
            print()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python debug_rag.py <initiative_id>")
        print("Or: python debug_rag.py --list")
        sys.exit(1)
    
    if sys.argv[1] == "--list":
        asyncio.run(list_recent_initiatives())
    else:
        asyncio.run(diagnose_rag(sys.argv[1]))
