from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from uuid import UUID
from dataclasses import dataclass
from typing import Literal

from app.models.evidence import EvidenceDoc, EvidenceChunk
from app.models.corpus import CorpusDocument, CorpusChunk
from app.services.embeddings import EmbeddingsService
from app.config import get_settings

settings = get_settings()


@dataclass
class RetrievedChunk:
    """A chunk retrieved from RAG"""
    chunk_id: UUID
    content: str
    source_type: Literal["evidence", "corpus"]
    source_doc_id: UUID
    source_title: str
    similarity: float
    chunk_index: int | None = None


class RAGService:
    """Service for retrieval-augmented generation"""
    
    def __init__(self, db: AsyncSession):
        self.db = db
        self.embeddings = EmbeddingsService()
        self.top_k = settings.retrieval_top_k
    
    async def retrieve(
        self,
        query: str,
        initiative_id: UUID,
        sources: list[str] = ["evidence", "corpus"],
        evidence_top_k: int = 3,
        corpus_top_k: int = 5,
    ) -> list[RetrievedChunk]:
        """
        Retrieve relevant chunks from multiple sources.
        
        Args:
            query: The query to search for
            initiative_id: The initiative ID (for evidence filtering)
            sources: Which sources to search ("evidence", "corpus", or both)
            evidence_top_k: Number of chunks to retrieve from evidence
            corpus_top_k: Number of chunks to retrieve from corpus
        
        Returns:
            List of retrieved chunks sorted by similarity
        """
        # Generate query embedding
        query_embedding = await self.embeddings.embed_text(query)
        
        results = []
        
        # Search evidence chunks
        if "evidence" in sources:
            evidence_results = await self._search_evidence(
                query_embedding, 
                initiative_id, 
                evidence_top_k
            )
            results.extend(evidence_results)
        
        # Search corpus chunks
        if "corpus" in sources:
            corpus_results = await self._search_corpus(
                query_embedding, 
                corpus_top_k
            )
            results.extend(corpus_results)
        
        # Sort by similarity (descending) and deduplicate
        results.sort(key=lambda x: x.similarity, reverse=True)
        
        return results
    
    async def _search_evidence(
        self,
        query_embedding: list[float],
        initiative_id: UUID,
        top_k: int,
    ) -> list[RetrievedChunk]:
        """Search evidence chunks for an initiative"""
        # Get evidence doc IDs for this initiative
        docs_result = await self.db.execute(
            select(EvidenceDoc).where(EvidenceDoc.initiative_id == initiative_id)
        )
        docs = {doc.id: doc for doc in docs_result.scalars().all()}
        
        if not docs:
            return []
        
        doc_ids = list(docs.keys())
        
        # Vector similarity search
        embedding_str = f"[{','.join(map(str, query_embedding))}]"
        
        query = text("""
            SELECT 
                id,
                evidence_doc_id,
                chunk_index,
                content,
                1 - (embedding <=> CAST(:embedding AS vector)) as similarity
            FROM evidence_chunks
            WHERE evidence_doc_id = ANY(:doc_ids)
            ORDER BY embedding <=> CAST(:embedding AS vector)
            LIMIT :top_k
        """)
        
        result = await self.db.execute(
            query,
            {
                "embedding": embedding_str,
                "doc_ids": doc_ids,
                "top_k": top_k,
            }
        )
        rows = result.fetchall()
        
        return [
            RetrievedChunk(
                chunk_id=row.id,
                content=row.content,
                source_type="evidence",
                source_doc_id=row.evidence_doc_id,
                source_title=docs[row.evidence_doc_id].filename or "Uploaded evidence",
                similarity=row.similarity,
                chunk_index=row.chunk_index,
            )
            for row in rows
        ]
    
    async def _search_corpus(
        self,
        query_embedding: list[float],
        top_k: int,
    ) -> list[RetrievedChunk]:
        """Search corpus chunks"""
        # Vector similarity search
        embedding_str = f"[{','.join(map(str, query_embedding))}]"
        
        query = text("""
            SELECT 
                c.id,
                c.corpus_doc_id,
                c.content,
                1 - (c.embedding <=> CAST(:embedding AS vector)) as similarity,
                d.title,
                d.source
            FROM corpus_chunks c
            JOIN corpus_documents d ON c.corpus_doc_id = d.id
            ORDER BY c.embedding <=> CAST(:embedding AS vector)
            LIMIT :top_k
        """)
        
        result = await self.db.execute(
            query,
            {
                "embedding": embedding_str,
                "top_k": top_k,
            }
        )
        rows = result.fetchall()
        
        return [
            RetrievedChunk(
                chunk_id=row.id,
                content=row.content,
                source_type="corpus",
                source_doc_id=row.corpus_doc_id,
                source_title=f"{row.title}" + (f" ({row.source})" if row.source else ""),
                similarity=row.similarity,
            )
            for row in rows
        ]
    
    async def retrieve_for_memo_sections(
        self,
        initiative_id: UUID,
        include_corpus: bool = True,
    ) -> dict[str, list[RetrievedChunk]]:
        """
        Retrieve chunks for each memo section.
        
        Returns a dict mapping section names to relevant chunks.
        """
        sources = ["evidence"]
        if include_corpus:
            sources.append("corpus")
        
        # Different queries for different sections
        section_queries = {
            "executive_summary": "What is the main goal and approach of this initiative? What are the key outcomes expected?",
            "recommendation": "What evidence supports or challenges this initiative? What are the success factors?",
            "evidence_summary": "What evidence exists about similar interventions? What were the outcomes and lessons learned?",
            "risks_and_assumptions": "What are the risks, challenges, and assumptions? What could go wrong?",
        }
        
        results = {}
        for section, query in section_queries.items():
            chunks = await self.retrieve(
                query=query,
                initiative_id=initiative_id,
                sources=sources,
                evidence_top_k=3,
                corpus_top_k=4 if include_corpus else 0,
            )
            results[section] = chunks
        
        return results
