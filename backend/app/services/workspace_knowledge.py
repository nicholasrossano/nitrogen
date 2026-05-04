from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import logging
from urllib.parse import urlparse
from uuid import UUID

from openai import AsyncOpenAI
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.llm_client import get_openai_client, record_usage_from_response
from app.models.workspace_knowledge import (
    WorkspaceKnowledgeBank,
    WorkspaceKnowledgeBankStatus,
    WorkspaceKnowledgeChunk,
)
from app.services.embeddings import EmbeddingsService

settings = get_settings()
logger = logging.getLogger(__name__)


@dataclass
class WorkspaceKnowledgeMatch:
    content: str
    source_title: str
    source_url: str | None
    similarity: float
    bank_name: str


class WorkspaceKnowledgeService:
    def __init__(self, db: AsyncSession, user_id: str | None = None):
        self.db = db
        self.user_id = user_id
        self.embeddings = EmbeddingsService(user_id=user_id, db=db)
        self._client: AsyncOpenAI | None = None
        self._is_byok: bool = False

    async def _get_client(self) -> AsyncOpenAI:
        if self._client is None:
            self._client, self._is_byok = await get_openai_client(self.user_id, self.db)
        return self._client

    async def index_knowledge_bank(self, bank: WorkspaceKnowledgeBank, max_chunks: int = 24) -> int:
        """Build/update an embedded snippet index for a workspace knowledge bank."""
        base_host = (urlparse(bank.base_url).netloc or "").lower().lstrip("www.")
        if not base_host:
            raise ValueError("Knowledge bank URL must include a valid domain")

        bank.status = WorkspaceKnowledgeBankStatus.INDEXING.value
        bank.index_error = None
        await self.db.flush()

        try:
            snippets = await self._fetch_bank_snippets(bank.base_url, base_host, max_chunks=max_chunks)
            if not snippets:
                bank.status = WorkspaceKnowledgeBankStatus.FAILED.value
                bank.index_error = "No crawlable snippets found for this URL."
                await self.db.flush()
                return 0

            contents = [snippet["content"] for snippet in snippets]
            vectors = await self.embeddings.embed_texts(contents)

            await self.db.execute(
                delete(WorkspaceKnowledgeChunk).where(
                    WorkspaceKnowledgeChunk.knowledge_bank_id == bank.id
                )
            )

            for idx, (snippet, vector) in enumerate(zip(snippets, vectors)):
                self.db.add(
                    WorkspaceKnowledgeChunk(
                        knowledge_bank_id=bank.id,
                        chunk_index=idx,
                        content=snippet["content"],
                        source_title=snippet["source_title"],
                        source_url=snippet.get("source_url"),
                        embedding=vector,
                    )
                )

            bank.status = WorkspaceKnowledgeBankStatus.READY.value
            bank.last_indexed_at = datetime.now(timezone.utc)
            bank.index_error = None
            await self.db.flush()
            return len(snippets)
        except Exception as exc:
            logger.error("Knowledge bank indexing failed: %s", exc, exc_info=True)
            bank.status = WorkspaceKnowledgeBankStatus.FAILED.value
            bank.index_error = str(exc)
            await self.db.flush()
            raise

    async def search(
        self,
        workspace_id: UUID,
        query: str,
        top_k: int = 6,
    ) -> list[WorkspaceKnowledgeMatch]:
        """Similarity search across active, indexed knowledge bank chunks for a workspace."""
        query_embedding = await self.embeddings.embed_text(query)
        embedding_str = f"[{','.join(map(str, query_embedding))}]"
        stmt = text(
            """
            SELECT
                c.content,
                c.source_title,
                c.source_url,
                b.name AS bank_name,
                1 - (c.embedding <=> CAST(:embedding AS vector)) AS similarity
            FROM workspace_knowledge_chunks c
            JOIN workspace_knowledge_banks b ON c.knowledge_bank_id = b.id
            WHERE b.workspace_id = :workspace_id
              AND b.is_active = true
              AND b.status = 'ready'
            ORDER BY c.embedding <=> CAST(:embedding AS vector)
            LIMIT :top_k
            """
        )
        result = await self.db.execute(
            stmt,
            {
                "workspace_id": workspace_id,
                "embedding": embedding_str,
                "top_k": top_k,
            },
        )
        rows = result.fetchall()
        return [
            WorkspaceKnowledgeMatch(
                content=row.content,
                source_title=row.source_title,
                source_url=row.source_url,
                similarity=row.similarity,
                bank_name=row.bank_name,
            )
            for row in rows
        ]

    async def _fetch_bank_snippets(
        self,
        base_url: str,
        base_host: str,
        *,
        max_chunks: int,
    ) -> list[dict[str, str]]:
        client = await self._get_client()
        response = await client.responses.create(
            model=settings.openai_orchestration_model,
            tools=[{"type": "web_search", "search_context_size": "high"}],
            input=(
                f"You are building a knowledge index for this organization source: {base_url}\n"
                f"Only use sources from this domain: {base_host}\n"
                "Return a concise synthesis of key guidance pages, policies, best-practice docs, and methods "
                "with grounded citations. Prioritize canonical pages, not promotional pages."
            ),
        )
        await record_usage_from_response(
            self.user_id,
            settings.openai_orchestration_model,
            response,
            self.db,
            is_byok=self._is_byok,
        )

        snippets: list[dict[str, str]] = []
        seen: set[str] = set()

        for item in response.output:
            if getattr(item, "type", None) != "message":
                continue
            for block in item.content:
                text_block = getattr(block, "text", "") or ""
                annotations = getattr(block, "annotations", []) or []
                for ann in annotations:
                    if getattr(ann, "type", None) != "url_citation":
                        continue
                    url = getattr(ann, "url", "") or ""
                    if not url:
                        continue
                    host = (urlparse(url).netloc or "").lower().lstrip("www.")
                    if not host.endswith(base_host):
                        continue
                    if url in seen:
                        continue
                    seen.add(url)

                    title = (getattr(ann, "title", "") or "").strip() or "Knowledge source"
                    start = getattr(ann, "start_index", 0)
                    end = getattr(ann, "end_index", start)
                    snippet_start = max(0, start - 320)
                    snippet_end = min(len(text_block), end + 320)
                    snippet_text = text_block[snippet_start:snippet_end].strip()
                    if len(snippet_text) < 80:
                        snippet_text = text_block[:420].strip()
                    if len(snippet_text) < 80:
                        continue
                    snippets.append(
                        {
                            "source_title": title[:1024],
                            "source_url": url[:2048],
                            "content": snippet_text[:2000],
                        }
                    )
                    if len(snippets) >= max_chunks:
                        return snippets

        return snippets

    async def list_workspace_banks(self, workspace_id: UUID) -> list[WorkspaceKnowledgeBank]:
        result = await self.db.execute(
            select(WorkspaceKnowledgeBank)
            .where(WorkspaceKnowledgeBank.workspace_id == workspace_id)
            .order_by(WorkspaceKnowledgeBank.created_at.desc())
        )
        return list(result.scalars().all())
