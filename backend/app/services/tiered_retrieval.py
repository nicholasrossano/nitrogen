"""
Tiered Retrieval Service

Searches all available data sources in parallel for comprehensive results:
- Corpus RAG (case studies, uploaded evidence)
- OpenAlex (scholarly works / academic research)
- Web Search (authoritative institutional sources)
- LLM Knowledge (training data fallback — only when nothing else found)

Every fact is tracked with its source for citation.
"""

import asyncio
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Optional, Awaitable
from uuid import UUID
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select

from app.config import get_settings
from app.domain.registry import get_retrieval_connectors
from app.services.rag import RAGService
from app.services.openalex import OpenAlexService
from app.services.workspace_knowledge import WorkspaceKnowledgeService
from app.models.project import Project
from app.models.project_material import ProjectMaterial
from app.models.evidence import EvidenceDoc

settings = get_settings()
logger = logging.getLogger(__name__)


class SourceType(str, Enum):
    """Types of sources for retrieved facts."""
    CORPUS = "corpus"
    EVIDENCE = "evidence"
    WORKSPACE_EVIDENCE = "workspace_evidence"
    WORKSPACE_KNOWLEDGE = "workspace_knowledge"
    OPENALEX = "openalex"
    WORLDBANK_INDICATOR = "worldbank_indicator"
    WORLDBANK_DOCUMENT = "worldbank_document"
    WORLDBANK_PROJECT = "worldbank_project"
    IATI_ACTIVITY = "iati_activity"
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
    # Internal document linking for citation navigation
    evidence_doc_id: str | None = None
    chunk_index: int | None = None
    # Compare mode: "A" or "B" to attribute facts to a specific project
    project_label: str | None = None

    def to_dict(self) -> dict:
        return {
            "content": self.content,
            "source_type": self.source_type.value,
            "source_title": self.source_title,
            "source_url": self.source_url,
            "chunk_id": self.chunk_id,
            "confidence": self.confidence,
            "publisher": self.publisher,
            "evidence_doc_id": self.evidence_doc_id,
            "chunk_index": self.chunk_index,
            "project_label": self.project_label,
        }
    
    def to_citation_string(self) -> str:
        """Format as inline citation with optional chunk index and project label."""
        prefix = f"{self.project_label}-" if self.project_label else ""
        if self.source_type == SourceType.WEB:
            return f"[{prefix}Web: {self.source_title}]"
        elif self.source_type == SourceType.OPENALEX:
            return f"[{prefix}Scholarly: {self.source_title}]"
        elif self.source_type == SourceType.WORLDBANK_INDICATOR:
            return f"[{prefix}Country Indicator: {self.source_title}]"
        elif self.source_type == SourceType.WORLDBANK_DOCUMENT:
            return f"[{prefix}Institutional Report: {self.source_title}]"
        elif self.source_type == SourceType.WORLDBANK_PROJECT:
            return f"[{prefix}Comparable Project: {self.source_title}]"
        elif self.source_type == SourceType.IATI_ACTIVITY:
            return f"[{prefix}Funding Activity: {self.source_title}]"
        elif self.source_type == SourceType.LLM_ESTIMATE:
            return "[LLM Estimate - unverified]"
        elif self.source_type == SourceType.WORKSPACE_KNOWLEDGE:
            return f"[Workspace KB: {self.source_title}]"
        elif self.source_type == SourceType.WORKSPACE_EVIDENCE:
            return f"[Workspace File: {self.source_title}]"
        else:
            tag = f"[{prefix}{self.source_type.value.title()}: {self.source_title}"
            if self.chunk_index is not None:
                tag += f", p{self.chunk_index}"
            tag += "]"
            return tag


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
            f.source_type in [
                SourceType.CORPUS,
                SourceType.EVIDENCE,
                SourceType.OPENALEX,
                SourceType.WORKSPACE_EVIDENCE,
                SourceType.WORKSPACE_KNOWLEDGE,
                SourceType.WORLDBANK_INDICATOR,
                SourceType.WORLDBANK_DOCUMENT,
                SourceType.WORLDBANK_PROJECT,
                SourceType.IATI_ACTIVITY,
                SourceType.WEB,
            ]
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
    Searches all available data sources in parallel for comprehensive results.
    Corpus, OpenAlex, and web search all run concurrently; results are merged
    and ranked. LLM fallback is only added when no other source returned data.
    """
    
    CORPUS_RELEVANCE_THRESHOLD = 0.55
    WEB_SEARCH_TIMEOUT_SECONDS = 12.0
    
    def __init__(self, db: AsyncSession, user_id: str | None = None):
        self.db = db
        self.user_id = user_id
        self.rag = RAGService(db, user_id=user_id)
        self.workspace_knowledge = WorkspaceKnowledgeService(db, user_id=user_id)
        self.openalex = OpenAlexService()
        self._retrieval_connectors = None

    def _domain_connectors(self):
        if self._retrieval_connectors is None:
            self._retrieval_connectors = get_retrieval_connectors()
        return self._retrieval_connectors
    
    async def retrieve(
        self,
        query: str,
        project_id: UUID | None = None,
        include_openalex: bool = False,
        include_web_search: bool = True,
        include_llm_fallback: bool = True,
        require_citation: bool = False,
        on_stage: StageCallback | None = None,
    ) -> RetrievalResult:
        """
        Retrieve facts from all enabled sources in parallel for comprehensive results.
        
        The on_stage callback is invoked at each source for streaming progress.
        """
        result = RetrievalResult(query=query)

        # Launch all enabled sources concurrently
        async def _corpus() -> list[RetrievedFact]:
            if not settings.enable_corpus_rag:
                return []
            if on_stage:
                await on_stage("retrieve_corpus", "running", None)
            facts = await self.search_corpus(query, project_id)
            if on_stage:
                msg = f"Found {len(facts)} results" if facts else "No matches"
                await on_stage("retrieve_corpus", "done", msg)
            if facts:
                logger.info(f"Corpus hit for query: {query[:50]}...")
            return facts

        async def _openalex() -> list[RetrievedFact]:
            if not include_openalex:
                return []
            if on_stage:
                await on_stage("retrieve_openalex", "running", None)
            facts = await self.search_openalex(query)
            if on_stage:
                msg = f"Found {len(facts)} scholarly works" if facts else "No relevant scholarly works"
                await on_stage("retrieve_openalex", "done", msg)
            if facts:
                logger.info(f"OpenAlex hit for query: {query[:50]}...")
            return facts

        async def _web() -> list[RetrievedFact]:
            if not include_web_search:
                return []
            if on_stage:
                await on_stage("retrieve_web", "running", None)
            facts = await self.search_web(query)
            if on_stage:
                msg = f"Found {len(facts)} web sources" if facts else "No authoritative web sources found"
                await on_stage("retrieve_web", "done", msg)
            if facts:
                logger.info(f"Web hit for query: {query[:50]}...")
            return facts

        corpus_facts, openalex_facts, web_facts = await asyncio.gather(
            _corpus(), _openalex(), _web()
        )

        if corpus_facts:
            result.facts.extend(corpus_facts)
            result.tiers_used.append("corpus")
        if openalex_facts:
            result.facts.extend(openalex_facts)
            result.tiers_used.append("openalex")
        if web_facts:
            result.facts.extend(web_facts)
            result.tiers_used.append("web")

        # LLM fallback only when nothing else returned data
        if include_llm_fallback and not require_citation and not result.facts:
            result.facts.append(
                RetrievedFact(
                    content=f"No verified data found for: {query}. Any information provided will be based on general knowledge and should be verified.",
                    source_type=SourceType.LLM_ESTIMATE,
                    source_title="LLM Estimate",
                    confidence=0.5,
                )
            )
            result.tiers_used.append("llm_fallback")
            logger.info(f"LLM fallback for query: {query[:50]}...")
        
        return result
    
    async def search_corpus(
        self,
        query: str,
        project_id: UUID | None,
        *,
        corpus_top_k: int = 5,
        evidence_top_k: int | None = None,
    ) -> list[RetrievedFact]:
        """Search corpus and evidence using existing RAG service."""
        try:
            search_id = project_id or UUID('00000000-0000-0000-0000-000000000000')
            ev_k = evidence_top_k if evidence_top_k is not None else (corpus_top_k if project_id else 0)

            chunks = await self.rag.retrieve(
                query=query,
                project_id=search_id,
                sources=["corpus"] if not project_id else ["corpus", "evidence"],
                corpus_top_k=corpus_top_k,
                evidence_top_k=ev_k,
            )
            
            relevant_chunks = [c for c in chunks if c.similarity >= self.CORPUS_RELEVANCE_THRESHOLD]
            
            if not relevant_chunks:
                return []
            
            return [
                RetrievedFact(
                    content=chunk.content,
                    source_type=(
                        SourceType.EVIDENCE
                        if chunk.source_type == "evidence"
                        else SourceType.WORKSPACE_EVIDENCE
                        if chunk.source_type == "workspace_evidence"
                        else SourceType.CORPUS
                    ),
                    source_title=chunk.source_title,
                    chunk_id=str(chunk.chunk_id),
                    confidence=chunk.similarity,
                    evidence_doc_id=str(chunk.source_doc_id) if chunk.source_type == "evidence" else None,
                    chunk_index=chunk.chunk_index,
                )
                for chunk in relevant_chunks
            ]
        except Exception as e:
            logger.error(f"Corpus search failed: {e}")
            try:
                await self.db.rollback()
            except Exception:
                pass
            return []

    async def search_workspace_context(
        self,
        query: str,
        workspace_id: UUID,
        *,
        workspace_top_k: int = 4,
        knowledge_top_k: int = 6,
    ) -> list[RetrievedFact]:
        """Search workspace-level context (workspace files + linked knowledge banks)."""
        facts: list[RetrievedFact] = []
        try:
            chunks = await self.rag.retrieve(
                query=query,
                project_id=None,
                workspace_id=workspace_id,
                sources=["workspace_evidence"],
                workspace_top_k=workspace_top_k,
            )
            relevant_chunks = [c for c in chunks if c.similarity >= self.CORPUS_RELEVANCE_THRESHOLD]
            facts.extend(
                [
                    RetrievedFact(
                        content=chunk.content,
                        source_type=SourceType.WORKSPACE_EVIDENCE,
                        source_title=chunk.source_title,
                        chunk_id=str(chunk.chunk_id),
                        confidence=chunk.similarity,
                        evidence_doc_id=str(chunk.source_doc_id),
                        chunk_index=chunk.chunk_index,
                    )
                    for chunk in relevant_chunks
                ]
            )
        except Exception as e:
            logger.error(f"Workspace evidence search failed: {e}", exc_info=True)

        try:
            matches = await self.workspace_knowledge.search(
                workspace_id=workspace_id,
                query=query,
                top_k=knowledge_top_k,
            )
            facts.extend(
                [
                    RetrievedFact(
                        content=match.content,
                        source_type=SourceType.WORKSPACE_KNOWLEDGE,
                        source_title=f"{match.bank_name}: {match.source_title}",
                        source_url=match.source_url,
                        confidence=match.similarity,
                        publisher="workspace_knowledge_bank",
                    )
                    for match in matches
                ]
            )
        except Exception as e:
            logger.error(f"Workspace knowledge search failed: {e}", exc_info=True)

        return facts
    
    async def search_project_materials(
        self,
        query: str,
        project_id: UUID,
        max_results: int = 5,
        max_snippet_len: int = 500,
    ) -> list[RetrievedFact]:
        """Full-text keyword search on project_materials.content_text."""
        try:
            result = await self.db.execute(
                select(ProjectMaterial).where(
                    ProjectMaterial.project_id == project_id,
                    ProjectMaterial.content_text.isnot(None),
                    ProjectMaterial.content_text != "",
                )
            )
            materials = result.scalars().all()
            if not materials:
                return []

            keywords = [w.lower() for w in query.split() if len(w) > 2]
            if not keywords:
                keywords = [w.lower() for w in query.split() if len(w) > 1]
            if not keywords:
                return []

            scored: list[tuple[float, ProjectMaterial, str]] = []
            for mat in materials:
                text = mat.content_text or ""
                text_lower = text.lower()
                hits = sum(1 for kw in keywords if kw in text_lower)
                if hits == 0:
                    continue
                score = hits / len(keywords)

                best_pos = 0
                best_count = 0
                window = max_snippet_len
                for i in range(0, len(text_lower) - window + 1, window // 4):
                    chunk = text_lower[i : i + window]
                    cnt = sum(1 for kw in keywords if kw in chunk)
                    if cnt > best_count:
                        best_count = cnt
                        best_pos = i
                snippet = text[best_pos : best_pos + window].strip()

                scored.append((score, mat, snippet))

            scored.sort(key=lambda x: x[0], reverse=True)

            # Resolve the EvidenceDoc IDs for materials that have embedded chunks
            storage_paths = [mat.storage_path for _, mat, _ in scored[:max_results] if mat.storage_path]
            ev_doc_map: dict[str, UUID] = {}
            if storage_paths:
                ev_result = await self.db.execute(
                    select(EvidenceDoc.storage_path, EvidenceDoc.id).where(
                        EvidenceDoc.storage_path.in_(storage_paths)
                    )
                )
                ev_doc_map = {row.storage_path: row.id for row in ev_result.fetchall()}

            return [
                RetrievedFact(
                    content=snippet,
                    source_type=SourceType.EVIDENCE,
                    source_title=mat.filename,
                    chunk_id=None,
                    confidence=min(score, 0.95),
                    evidence_doc_id=str(ev_doc_map[mat.storage_path]) if mat.storage_path and mat.storage_path in ev_doc_map else None,
                )
                for score, mat, snippet in scored[:max_results]
            ]
        except Exception as e:
            logger.error(f"Project material search failed: {e}", exc_info=True)
            try:
                await self.db.rollback()
            except Exception:
                pass
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
                if work.doi_url:
                    content_parts.append(f"DOI: {work.doi_url}")
                
                facts.append(
                    RetrievedFact(
                        content=" | ".join(content_parts),
                        source_type=SourceType.OPENALEX,
                        source_title=work.title,
                        source_url=work.doi_url or work.openalex_id,
                        chunk_id=work.openalex_id,
                        confidence=0.8,
                        publisher=work.source_name or None,
                    )
                )
            return facts
        except Exception as e:
            logger.error(f"OpenAlex search failed: {e}")
            return []

    async def search_worldbank_indicators(
        self,
        query: str,
        country_hint: str | None = None,
    ) -> list[RetrievedFact]:
        """Search World Bank Open Data indicators."""
        connectors = self._domain_connectors()
        if connectors is None:
            return []
        try:
            rows = await connectors.worldbank_indicators.search_indicators(
                query=query,
                country_hint=country_hint,
                latest_only=True,
            )
            facts: list[RetrievedFact] = []
            for row in rows:
                value_str = str(row.value) if row.value is not None else "No reported value"
                content = (
                    f"{row.indicator_name} ({row.indicator_code}) for {row.country_name} "
                    f"in {row.year}: {value_str}."
                )
                facts.append(
                    RetrievedFact(
                        content=content,
                        source_type=SourceType.WORLDBANK_INDICATOR,
                        source_title=f"{row.indicator_name} ({row.country_name})",
                        source_url=row.source_url,
                        chunk_id=f"{row.country_code}:{row.indicator_code}:{row.year}",
                        confidence=0.9 if row.value is not None else 0.5,
                        publisher="World Bank Open Data",
                    )
                )
            return facts
        except Exception as e:
            logger.error(f"World Bank indicator search failed: {e}")
            return []

    async def search_worldbank_documents(self, query: str) -> list[RetrievedFact]:
        """Search World Bank Documents & Reports."""
        connectors = self._domain_connectors()
        if connectors is None:
            return []
        try:
            rows = await connectors.worldbank_documents.search_documents(query=query, max_results=8)
            facts: list[RetrievedFact] = []
            for row in rows:
                parts = [row.title]
                if row.document_type:
                    parts.append(f"Type: {row.document_type}")
                if row.year:
                    parts.append(f"Year: {row.year}")
                if row.summary:
                    parts.append(row.summary)
                facts.append(
                    RetrievedFact(
                        content=" | ".join(parts),
                        source_type=SourceType.WORLDBANK_DOCUMENT,
                        source_title=row.title,
                        source_url=row.source_url,
                        chunk_id=row.document_id,
                        confidence=0.75,
                        publisher=row.publisher,
                    )
                )
            return facts
        except Exception as e:
            logger.error(f"World Bank document search failed: {e}")
            return []

    async def search_worldbank_projects(self, query: str) -> list[RetrievedFact]:
        """Search World Bank Projects & Operations."""
        connectors = self._domain_connectors()
        if connectors is None:
            return []
        try:
            rows = await connectors.worldbank_projects.search_projects(query=query, max_results=8)
            facts: list[RetrievedFact] = []
            for row in rows:
                parts = [row.project_name]
                if row.country_name:
                    parts.append(f"Country: {row.country_name}")
                if row.approval_year:
                    parts.append(f"Approval year: {row.approval_year}")
                if row.status:
                    parts.append(f"Status: {row.status}")
                if row.financing_amount is not None:
                    parts.append(f"Financing amount: {row.financing_amount:,.0f}")
                if row.summary:
                    parts.append(row.summary)
                facts.append(
                    RetrievedFact(
                        content=" | ".join(parts),
                        source_type=SourceType.WORLDBANK_PROJECT,
                        source_title=row.project_name,
                        source_url=row.source_url,
                        chunk_id=row.project_id,
                        confidence=0.75,
                        publisher=row.publisher,
                    )
                )
            return facts
        except Exception as e:
            logger.error(f"World Bank project search failed: {e}")
            return []

    async def search_iati(self, query: str) -> list[RetrievedFact]:
        """Search IATI Datastore funding activity."""
        connectors = self._domain_connectors()
        if connectors is None:
            return []
        try:
            rows = await connectors.iati.search_activities(query=query, max_results=8)
            facts: list[RetrievedFact] = []
            for row in rows:
                parts = [row.title]
                if row.reporting_organization:
                    parts.append(f"Reporting organization: {row.reporting_organization}")
                if row.recipient_country:
                    parts.append(f"Recipient country: {row.recipient_country}")
                if row.sector:
                    parts.append(f"Sector: {row.sector}")
                if row.status:
                    parts.append(f"Activity status: {row.status}")
                if row.start_date or row.end_date:
                    parts.append(f"Dates: {row.start_date or 'unknown'} to {row.end_date or 'unknown'}")
                if row.budget_summary:
                    parts.append(f"Budget/transaction summary: {row.budget_summary}")
                facts.append(
                    RetrievedFact(
                        content=" | ".join(parts),
                        source_type=SourceType.IATI_ACTIVITY,
                        source_title=row.title,
                        source_url=row.source_url,
                        chunk_id=row.activity_id,
                        confidence=0.7,
                        publisher=row.publisher,
                    )
                )
            return facts
        except Exception as e:
            logger.error(f"IATI search failed: {e}")
            return []
    
    async def search_web(
        self,
        query: str,
        max_results: int = 10,
        max_content_length: int = 400,
        search_context_size: str = "medium",
    ) -> list[RetrievedFact]:
        """
        Search the web using the active provider's native search (OpenAI Responses or OpenRouter :online).
        """
        try:
            from urllib.parse import urlparse

            from app.core.web_search import run_web_search

            summary, citations = await run_web_search(
                self.user_id,
                self.db,
                query,
                search_context_size=search_context_size,
            )

            facts: list[RetrievedFact] = []
            seen_urls: set[str] = set()

            for cite in citations:
                url = cite.get("url", "")
                title = cite.get("title", "") or "Web Source"
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)
                snippet = cite.get("snippet") or summary[:max_content_length]
                domain: str | None = None
                try:
                    domain = urlparse(url).netloc.lstrip("www.") or None
                except Exception:
                    pass
                facts.append(
                    RetrievedFact(
                        content=snippet[:max_content_length] if snippet else title,
                        source_type=SourceType.WEB,
                        source_title=title,
                        source_url=url,
                        confidence=0.7,
                        publisher=domain,
                    )
                )

            if not facts and summary:
                facts.append(
                    RetrievedFact(
                        content=summary[:max_content_length],
                        source_type=SourceType.WEB,
                        source_title="Web search summary",
                        source_url="",
                        confidence=0.6,
                    )
                )

            facts = [f for f in facts if len(f.content) >= 50 or not f.source_url]

            logger.info(
                "search_web query=%r unique_facts=%d",
                query[:80],
                len(facts),
            )
            return facts[:max_results]
        except TimeoutError:
            logger.warning(
                "Web search timed out after %.1fs for query=%r",
                self.WEB_SEARCH_TIMEOUT_SECONDS,
                query[:80],
            )
            return []
        except Exception as e:
            logger.error(f"Web search failed for query={query[:80]!r}: {e}", exc_info=True)
            return []
    
    async def retrieve_for_context(
        self,
        initiative: Project,
    ) -> dict[str, RetrievalResult]:
        """
        Retrieve contextual facts based on project state.
        Returns facts organized by category for injection into orchestration prompts.
        """
        results = {}
        
        if initiative.geography:
            results["regional_context"] = await self.retrieve(
                query=f"Development projects market conditions economic context {initiative.geography}",
                project_id=initiative.id,
            )
            
            if initiative.project_type in ["energy_access", "clean_cooking"]:
                results["energy_context"] = await self.retrieve(
                    query=f"Electricity costs grid tariff energy prices {initiative.geography}",
                    project_id=initiative.id,
                )
        
        if initiative.project_description:
            results["similar_projects"] = await self.retrieve(
                query=f"Similar development projects case studies: {initiative.project_description[:200]}",
                project_id=initiative.id,
            )
        
        if initiative.selected_tools:
            tool_context_query = f"Best practices requirements for {', '.join(initiative.selected_tools)} analysis"
            results["tool_context"] = await self.retrieve(
                query=tool_context_query,
                project_id=initiative.id,
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
