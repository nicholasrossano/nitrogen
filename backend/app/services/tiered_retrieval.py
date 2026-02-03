"""
Tiered Retrieval Service

Implements a three-tier knowledge retrieval system:
1. Corpus RAG (case studies, uploaded evidence) - highest priority, always cited
2. Web Search (OpenAI's built-in web_search tool) - for real-time data
3. LLM Knowledge (training data fallback) - flagged as estimate

Every fact is tracked with its source for citation.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Literal
from uuid import UUID
import logging

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.services.rag import RAGService, RetrievedChunk
from app.models.initiative import Initiative

settings = get_settings()
logger = logging.getLogger(__name__)


class SourceType(str, Enum):
    """Types of sources for retrieved facts."""
    CORPUS = "corpus"
    EVIDENCE = "evidence"
    WEB = "web"
    LLM_ESTIMATE = "llm_estimate"


@dataclass
class RetrievedFact:
    """A fact with its source for citation."""
    content: str
    source_type: SourceType
    source_title: str
    source_url: str | None = None  # For web sources
    chunk_id: str | None = None    # For corpus/evidence
    confidence: float = 1.0        # Lower for estimates
    
    def to_dict(self) -> dict:
        return {
            "content": self.content,
            "source_type": self.source_type.value,
            "source_title": self.source_title,
            "source_url": self.source_url,
            "chunk_id": self.chunk_id,
            "confidence": self.confidence,
        }
    
    def to_citation_string(self) -> str:
        """Format as inline citation."""
        if self.source_type == SourceType.WEB:
            return f"[Web: {self.source_title}]"
        elif self.source_type == SourceType.LLM_ESTIMATE:
            return "[LLM Estimate - unverified]"
        else:
            return f"[{self.source_type.value.title()}: {self.source_title}]"


@dataclass
class RetrievalResult:
    """Result of a tiered retrieval operation."""
    facts: list[RetrievedFact] = field(default_factory=list)
    tier_used: Literal["corpus", "web", "llm_fallback", "none"] = "none"
    query: str = ""
    
    def has_verified_facts(self) -> bool:
        """Check if we have facts from corpus or web (not just LLM estimates)."""
        return any(
            f.source_type in [SourceType.CORPUS, SourceType.EVIDENCE, SourceType.WEB]
            for f in self.facts
        )
    
    def format_for_prompt(self, max_facts: int = 5) -> str:
        """Format facts for inclusion in a prompt."""
        if not self.facts:
            return "No relevant information found."
        
        lines = []
        for fact in self.facts[:max_facts]:
            citation = fact.to_citation_string()
            # Truncate long content
            content = fact.content[:400] + "..." if len(fact.content) > 400 else fact.content
            lines.append(f"- {content} {citation}")
        
        return "\n".join(lines)


class TieredRetrievalService:
    """
    Retrieves information with tiered fallback:
    1. Corpus RAG (case studies, project evidence)
    2. Web search (real-time data via OpenAI's web_search tool)
    3. LLM knowledge (flagged as estimate)
    
    Every claim is tracked with its source for citation.
    """
    
    # Minimum similarity threshold for corpus results to be considered relevant
    CORPUS_RELEVANCE_THRESHOLD = 0.7
    
    def __init__(self, db: AsyncSession):
        self.db = db
        self.rag = RAGService(db)
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
    
    async def retrieve(
        self,
        query: str,
        initiative_id: UUID | None = None,
        include_web_search: bool = True,
        include_llm_fallback: bool = True,
        require_citation: bool = False,
    ) -> RetrievalResult:
        """
        Retrieve facts for a query using tiered fallback.
        
        Args:
            query: What to search for (e.g., "electricity costs in Kenya")
            initiative_id: For filtering evidence docs (optional)
            include_web_search: Whether to use web search as fallback
            include_llm_fallback: Whether to use LLM knowledge as final fallback
            require_citation: If True, skip LLM fallback (only verifiable sources)
        
        Returns:
            RetrievalResult with facts and source information
        """
        result = RetrievalResult(query=query)
        
        # TIER 1: Corpus + Evidence RAG
        corpus_facts = await self._search_corpus(query, initiative_id)
        if corpus_facts:
            result.facts = corpus_facts
            result.tier_used = "corpus"
            logger.info(f"Tier 1 (corpus) hit for query: {query[:50]}...")
            return result
        
        # TIER 2: Web Search (OpenAI's built-in web_search tool)
        if include_web_search:
            web_facts = await self._search_web(query)
            if web_facts:
                result.facts = web_facts
                result.tier_used = "web"
                logger.info(f"Tier 2 (web) hit for query: {query[:50]}...")
                return result
        
        # TIER 3: LLM Knowledge Fallback
        if include_llm_fallback and not require_citation:
            result.facts = [
                RetrievedFact(
                    content=f"No verified data found for: {query}. Any information provided will be based on general knowledge and should be verified.",
                    source_type=SourceType.LLM_ESTIMATE,
                    source_title="LLM Estimate",
                    confidence=0.5,
                )
            ]
            result.tier_used = "llm_fallback"
            logger.info(f"Tier 3 (LLM fallback) for query: {query[:50]}...")
        
        return result
    
    async def _search_corpus(
        self,
        query: str,
        initiative_id: UUID | None,
    ) -> list[RetrievedFact]:
        """Search corpus and evidence using existing RAG service."""
        try:
            # Use a dummy UUID if no initiative specified (for corpus-only search)
            search_id = initiative_id or UUID('00000000-0000-0000-0000-000000000000')
            
            chunks = await self.rag.retrieve(
                query=query,
                initiative_id=search_id,
                sources=["corpus"] if not initiative_id else ["corpus", "evidence"],
                corpus_top_k=5,
                evidence_top_k=3 if initiative_id else 0,
            )
            
            # Filter by relevance threshold
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
    
    async def _search_web(self, query: str) -> list[RetrievedFact]:
        """
        Search the web for real-time information.
        
        TODO: Implement web search integration. Options include:
        - Tavily API (search designed for AI)
        - Bing Search API
        - Google Custom Search
        
        For now, returns empty list to fall through to LLM fallback.
        """
        # Web search disabled for now - will integrate a search API later
        logger.debug(f"Web search skipped (not implemented): {query[:50]}...")
        return []
    
    async def retrieve_for_context(
        self,
        initiative: Initiative,
    ) -> dict[str, RetrievalResult]:
        """
        Retrieve contextual facts based on project state.
        Returns facts organized by category for injection into orchestration prompts.
        
        This is called before get_next_action() to give the LLM relevant context.
        """
        results = {}
        
        # Get regional/market context if geography is known
        if initiative.geography:
            results["regional_context"] = await self.retrieve(
                query=f"Development projects market conditions economic context {initiative.geography}",
                initiative_id=initiative.id,
            )
            
            # Energy-specific context for energy projects
            if initiative.project_type in ["energy_access", "clean_cooking"]:
                results["energy_context"] = await self.retrieve(
                    query=f"Electricity costs grid tariff energy prices {initiative.geography}",
                    initiative_id=initiative.id,
                )
        
        # Get similar project context based on description
        if initiative.project_description:
            results["similar_projects"] = await self.retrieve(
                query=f"Similar development projects case studies: {initiative.project_description[:200]}",
                initiative_id=initiative.id,
            )
        
        # Get tool-specific context if tools are selected
        if initiative.selected_tools:
            tool_context_query = f"Best practices requirements for {', '.join(initiative.selected_tools)} analysis"
            results["tool_context"] = await self.retrieve(
                query=tool_context_query,
                initiative_id=initiative.id,
                include_web_search=False,  # Don't web search for tool guidance
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
