"""
Compliance Chat Service

Two-step orchestration:
  1. A lightweight planning call (function-calling) decides which search
     tools — if any — are worth invoking for this particular question.
  2. Only the requested tools run; the answer is generated from exactly
     that evidence and cites only what it actually used.

Tools are additive: as more are registered in SEARCH_TOOLS the planner
will automatically consider them without changes elsewhere.
"""

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Awaitable, Callable

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.services.tiered_retrieval import (
    RetrievedFact,
    SourceType,
    TieredRetrievalService,
)

settings = get_settings()
logger = logging.getLogger(__name__)

ThinkingCallback = Callable[[str], Awaitable[None]]

# ---------------------------------------------------------------------------
# Tool definitions — the planner LLM sees these and decides which to call.
# Add new tools here; the rest of the pipeline adapts automatically.
# ---------------------------------------------------------------------------

SEARCH_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_scholarly_literature",
            "description": (
                "Search OpenAlex for peer-reviewed academic papers and research. "
                "Use when the user asks about precedents or case studies from specific locations, "
                "research-backed evidence, what has been done before in similar contexts, "
                "or academic literature on a topic. "
                "Do NOT use for general conceptual questions, definitions, or step-by-step procedural advice."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Focused search query for scholarly literature (max 20 words).",
                    },
                    "reason": {
                        "type": "string",
                        "description": "One sentence explaining why scholarly literature helps here.",
                    },
                },
                "required": ["query", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_web_sources",
            "description": (
                "Search authoritative web sources (NGOs, governments, standards bodies) for current "
                "regulations, policies, program requirements, or recent developments. "
                "Use when the user needs up-to-date information not likely captured in academic literature."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Focused search query for authoritative web sources (max 20 words).",
                    },
                    "reason": {
                        "type": "string",
                        "description": "One sentence explaining why a web search helps here.",
                    },
                },
                "required": ["query", "reason"],
            },
        },
    },
]

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

PLANNING_SYSTEM_PROMPT = """You are a research-planning assistant for an environmental compliance advisor.

Your only job is to decide which search tools (if any) to call before generating a response.

ALWAYS call search_scholarly_literature when the user:
- Asks what projects, programs, or initiatives have been done in a specific city, country, or region
- Asks for precedents, examples, or case studies from real places
- Needs evidence of what has actually been implemented (e.g. "what cookstove programs ran in Accra?")
- Needs research-backed analysis, academic evidence, or literature on a topic

ALWAYS call search_web_sources when the user:
- Needs current regulations, policies, or standards-body requirements
- Asks about recent developments, certifications, or funding mechanisms

Call NEITHER when:
- The question is purely conceptual, definitional, or conversational (e.g. "what is MRV?")
- The question asks for step-by-step process advice with no need for citations
- The conversation already contains a direct answer

You may call both, one, or neither. Do not produce any text — only make tool calls (or no calls)."""

SYSTEM_PROMPT = """You are an expert advisor on environmental program design, compliance frameworks, and sustainability standards. You help practitioners design compliant programs, understand regulatory requirements, and navigate complex environmental standards.

Your areas of expertise include:
- Environmental compliance frameworks and regulations
- Clean cooking, clean energy, and off-grid programs
- Carbon credit methodologies and verification
- Monitoring, reporting, and verification (MRV)
- Environmental and social safeguards
- Climate finance and green bonds
- Sustainable development goals (SDGs)
- Program design for development organizations
- Standards bodies (MECS, Gold Standard, Verra, CDM, etc.)

RESPONSE RULES:
- Ground your answers in the provided evidence whenever possible.
- Cite sources inline using EXACTLY this format: [Source Type: Title]
  Examples: [Scholarly: Cookstove adoption in Ghana] [Web: Gold Standard MRV requirements] [Corpus: Accra Clean Cooking Program]
- ONLY cite a source if you actually used it to inform your answer.
- If no evidence was retrieved, answer from general knowledge and flag uncertainty explicitly.
- Be explicit about uncertainty, assumptions, and jurisdictional variability.
- Structure longer answers with clear headings and bullet points.
- Keep answers focused and actionable.
- Never fabricate specific regulations, statistics, or citations."""

EVIDENCE_BLOCK_TEMPLATE = """

RETRIEVED EVIDENCE (use these to ground your response; only cite what you actually used):
{evidence}
"""

# Pattern to extract inline citations the LLM produces, e.g. [Scholarly: Some Title]
_CITATION_RE = re.compile(r'\[([^\]:]+):\s*([^\]]{4,})\]')


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class ComplianceChatResponse:
    content: str
    sources: list[RetrievedFact]
    tiers_used: list[str]
    latency_ms: int


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class ComplianceChatService:
    """
    Orchestrates compliance chat using a plan-then-retrieve-then-generate loop.

    Step 1  — Corpus search (always; fast, local, no API cost)
    Step 2  — Tool planning: lightweight LLM call decides which external
               searches (if any) are worth running for this question
    Step 3  — Execute only the requested tools in parallel
    Step 4  — Generate final answer using only the gathered evidence
    Step 5  — Filter returned sources to only those cited in the answer
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.retrieval = TieredRetrievalService(db)
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def generate_response(
        self,
        user_message: str,
        history: list[dict[str, str]],
        on_thinking: ThinkingCallback | None = None,
    ) -> ComplianceChatResponse:
        start = time.time()

        async def _think(text: str) -> None:
            if on_thinking:
                await on_thinking(text)

        # Step 1: corpus search (if enabled) + tool planning run in parallel (independent)
        search_query = await self._build_search_query(user_message, history)

        async def _corpus_search() -> list[RetrievedFact]:
            if not settings.enable_corpus_rag:
                return []
            return await self.retrieval.search_corpus(search_query, None)

        corpus_task = asyncio.create_task(_corpus_search())
        plan_task = asyncio.create_task(
            self._plan_tool_calls(user_message, history)
        )
        corpus_facts, tool_calls = await asyncio.gather(corpus_task, plan_task)

        all_facts: list[RetrievedFact] = list(corpus_facts)
        tiers_used: list[str] = []

        if corpus_facts:
            tiers_used.append("corpus")
            await _think(f"Found {len(corpus_facts)} relevant case studies")

        # Step 3: execute only the tools the planner requested
        for tool_call in tool_calls:
            fn_name = tool_call.function.name
            try:
                args = json.loads(tool_call.function.arguments)
            except Exception:
                args = {}

            tool_query = args.get("query", search_query)
            reason = args.get("reason", "")
            logger.info(f"Tool called: {fn_name} | query={tool_query!r} | reason={reason!r}")

            if fn_name == "search_scholarly_literature":
                await _think(f"Searching scholarly databases: \"{tool_query}\"...")
                openalex_facts = await self.retrieval.search_openalex(tool_query)
                if openalex_facts:
                    all_facts.extend(openalex_facts)
                    tiers_used.append("openalex")
                    await _think(f"Found {len(openalex_facts)} scholarly works")
                else:
                    await _think("No relevant scholarly works found")

            elif fn_name == "search_web_sources":
                await _think("Searching authoritative web sources...")
                web_facts = await self.retrieval.search_web(tool_query)
                if web_facts:
                    all_facts.extend(web_facts)
                    tiers_used.append("web")
                    await _think(f"Found {len(web_facts)} web sources")
                else:
                    await _think("No authoritative web sources found")

        # Step 4: generate answer — LLM only sees what was actually retrieved
        ranked_facts = self._rank_facts(all_facts)
        source_count = len([f for f in ranked_facts if f.source_type != SourceType.LLM_ESTIMATE])

        if source_count > 0:
            await _think(f"Generating response from {source_count} sources...")
        else:
            await _think("Generating response from general knowledge...")

        content = await self._generate_answer(user_message, history, ranked_facts)

        # Step 5: return only sources that appear cited in the response
        cited_sources = self._extract_cited_sources(content, ranked_facts)

        elapsed_ms = int((time.time() - start) * 1000)
        return ComplianceChatResponse(
            content=content,
            sources=cited_sources,
            tiers_used=tiers_used,
            latency_ms=elapsed_ms,
        )

    # -----------------------------------------------------------------------
    # Internal helpers
    # -----------------------------------------------------------------------

    async def _plan_tool_calls(
        self,
        user_message: str,
        history: list[dict[str, str]],
    ) -> list:
        """
        Ask a fast LLM which search tools (if any) to invoke.
        Returns a list of OpenAI tool_call objects (may be empty).
        """
        messages: list[dict] = [{"role": "system", "content": PLANNING_SYSTEM_PROMPT}]
        for msg in (history[-6:] if len(history) > 6 else history):
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": user_message})

        try:
            resp = await self.client.chat.completions.create(
                model=settings.openai_orchestration_model,
                messages=messages,
                tools=SEARCH_TOOLS,
                tool_choice="auto",
                temperature=0,
                max_tokens=200,
            )
            calls = resp.choices[0].message.tool_calls or []
            if calls:
                names = [c.function.name for c in calls]
                logger.info(f"Planner requested tools: {names}")
            else:
                logger.info("Planner: no external tools needed")
            return calls
        except Exception as e:
            logger.warning(f"Tool planning failed, skipping external search: {e}")
            return []

    async def _build_search_query(
        self,
        user_message: str,
        history: list[dict[str, str]],
    ) -> str:
        """Distill the user message + recent history into a focused corpus search query."""
        if len(history) <= 2:
            return user_message
        try:
            recent = history[-6:] if len(history) > 6 else history
            context = "\n".join(f"{m['role']}: {m['content']}" for m in recent)
            resp = await self.client.chat.completions.create(
                model=settings.openai_orchestration_model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Rewrite the user's latest message as a concise search query "
                            "that captures full intent given the conversation context. "
                            "Return ONLY the query, nothing else. Max 30 words."
                        ),
                    },
                    {
                        "role": "user",
                        "content": f"Conversation:\n{context}\n\nLatest message: {user_message}",
                    },
                ],
                temperature=0,
                max_tokens=60,
            )
            return resp.choices[0].message.content.strip() or user_message
        except Exception as e:
            logger.warning(f"Query rewrite failed, using raw message: {e}")
            return user_message

    def _rank_facts(self, facts: list[RetrievedFact]) -> list[RetrievedFact]:
        """Rank and deduplicate facts: curated corpus > scholarly > web > LLM estimate."""
        tier_order = {
            SourceType.CORPUS: 0,
            SourceType.EVIDENCE: 0,
            SourceType.OPENALEX: 1,
            SourceType.WEB: 2,
            SourceType.LLM_ESTIMATE: 3,
        }
        sorted_facts = sorted(
            facts,
            key=lambda f: (tier_order.get(f.source_type, 9), -f.confidence),
        )
        seen: set[str] = set()
        deduped: list[RetrievedFact] = []
        for fact in sorted_facts:
            key = fact.source_title.lower().strip()
            if key not in seen:
                seen.add(key)
                deduped.append(fact)
        return deduped[:10]

    async def _generate_answer(
        self,
        user_message: str,
        history: list[dict[str, str]],
        facts: list[RetrievedFact],
    ) -> str:
        """Generate the final answer grounded only in the retrieved evidence."""
        if facts:
            lines = []
            for f in facts:
                citation = f.to_citation_string()
                snippet = f.content[:500]
                lines.append(f"{citation}\n{snippet}")
            evidence_block = EVIDENCE_BLOCK_TEMPLATE.format(evidence="\n\n".join(lines))
        else:
            evidence_block = "\n\nNo external sources were retrieved. Answer from general knowledge and flag uncertainty explicitly.\n"

        messages: list[dict] = [
            {"role": "system", "content": SYSTEM_PROMPT + evidence_block},
        ]
        for msg in (history[-10:] if len(history) > 10 else history):
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": user_message})

        resp = await self.client.chat.completions.create(
            model=settings.openai_generation_model,
            messages=messages,
            temperature=0.4,
            max_tokens=1200,
        )
        return resp.choices[0].message.content or ""

    def _extract_cited_sources(
        self,
        content: str,
        facts: list[RetrievedFact],
    ) -> list[RetrievedFact]:
        """
        Parse [Source Type: Title] citations from the generated response and
        return only the RetrievedFact objects that were actually referenced.

        Falls back to returning corpus/evidence facts (provided as passive
        context even when not explicitly named) if no inline citations found.
        """
        matches = _CITATION_RE.findall(content)
        if not matches:
            # No inline citations — return corpus facts that informed context
            return [f for f in facts if f.source_type in (SourceType.CORPUS, SourceType.EVIDENCE)]

        cited: list[RetrievedFact] = []
        for _source_type, cited_title in matches:
            cited_lower = cited_title.lower().strip()
            for fact in facts:
                if fact in cited:
                    continue
                fact_lower = fact.source_title.lower().strip()
                # Match if titles share meaningful overlap
                if cited_lower in fact_lower or fact_lower in cited_lower:
                    cited.append(fact)
                    continue
                # Word-overlap fallback: ≥2 significant words in common
                cited_words = {w for w in cited_lower.split() if len(w) > 3}
                fact_words = {w for w in fact_lower.split() if len(w) > 3}
                if len(cited_words & fact_words) >= 2:
                    cited.append(fact)

        # Always include corpus facts that were used as background context
        for fact in facts:
            if fact.source_type in (SourceType.CORPUS, SourceType.EVIDENCE) and fact not in cited:
                cited.append(fact)

        return cited
