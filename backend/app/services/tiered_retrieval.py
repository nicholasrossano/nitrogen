"""
Tiered Retrieval Service

Implements a four-tier knowledge retrieval system:
1. Corpus RAG (case studies, uploaded evidence) - highest priority, always cited
2. OpenAlex (scholarly works) - academic/research sources
3. Web Search (authoritative institutional sources) - real-time data
4. LLM Knowledge (training data fallback) - flagged as estimate

Every fact is tracked with its source for citation.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Literal, Optional, Awaitable
from uuid import UUID
import logging
import time

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.services.rag import RAGService, RetrievedChunk
from app.services.openalex import OpenAlexService
from app.models.initiative import Initiative

settings = get_settings()
logger = logging.getLogger(__name__)


class SourceType(str, Enum):
    """Types of sources for retrieved facts."""
    CORPUS = "corpus"
    EVIDENCE = "evidence"
    OPENALEX = "openalex"
    WEB = "web"
    LLM_ESTIMATE = "llm_estimate"


@dataclass
class RetrievedFact:
    """A fact with its source for citation."""
    content: str
    source_type: SourceType
    source_title: str
    source_url: str | None = None
    chunk_id: str | None = None
    confidence: float = 1.0
    # Human-readable publisher / journal / domain — shown in citation chips
    publisher: str | None = None

    def to_dict(self) -> dict:
        return {
            "content": self.content,
            "source_type": self.source_type.value,
            "source_title": self.source_title,
            "source_url": self.source_url,
            "chunk_id": self.chunk_id,
            "confidence": self.confidence,
            "publisher": self.publisher,
        }
    
    def to_citation_string(self) -> str:
        """Format as inline citation."""
        if self.source_type == SourceType.WEB:
            return f"[Web: {self.source_title}]"
        elif self.source_type == SourceType.OPENALEX:
            return f"[OpenAlex: {self.source_title}]"
        elif self.source_type == SourceType.LLM_ESTIMATE:
            return "[LLM Estimate - unverified]"
        else:
            return f"[{self.source_type.value.title()}: {self.source_title}]"


StageCallback = Callable[[str, str, Optional[str]], Awaitable[None]]


@dataclass
class RetrievalResult:
    """Result of a tiered retrieval operation."""
    facts: list[RetrievedFact] = field(default_factory=list)
    tiers_used: list[str] = field(default_factory=list)
    query: str = ""
    
    @property
    def tier_used(self) -> str:
        """Primary tier used (for backward compat)."""
        return self.tiers_used[0] if self.tiers_used else "none"
    
    def has_verified_facts(self) -> bool:
        """Check if we have facts from corpus, openalex, or web (not just LLM estimates)."""
        return any(
            f.source_type in [SourceType.CORPUS, SourceType.EVIDENCE, SourceType.OPENALEX, SourceType.WEB]
            for f in self.facts
        )
    
    def format_for_prompt(self, max_facts: int = 5) -> str:
        """Format facts for inclusion in a prompt."""
        if not self.facts:
            return "No relevant information found."
        
        lines = []
        for fact in self.facts[:max_facts]:
            citation = fact.to_citation_string()
            content = fact.content[:400] + "..." if len(fact.content) > 400 else fact.content
            lines.append(f"- {content} {citation}")
        
        return "\n".join(lines)


class TieredRetrievalService:
    """
    Retrieves information with tiered fallback:
    1. Corpus RAG (case studies, project evidence)
    2. OpenAlex (scholarly works / academic research)
    3. Web search (authoritative institutional sources)
    4. LLM knowledge (flagged as estimate)
    
    Every claim is tracked with its source for citation.
    """
    
    CORPUS_RELEVANCE_THRESHOLD = 0.7
    
    def __init__(self, db: AsyncSession):
        self.db = db
        self.rag = RAGService(db)
        self.openalex = OpenAlexService()
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
    
    async def retrieve(
        self,
        query: str,
        initiative_id: UUID | None = None,
        include_openalex: bool = True,
        include_web_search: bool = True,
        include_llm_fallback: bool = True,
        require_citation: bool = False,
        on_stage: StageCallback | None = None,
    ) -> RetrievalResult:
        """
        Retrieve facts for a query using tiered fallback.
        
        The on_stage callback is invoked at each tier for streaming progress.
        """
        result = RetrievalResult(query=query)
        
        # TIER 1: Corpus + Evidence RAG (skipped when disabled via config)
        if settings.enable_corpus_rag:
            if on_stage:
                await on_stage("retrieve_corpus", "running", None)
            corpus_facts = await self.search_corpus(query, initiative_id)
            if corpus_facts:
                result.facts.extend(corpus_facts)
                result.tiers_used.append("corpus")
                if on_stage:
                    await on_stage("retrieve_corpus", "done", f"Found {len(corpus_facts)} results")
                logger.info(f"Tier 1 (corpus) hit for query: {query[:50]}...")
                if len(corpus_facts) >= 3:
                    return result
            else:
                if on_stage:
                    await on_stage("retrieve_corpus", "done", "No matches")
        else:
            logger.debug("Corpus RAG disabled via ENABLE_CORPUS_RAG=false")
        
        # TIER 2: OpenAlex
        if include_openalex:
            if on_stage:
                await on_stage("retrieve_openalex", "running", None)
            openalex_facts = await self.search_openalex(query)
            if openalex_facts:
                result.facts.extend(openalex_facts)
                result.tiers_used.append("openalex")
                if on_stage:
                    await on_stage("retrieve_openalex", "done", f"Found {len(openalex_facts)} scholarly works")
                logger.info(f"Tier 2 (openalex) hit for query: {query[:50]}...")
                if len(result.facts) >= 3:
                    return result
            else:
                if on_stage:
                    await on_stage("retrieve_openalex", "done", "No relevant scholarly works")
        
        # TIER 3: Web Search
        if include_web_search:
            if on_stage:
                await on_stage("retrieve_web", "running", None)
            web_facts = await self.search_web(query)
            if web_facts:
                result.facts.extend(web_facts)
                result.tiers_used.append("web")
                if on_stage:
                    await on_stage("retrieve_web", "done", f"Found {len(web_facts)} web sources")
                logger.info(f"Tier 3 (web) hit for query: {query[:50]}...")
                return result
            else:
                if on_stage:
                    await on_stage("retrieve_web", "done", "No authoritative web sources found")
        
        # TIER 4: LLM Knowledge Fallback
        if include_llm_fallback and not require_citation:
            if not result.facts:
                result.facts.append(
                    RetrievedFact(
                        content=f"No verified data found for: {query}. Any information provided will be based on general knowledge and should be verified.",
                        source_type=SourceType.LLM_ESTIMATE,
                        source_title="LLM Estimate",
                        confidence=0.5,
                    )
                )
            result.tiers_used.append("llm_fallback")
            logger.info(f"Tier 4 (LLM fallback) for query: {query[:50]}...")
        
        return result
    
    async def search_corpus(
        self,
        query: str,
        initiative_id: UUID | None,
    ) -> list[RetrievedFact]:
        """Search corpus and evidence using existing RAG service."""
        try:
            search_id = initiative_id or UUID('00000000-0000-0000-0000-000000000000')
            
            chunks = await self.rag.retrieve(
                query=query,
                initiative_id=search_id,
                sources=["corpus"] if not initiative_id else ["corpus", "evidence"],
                corpus_top_k=5,
                evidence_top_k=3 if initiative_id else 0,
            )
            
            relevant_chunks = [c for c in chunks if c.similarity >= self.CORPUS_RELEVANCE_THRESHOLD]
            
            if not relevant_chunks:
                return []
            
            return [
                RetrievedFact(
                    content=chunk.content,
                    source_type=SourceType.EVIDENCE if chunk.source_type == "evidence" else SourceType.CORPUS,
                    source_title=chunk.source_title,
                    chunk_id=str(chunk.chunk_id),
                    confidence=chunk.similarity,
                )
                for chunk in relevant_chunks
            ]
        except Exception as e:
            logger.error(f"Corpus search failed: {e}")
            return []
    
    async def search_openalex(self, query: str) -> list[RetrievedFact]:
        """Search OpenAlex for scholarly works."""
        try:
            works = await self.openalex.search_works(query, per_page=5)
            if not works:
                return []
            
            facts = []
            for work in works:
                content_parts = [work.title]
                if work.abstract_snippet:
                    content_parts.append(work.abstract_snippet)
                if work.publication_year:
                    content_parts.append(f"Published: {work.publication_year}")
                if work.source_name:
                    content_parts.append(f"Source: {work.source_name}")
                
                facts.append(
                    RetrievedFact(
                        content=" | ".join(content_parts),
                        source_type=SourceType.OPENALEX,
                        source_title=work.title,
                        source_url=work.doi_url,
                        chunk_id=work.openalex_id,
                        confidence=0.8,
                        publisher=work.source_name or None,
                    )
                )
            return facts
        except Exception as e:
            logger.error(f"OpenAlex search failed: {e}")
            return []
    
    async def search_web(
        self,
        query: str,
        max_results: int = 5,
        max_content_length: int = 400,
    ) -> list[RetrievedFact]:
        """
        Search the web for authoritative sources.
        Uses Tavily API if configured, otherwise skips.

        Args:
            query: Search query string.
            max_results: Max results to return from Tavily (default 5, up to 10).
            max_content_length: Max characters to keep per result content (default 400).
        """
        if not settings.tavily_api_key:
            logger.debug(f"Web search skipped (no API key): {query[:50]}...")
            return []
        
        try:
            import httpx
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    "https://api.tavily.com/search",
                    json={
                        "api_key": settings.tavily_api_key,
                        "query": query,
                        "search_depth": "advanced",
                        "max_results": max_results,
                        "include_domains": [],
                        "exclude_domains": [
                            "reddit.com", "quora.com", "medium.com",
                            "pinterest.com", "facebook.com", "twitter.com",
                        ],
                    },
                )
                resp.raise_for_status()
                data = resp.json()
            
            facts = []
            for item in data.get("results", []):
                title = item.get("title", "")
                content = item.get("content", "")
                url = item.get("url", "")
                if not title or not content:
                    continue
                # Extract clean domain for display (e.g. "goldstandard.org")
                domain: str | None = None
                if url:
                    try:
                        from urllib.parse import urlparse
                        domain = urlparse(url).netloc.lstrip("www.") or None
                    except Exception:
                        pass
                facts.append(
                    RetrievedFact(
                        content=content[:max_content_length],
                        source_type=SourceType.WEB,
                        source_title=title,
                        source_url=url,
                        confidence=0.7,
                        publisher=domain,
                    )
                )
            return facts
        except Exception as e:
            logger.error(f"Web search failed: {e}")
            return []
    
    async def retrieve_for_context(
        self,
        initiative: Initiative,
    ) -> dict[str, RetrievalResult]:
        """
        Retrieve contextual facts based on project state.
        Returns facts organized by category for injection into orchestration prompts.
        """
        results = {}
        
        if initiative.geography:
            results["regional_context"] = await self.retrieve(
                query=f"Development projects market conditions economic context {initiative.geography}",
                initiative_id=initiative.id,
            )
            
            if initiative.project_type in ["energy_access", "clean_cooking"]:
                results["energy_context"] = await self.retrieve(
                    query=f"Electricity costs grid tariff energy prices {initiative.geography}",
                    initiative_id=initiative.id,
                )
        
        if initiative.project_description:
            results["similar_projects"] = await self.retrieve(
                query=f"Similar development projects case studies: {initiative.project_description[:200]}",
                initiative_id=initiative.id,
            )
        
        if initiative.selected_tools:
            tool_context_query = f"Best practices requirements for {', '.join(initiative.selected_tools)} analysis"
            results["tool_context"] = await self.retrieve(
                query=tool_context_query,
                initiative_id=initiative.id,
                include_web_search=False,
            )
        
        return results
    
    def format_context_for_prompt(
        self,
        context_results: dict[str, RetrievalResult],
    ) -> str:
        """
        Format retrieved context for inclusion in the orchestration system prompt.
        Includes source citations inline.
        """
        if not context_results:
            return "No additional context available."
        
        sections = []
        
        for category, result in context_results.items():
            if result.facts and result.tier_used != "none":
                category_name = category.replace("_", " ").title()
                tier_label = f"(from {result.tier_used})" if result.tier_used != "corpus" else ""
                sections.append(f"\n### {category_name} {tier_label}")
                sections.append(result.format_for_prompt(max_facts=3))
        
        if not sections:
            return "No additional context available."
        
        return "\n".join(sections)
