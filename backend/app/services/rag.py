from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from uuid import UUID
from dataclasses import dataclass
from typing import Literal

from app.models.evidence import EvidenceDoc
from app.services.embeddings import EmbeddingsService
from app.config import get_settings

settings = get_settings()


@dataclass
class RetrievedChunk:
    """A chunk retrieved from RAG"""
    chunk_id: UUID
    content: str
    source_type: Literal["evidence", "workspace_evidence"]
    source_doc_id: UUID
    source_title: str
    similarity: float
    chunk_index: int | None = None


class RAGService:
    """Service for retrieval-augmented generation"""

    def __init__(self, db: AsyncSession, user_id: str | None = None):
        self.db = db
        self.user_id = user_id
        self.embeddings = EmbeddingsService(user_id=user_id, db=db)
        self.top_k = settings.retrieval_top_k
    
    async def retrieve(
        self,
        query: str,
        project_id: UUID | None,
        workspace_id: UUID | None = None,
        sources: list[str] = ["evidence"],
        evidence_top_k: int = 3,
        workspace_top_k: int = 3,
        workspace_file_ids: list[UUID] | None = None,
    ) -> list[RetrievedChunk]:
        """
        Retrieve relevant chunks from multiple sources.
        
        Args:
            query: The query to search for
            project_id: The initiative ID (for project evidence filtering)
            workspace_id: Workspace ID for workspace-level evidence filtering
            sources: Which sources to search ("evidence", "workspace_evidence")
            evidence_top_k: Number of chunks to retrieve from evidence
        
        Returns:
            List of retrieved chunks sorted by similarity
        """
        # Generate query embedding
        query_embedding = await self.embeddings.embed_text(query)

        # Run searches sequentially on the shared session — asyncio.gather over the
        # same AsyncSession causes an InvalidRequestError when the session has not
        # yet provisioned its first connection (which happens in compare mode where
        # each project search gets a brand-new AsyncSessionLocal()).
        results = []
        if "evidence" in sources and project_id is not None:
            results.extend(await self._search_evidence(query_embedding, project_id, evidence_top_k))
        if "workspace_evidence" in sources and workspace_id is not None:
            results.extend(
                await self._search_workspace_evidence(
                    query_embedding,
                    workspace_id,
                    workspace_top_k,
                    workspace_file_ids=workspace_file_ids,
                )
            )
        
        # Sort by similarity (descending) and deduplicate
        results.sort(key=lambda x: x.similarity, reverse=True)
        
        return results
    
    async def _search_evidence(
        self,
        query_embedding: list[float],
        project_id: UUID,
        top_k: int,
    ) -> list[RetrievedChunk]:
        """Search evidence chunks for an initiative"""
        # Get evidence doc IDs for this initiative
        docs_result = await self.db.execute(
            select(EvidenceDoc).where(EvidenceDoc.project_id == project_id)
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

    async def _search_workspace_evidence(
        self,
        query_embedding: list[float],
        workspace_id: UUID,
        top_k: int,
        *,
        workspace_file_ids: list[UUID] | None = None,
    ) -> list[RetrievedChunk]:
        """Search workspace-level evidence chunks without crossing project scopes."""
        stmt = select(EvidenceDoc).where(
            EvidenceDoc.workspace_id == workspace_id,
            EvidenceDoc.project_id.is_(None),
        )
        if workspace_file_ids:
            stmt = stmt.where(EvidenceDoc.id.in_(workspace_file_ids))
        docs_result = await self.db.execute(stmt)
        docs = {doc.id: doc for doc in docs_result.scalars().all()}
        if not docs:
            return []

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
                "doc_ids": list(docs.keys()),
                "top_k": top_k,
            },
        )
        rows = result.fetchall()
        return [
            RetrievedChunk(
                chunk_id=row.id,
                content=row.content,
                source_type="workspace_evidence",
                source_doc_id=row.evidence_doc_id,
                source_title=docs[row.evidence_doc_id].filename or "Workspace file",
                similarity=row.similarity,
                chunk_index=row.chunk_index,
            )
            for row in rows
        ]
    
    async def retrieve_for_memo_sections(
        self,
        project_id: UUID,
    ) -> dict[str, list[RetrievedChunk]]:
        """
        Retrieve chunks for each memo section.
        
        Returns a dict mapping section names to relevant chunks.
        """
        sources = ["evidence"]
        
        # Different queries for different sections
        section_queries = {
            "executive_summary": "What is the main goal and approach of this initiative? What are the key outcomes expected?",
            "recommendation": "What evidence supports or challenges this initiative? What are the success factors?",
            "evidence_summary": "What evidence exists about similar interventions? What were the outcomes and lessons learned?",
            "risks_and_assumptions": "What are the risks, challenges, and assumptions? What could go wrong?",
        }
        
        import asyncio

        async def _fetch_section(section: str, query: str) -> tuple[str, list[RetrievedChunk]]:
            chunks = await self.retrieve(
                query=query,
                project_id=project_id,
                sources=sources,
                evidence_top_k=3,
            )
            return section, chunks

        pairs = await asyncio.gather(
            *[_fetch_section(s, q) for s, q in section_queries.items()]
        )
        return dict(pairs)
