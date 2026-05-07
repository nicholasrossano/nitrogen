"""
Shared deep-dive overview service.

All deep-dive surfaces use this one lightweight pipeline:
  1. Build an assessment-aware search prompt.
  2. Run one authoritative web-search LLM call.
  3. Run fast project-evidence RAG in parallel.
  4. Return a cited overview payload for inspector panels.
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlparse

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.llm_client import get_openai_client, record_usage_from_response
from app.models.initiative import Initiative
from app.schemas.provenance import (
    Derivation,
    ItemProvenance,
    SourceAttribution,
    source_attribution_from_retrieved_fact,
)
from app.services.rag import RAGService
from app.services.assumptions import format_assumptions_for_initiative_prompt
from app.services.tiered_retrieval import RetrievedFact, TieredRetrievalService

settings = get_settings()
logger = logging.getLogger(__name__)


def _format_assessment_type(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = value.replace("_", " ").replace("-", " ").strip()
    if not cleaned:
        return None
    return " ".join(token.capitalize() for token in cleaned.split())


@dataclass(frozen=True)
class DeepDiveAssessmentSettings:
    label: str
    search_focus: str
    overview_questions: tuple[str, ...]


DEFAULT_DEEP_DIVE_SETTINGS = DeepDiveAssessmentSettings(
    label="General Deep Dive",
    search_focus=(
        "Use authoritative sources first: government agencies, official project "
        "or institution pages, multilateral organizations, standards bodies, and "
        "primary-source documentation."
    ),
    overview_questions=(
        "What is this entity, requirement, deliverable, or topic?",
        "Why does it matter for the project context?",
        "What should the user know before deciding how to act on it?",
    ),
)


DEEP_DIVE_ASSESSMENT_SETTINGS: dict[str, DeepDiveAssessmentSettings] = {
    "implementation_plan": DeepDiveAssessmentSettings(
        label="Implementation Plan",
        search_focus=(
            "Prioritize official guidance, implementer documentation, funder or "
            "regulator pages, and primary sources that explain the deliverable or task."
        ),
        overview_questions=(
            "What is this implementation item?",
            "Why does it matter for project execution?",
            "What official or authoritative context should guide next steps?",
        ),
    ),
    "landscape_mapping": DeepDiveAssessmentSettings(
        label="Landscape Mapping",
        search_focus=(
            "Prioritize official agency pages, government portals, geospatial data "
            "catalogs, mapping authorities, policy documents, and multilateral sources."
        ),
        overview_questions=(
            "What is this landscape-map entity or data source?",
            "What role does it play in understanding the project geography or operating context?",
            "What authoritative source best establishes its relevance?",
        ),
    ),
    "stakeholder_assessment": DeepDiveAssessmentSettings(
        label="Stakeholder Assessment",
        search_focus=(
            "Prioritize official organization pages, regulator or ministry pages, "
            "credible institutional profiles, and sources describing mandate, influence, or role."
        ),
        overview_questions=(
            "Who is this stakeholder or institution?",
            "What role, mandate, or influence might it have for this project?",
            "What context helps determine engagement priority?",
        ),
    ),
}


def _settings_for_assessment(assessment_type: str | None) -> DeepDiveAssessmentSettings:
    if not assessment_type:
        return DEFAULT_DEEP_DIVE_SETTINGS
    key = assessment_type.strip().lower().replace("-", "_").replace(" ", "_")
    return DEEP_DIVE_ASSESSMENT_SETTINGS.get(key, DEFAULT_DEEP_DIVE_SETTINGS)


def _clean_overview_text(text: str) -> str:
    cleaned = text.strip()
    for prefix in (
        "Here is a concise, authoritative overview:",
        "Here is a concise overview:",
        "Here is an overview:",
        "Overview:",
    ):
        if cleaned.lower().startswith(prefix.lower()):
            return cleaned[len(prefix):].strip()
    return cleaned


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

QUERY_GEN_SYSTEM_PROMPT = """You are a search query specialist for regulatory compliance research.

Given a project plan requirement (title, rationale, geography), generate exactly 3
search-engine-optimized queries that will find the relevant government portals,
official checklists, application forms, and regulatory guidance for this requirement.

QUERY STRATEGY
- Query 1: Target the specific regulation/act/instrument mentioned in the rationale
  (e.g. "Ghana EPA Act 490 L.I. 2454 environmental screening requirements")
- Query 2: Target the responsible government agency + application process + forms
  (e.g. "Ghana EPA environmental permit application form checklist documents")
- Query 3: Target the deliverable name + geography + "how to apply" or "submission"
  (e.g. "environmental impact assessment submission Ghana official guide")

RULES
- Prefer keyword-style queries over full sentences — search engines respond better
- Always include the geography and the specific regulatory body or standard name
- Do NOT add quotes around the query terms
- Keep each query under 12 words
"""

QUERY_GEN_FUNCTION = {
    "type": "function",
    "function": {
        "name": "generate_search_queries",
        "description": "Generate 3 precision search queries for finding official regulatory sources.",
        "parameters": {
            "type": "object",
            "properties": {
                "queries": {
                    "type": "array",
                    "items": {"type": "string"},
                    "minItems": 3,
                    "maxItems": 3,
                    "description": "Exactly 3 search queries, ordered from most to least specific.",
                }
            },
            "required": ["queries"],
        },
    },
}

DEEP_DIVE_SYSTEM_PROMPT = """You are a regulatory and program compliance analyst.

Your task: evaluate a specific project plan sub-item and produce a list of the key
elements the applicant must prepare, submit, or obtain to satisfy this requirement.

ELEMENT TITLE FORMAT — CRITICAL
Each element title must be a SHORT NOUN PHRASE — a document, permit, study, or
artifact name. NOT a verb instruction.

GOOD titles (noun phrases):
  ✓ "Project site map with boundary and sensitive receptor locations"
  ✓ "Letter of no-objection from the local planning authority"
  ✓ "Proof of land tenure or lease agreement"
  ✓ "Environmental and Social Impact Assessment (ESIA)"
  ✓ "M&E plan with baseline indicators and data collection methodology"

BAD titles (verb phrases — do NOT use):
  ✗ "Prepare a detailed project budget..."
  ✗ "Obtain a letter of no-objection..."
  ✗ "Submit proof of land tenure..."
  ✗ "Conduct a baseline environmental study"

The description field is where you explain what the element entails, what it must
contain, and where/how it is submitted.

SOURCE GROUNDING RULES
- An element may only be classified "required" if a retrieved source explicitly
  supports it. If no source supports it, classify as "unknown".
- When a retrieved source describes an application form or checklist, use the
  specific fields or sections that form asks for as the basis for your elements.
  Reference the form/source name in the description (e.g. "as required by Form
  EA-1, Section 3 of the EPA screening checklist").
- If no authoritative web sources were retrieved, cap ALL classifications at
  "unknown" and note in each description that independent verification is needed.

CLASSIFICATION RULES
- "required"  → a retrieved source (government portal, statutory text, official
                 checklist) explicitly lists this as a required component.
- "optional"  → sources indicate it is helpful, recommended, or situational but
                 not mandated.
- "unknown"   → no source confirms it, or requirement varies by jurisdiction /
                 project details. State what would resolve the classification.

ELEMENT SELECTION FOCUS
Focus on structurally important documents — not exhaustive form fields. Prioritize:
  • Permits, licences, and official approvals
  • Application forms and their key annexes
  • Plans and studies required as part of the application package
  • Stakeholder approvals and letters of support
  • Financial / budget tables required by the funder or regulator
  • Eligibility declarations or organizational capacity proofs

TOPIC-SPECIFIC GUIDANCE
For financing-route sub-items (grants, carbon credits, blended finance):
  • Focus on application package components: concept note, logframe/M&E, budget tables.
  • Do NOT give generic fundraising advice.

For compliance / authorization sub-items:
  • Focus on the specific permits, inspection certificates, and approved plans.

INTEGRITY RULES
- Never fabricate regulations, form numbers, agency names, or specific statistics.
- Cap elements at 10. List in descending order of importance / blocking risk.

DEPENDENCY FORMAT
- condition: Start with a capital letter (e.g. "Only if the installation involves grid connection").
- effect: Full sentence(s) describing what is required under that condition.
- The UI displays condition (bold) on the first line, then effect on the next line.
"""

DEEP_DIVE_FUNCTION = {
    "type": "function",
    "function": {
        "name": "produce_deep_dive",
        "description": "Produce a structured deep dive evaluation of a project plan sub-item.",
        "parameters": {
            "type": "object",
            "properties": {
                "what_this_is": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "text": {
                                "type": "string",
                                "description": (
                                    "One plain-English sentence summarizing what this requirement is "
                                    "or why it exists. Bold the single most important takeaway sentence "
                                    "using **markdown bold**. Bold at most one sentence across the array."
                                ),
                            },
                            "source_indices": {
                                "type": "array",
                                "items": {"type": "integer"},
                                "description": "1-based indices of the [S1], [S2], etc. web sources used for this sentence.",
                            },
                            "document_indices": {
                                "type": "array",
                                "items": {"type": "integer"},
                                "description": "1-based indices of the [D1], [D2], etc. uploaded project documents used for this sentence.",
                            },
                        },
                        "required": ["text"],
                    },
                    "description": (
                        "2–3 plain-English sentences — no more — summarizing what this requirement "
                        "is and why it exists. Each sentence must add new information; do not restate "
                        "or paraphrase a point already made. Be concrete and specific to the project "
                        "context. Attach only the sources actually used for each sentence."
                    ),
                },
                "elements": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {
                                "type": "string",
                                "description": (
                                    "Short noun phrase naming the document, permit, study, or "
                                    "artifact (e.g. 'Environmental screening form', "
                                    "'Land tenure certificate'). 3–8 words. NO leading verbs."
                                ),
                            },
                            "description": {
                                "type": "string",
                                "description": (
                                    "1 sentence, 2 maximum. State what this element must contain "
                                    "and who issues or requires it. Each sentence must add new "
                                    "information — do not restate the title or repeat a point "
                                    "already made. Reference specific form names or sections where possible."
                                ),
                            },
                            "classification": {
                                "type": "string",
                                "enum": ["required", "optional", "unknown"],
                            },
                            "source_indices": {
                                "type": "array",
                                "items": {"type": "integer"},
                                "description": "1-based indices of the RETRIEVED EVIDENCE sources that support this element.",
                            },
                            "document_indices": {
                                "type": "array",
                                "items": {"type": "integer"},
                                "description": "1-based indices of the UPLOADED PROJECT DOCUMENTS that support this element.",
                            },
                        },
                        "required": ["title", "description", "classification"],
                    },
                    "description": (
                        "Prioritized list (most important / highest blocking risk first) "
                        "of key elements. Cap at 10."
                    ),
                },
                "dependencies": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "condition": {
                                "type": "string",
                                "description": (
                                    "The triggering condition, capitalized (e.g. 'Only if the "
                                    "installation involves grid connection'). Start with a capital letter."
                                ),
                            },
                            "effect": {
                                "type": "string",
                                "description": (
                                    "What changes or is required under this condition. "
                                    "Full sentence(s) — will be displayed on a new line after the condition."
                                ),
                            },
                        },
                        "required": ["condition", "effect"],
                    },
                    "description": (
                        "Declarative if/then notes about conditions that change what is "
                        "required. State conditions — do NOT ask questions. Condition and "
                        "effect are displayed separately (condition bold, effect on new line)."
                    ),
                },
            },
            "required": ["what_this_is", "elements", "dependencies"],
        },
    },
}

UPLOADED_DOCS_BLOCK_TEMPLATE = """

UPLOADED PROJECT DOCUMENTS (these are documents the user uploaded for this project;
they may contain evidence that elements are already completed or in progress):
{uploaded_docs}
"""

EVIDENCE_BLOCK_TEMPLATE = """

RETRIEVED EVIDENCE (ground your classifications in these sources; cite form/checklist
names and section references where present):
{evidence}
"""

NO_EVIDENCE_BLOCK = (
    "\n\nNo authoritative web sources were retrieved. "
    "Classify ALL elements as 'unknown' and note in each description that "
    "independent verification against official sources is required.\n"
)


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass
class DeepDiveElement:
    title: str
    description: str
    classification: str  # "required" | "optional" | "unknown"
    provenance: dict | None = None


@dataclass
class DeepDiveDependency:
    condition: str
    effect: str


@dataclass
class DeepDiveSource:
    title: str
    url: str | None
    source_type: str
    publisher: str | None = None
    excerpt: str | None = None
    evidence_doc_id: str | None = None
    chunk_id: str | None = None


@dataclass
class DeepDiveResult:
    item_id: str
    item_title: str
    pillar_name: str
    what_this_is: list[str]
    summary_citations: list[list[int]]
    elements: list[DeepDiveElement]
    dependencies: list[DeepDiveDependency]
    sources: list[DeepDiveSource]
    generated_at: str
    latency_ms: int


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class DeepDiveService:
    """
    Runs targeted web research + LLM analysis for a single project plan sub-item.

    Flow:
      1. gpt-4o-mini generates 3 precision search queries from item title/rationale/geo.
      2. Fire all 3 web searches in parallel via TieredRetrievalService.
      3. Deduplicate results by URL.
      4. Call main LLM with structured function calling to produce the deep dive output.
      5. Return typed DeepDiveResult.
    """
    QUERY_GEN_TIMEOUT_SECONDS = 8.0
    STRUCTURED_TIMEOUT_SECONDS = 12.0
    MAX_WEB_QUERIES = 2

    def __init__(self, db: AsyncSession, user_id: str | None = None):
        self.db = db
        self.user_id = user_id
        self._client: AsyncOpenAI | None = None
        self._is_byok: bool = False
        self.retrieval = TieredRetrievalService(db, user_id=self.user_id)
        self.rag = RAGService(db)

    async def _get_client(self) -> AsyncOpenAI:
        if self._client is None:
            self._client, self._is_byok = await get_openai_client(self.user_id, self.db)
        return self._client

    async def generate(
        self,
        initiative: Initiative,
        item_id: str,
        item_title: str,
        item_classification: str,
        item_rationale: str,
        pillar_name: str,
        assessment_type: str | None = None,
    ) -> DeepDiveResult:
        start = time.time()

        # Assemble project context for the LLM
        context_lines: list[str] = []
        if initiative.title:
            context_lines.append(f"Project title: {initiative.title}")
        if initiative.project_type:
            context_lines.append(f"Project type: {initiative.project_type}")
        if initiative.geography:
            context_lines.append(f"Geography: {initiative.geography}")
        if initiative.project_description:
            context_lines.append(
                f"Description: {initiative.project_description[:600]}"
            )
        pretty_assessment_type = _format_assessment_type(assessment_type)
        if pretty_assessment_type:
            context_lines.append(f"Assessment type: {pretty_assessment_type}")
        assumptions_context = await format_assumptions_for_initiative_prompt(self.db, initiative.id)
        if assumptions_context:
            context_lines.append(assumptions_context)
        project_context = "\n".join(context_lines) if context_lines else "Not specified"

        assessment_settings = _settings_for_assessment(assessment_type)
        search_prompt = self._build_search_prompt(
            item_title=item_title,
            item_rationale=item_rationale,
            pillar_name=pillar_name,
            project_context=project_context,
            assessment_settings=assessment_settings,
        )

        logger.info(
            "Deep dive overview item=%r assessment=%r",
            item_id,
            assessment_settings.label,
        )

        # Run one web-search overview and fast project evidence lookup in parallel.
        rag_query = f"{item_title} {item_rationale or ''}"
        overview_coro = self._generate_overview_with_web_search(search_prompt)
        evidence_coro = self.rag.retrieve(
            query=rag_query,
            initiative_id=initiative.id,
            sources=["evidence"],
            evidence_top_k=3,
            corpus_top_k=0,
        )
        overview_result, evidence_chunks_result = await asyncio.gather(
            overview_coro,
            evidence_coro,
            return_exceptions=True,
        )

        if isinstance(overview_result, BaseException):
            logger.warning("Deep dive overview web search failed: %s", overview_result)
            summary_items = []
            web_sources = []
        else:
            summary_items = overview_result["summary_items"]
            web_sources = overview_result["sources"]

        # Collect evidence chunks (RAG results from uploaded documents)
        evidence_chunks = []
        if not isinstance(evidence_chunks_result, BaseException):
            evidence_chunks = evidence_chunks_result
        else:
            logger.warning("Evidence RAG failed: %s", evidence_chunks_result)

        logger.info(
            "Deep dive gathered %d web sources + %d evidence chunks",
            len(web_sources), len(evidence_chunks),
        )

        # Build source list — only facts/documents the model explicitly cited.
        sources: list[DeepDiveSource] = list(web_sources)
        doc_index_to_citation_number: dict[int, int] = {}
        for idx, chunk in enumerate(evidence_chunks, 1):
            sources.append(DeepDiveSource(
                title=chunk.source_title,
                url=None,
                source_type="evidence",
                excerpt=chunk.content[:300] if chunk.content else None,
                evidence_doc_id=str(chunk.source_doc_id),
                chunk_id=str(chunk.chunk_id),
            ))
            doc_index_to_citation_number[idx] = len(sources)

        summary_citations = [item["source_indices"] for item in summary_items]

        elapsed_ms = int((time.time() - start) * 1000)
        return DeepDiveResult(
            item_id=item_id,
            item_title=item_title,
            pillar_name=pillar_name,
            what_this_is=[item["text"] for item in summary_items],
            summary_citations=summary_citations,
            elements=[],
            dependencies=[],
            sources=sources,
            generated_at=datetime.now(timezone.utc).isoformat(),
            latency_ms=elapsed_ms,
        )

    # -----------------------------------------------------------------------
    # Internal
    # -----------------------------------------------------------------------

    def _build_search_prompt(
        self,
        *,
        item_title: str,
        item_rationale: str,
        pillar_name: str,
        project_context: str,
        assessment_settings: DeepDiveAssessmentSettings,
    ) -> str:
        questions = "\n".join(f"- {question}" for question in assessment_settings.overview_questions)
        return (
            "Run a concise authoritative web search and answer only with a 2-3 sentence overview.\n\n"
            "SOURCE PRIORITY\n"
            f"{assessment_settings.search_focus}\n"
            "Prefer primary and institutional sources over blogs, SEO pages, or generic summaries.\n\n"
            "QUESTIONS TO ANSWER\n"
            f"{questions}\n\n"
            "PROJECT CONTEXT\n"
            f"{project_context}\n\n"
            "ITEM TO EXPLAIN\n"
            f"Title: {item_title}\n"
            f"Category/Pillar: {pillar_name or 'Not specified'}\n"
            f"Existing rationale/context: {item_rationale or 'Not provided'}\n\n"
            "Write plainly for a project team. Do not list requirements or action items. "
            "Use citations from the web search result."
        )

    async def _generate_overview_with_web_search(self, prompt: str) -> dict:
        client = await self._get_client()
        resp = await asyncio.wait_for(
            client.responses.create(
                model=settings.openai_orchestration_model,
                tools=[{"type": "web_search", "search_context_size": "low"}],
                input=prompt,
            ),
            timeout=self.STRUCTURED_TIMEOUT_SECONDS,
        )
        await record_usage_from_response(self.user_id, settings.openai_orchestration_model, resp, self.db, is_byok=self._is_byok)

        text_parts: list[str] = []
        sources: list[DeepDiveSource] = []
        url_to_citation: dict[str, int] = {}

        for item in resp.output:
            if getattr(item, "type", None) != "message":
                continue
            for block in item.content:
                text = getattr(block, "text", "") or ""
                if text:
                    text_parts.append(text.strip())
                for ann in getattr(block, "annotations", []) or []:
                    if getattr(ann, "type", None) != "url_citation":
                        continue
                    url = getattr(ann, "url", "") or ""
                    if not url or url in url_to_citation:
                        continue
                    title = getattr(ann, "title", "") or "Web Source"
                    publisher = None
                    try:
                        publisher = urlparse(url).netloc.lstrip("www.") or None
                    except Exception:
                        pass
                    sources.append(DeepDiveSource(
                        title=title,
                        url=url,
                        source_type="web",
                        publisher=publisher,
                    ))
                    url_to_citation[url] = len(sources)

        overview_text = _clean_overview_text(" ".join(part for part in text_parts if part))
        sentences = [
            sentence.strip()
            for sentence in overview_text.replace("\n", " ").split(". ")
            if sentence.strip()
        ][:3]
        if not sentences:
            return {"summary_items": [], "sources": sources}

        citation_numbers = list(range(1, min(len(sources), 3) + 1))
        summary_items = []
        for idx, sentence in enumerate(sentences):
            text = sentence if sentence.endswith((".", "!", "?")) else f"{sentence}."
            summary_items.append({
                "text": text,
                "source_indices": citation_numbers if idx == 0 else [],
            })
        return {"summary_items": summary_items, "sources": sources}

    async def _generate_search_queries(
        self,
        item_title: str,
        item_rationale: str,
        geography: str,
        pillar_name: str,
        assessment_type: str | None = None,
    ) -> list[str]:
        """Use gpt-4o-mini to generate 3 precision search queries targeting government sources."""
        assessment_line = f"Assessment type: {assessment_type}\n" if assessment_type else ""
        user_message = (
            f"Requirement: {item_title}\n"
            f"Pillar: {pillar_name}\n"
            f"{assessment_line}"
            f"Geography: {geography or 'Not specified'}\n"
            f"Rationale (may name specific regulations/agencies): {item_rationale or 'Not provided'}\n\n"
            "Generate 3 search queries to find the official government portal pages, "
            "application forms, and regulatory checklists for this requirement."
        )

        try:
            client = await self._get_client()
            resp = await asyncio.wait_for(
                client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": QUERY_GEN_SYSTEM_PROMPT},
                        {"role": "user", "content": user_message},
                    ],
                    tools=[QUERY_GEN_FUNCTION],
                    tool_choice={"type": "function", "function": {"name": "generate_search_queries"}},
                    temperature=0.2,
                    max_tokens=300,
                ),
                timeout=self.QUERY_GEN_TIMEOUT_SECONDS,
            )
            await record_usage_from_response(self.user_id, "gpt-4o-mini", resp, self.db, is_byok=self._is_byok)
            tool_calls = resp.choices[0].message.tool_calls
            if tool_calls:
                data = json.loads(tool_calls[0].function.arguments)
                queries = data.get("queries", [])
                if len(queries) >= 2:
                    return queries[:3]
        except TimeoutError:
            logger.warning(
                "Query generation timed out after %.1fs; using fallback queries",
                self.QUERY_GEN_TIMEOUT_SECONDS,
            )
        except Exception as exc:
            logger.warning("Query generation failed, using fallback queries: %s", exc)

        # Fallback to basic queries if LLM call fails
        geo_tag = f" {geography}" if geography else ""
        return [
            f"{item_title}{geo_tag} official requirements government",
            f"{item_title}{geo_tag} application process documents needed",
            f"{item_rationale[:80]}{geo_tag} requirements checklist" if item_rationale else f"{item_title}{geo_tag} permit checklist",
        ]

    async def _generate_structured(
        self,
        item_title: str,
        item_classification: str,
        item_rationale: str,
        pillar_name: str,
        project_context: str,
        facts: list[RetrievedFact],
        assessment_type: str | None = None,
        evidence_chunks: list | None = None,
    ) -> dict:
        """Call the LLM with forced function calling to produce the structured result."""

        # Format uploaded evidence chunks (from RAG)
        uploaded_docs_block = ""
        if evidence_chunks:
            doc_lines: list[str] = []
            for i, chunk in enumerate(evidence_chunks[:5], 1):
                doc_lines.append(f"[D{i}] [{chunk.source_title}]\n{chunk.content[:600]}")
            uploaded_docs_block = UPLOADED_DOCS_BLOCK_TEMPLATE.format(
                uploaded_docs="\n\n".join(doc_lines)
            )

        # Format web research facts
        if facts:
            lines: list[str] = []
            for i, f in enumerate(facts[:12], 1):
                url_ref = f" ({f.source_url})" if f.source_url else ""
                lines.append(f"[S{i}] [{f.source_title}{url_ref}]\n{f.content[:1000]}")
            evidence_block = EVIDENCE_BLOCK_TEMPLATE.format(
                evidence="\n\n".join(lines)
            )
        else:
            evidence_block = NO_EVIDENCE_BLOCK

        source_cite_instruction = ""
        if facts:
            source_cite_instruction = (
                "\n\nFor each 'what_this_is' sentence and each element, include source_indices "
                "referencing only the [S1], [S2], etc. numbered web sources actually used for "
                "that sentence or element. Required elements MUST cite at least one source."
            )

        uploaded_cite_instruction = ""
        if evidence_chunks:
            uploaded_cite_instruction = (
                "\n\nThe project's uploaded documents are shown above as [D1], [D2], etc. "
                "If any uploaded document supports a 'what_this_is' sentence or an element, "
                "include its index in document_indices. If an uploaded document shows that an "
                "element has already been completed or partially addressed, note this in the "
                "element's description (e.g. 'The uploaded [document name] appears to satisfy "
                "this requirement.')."
            )

        user_message = (
            f"PROJECT CONTEXT\n{project_context}\n\n"
            f"SUB-ITEM TO ANALYZE\n"
            f"Title: {item_title}\n"
            f"Pillar: {pillar_name}\n"
            f"Assessment type: {assessment_type or 'Not specified'}\n"
            f"Current classification: {item_classification}\n"
            f"Rationale (identifies the regulation/source): {item_rationale}\n\n"
            f"TASK\nIdentify the key elements the applicant must produce or provide "
            f"to satisfy this requirement. Ground each element in the retrieved sources "
            f"where possible. Use noun-phrase titles (document/permit names), not verb instructions."
            f"{uploaded_docs_block}{evidence_block}{source_cite_instruction}{uploaded_cite_instruction}"
        )

        messages: list[dict] = [
            {"role": "system", "content": DEEP_DIVE_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ]

        client = await self._get_client()
        try:
            resp = await asyncio.wait_for(
                client.chat.completions.create(
                    model=settings.openai_orchestration_model,
                    messages=messages,
                    tools=[DEEP_DIVE_FUNCTION],
                    tool_choice={"type": "function", "function": {"name": "produce_deep_dive"}},
                    temperature=0.3,
                    max_tokens=2000,
                ),
                timeout=self.STRUCTURED_TIMEOUT_SECONDS,
            )
        except TimeoutError:
            logger.warning(
                "Deep dive structured generation timed out after %.1fs",
                self.STRUCTURED_TIMEOUT_SECONDS,
            )
            return {"what_this_is": [], "elements": [], "dependencies": []}
        await record_usage_from_response(self.user_id, settings.openai_orchestration_model, resp, self.db, is_byok=self._is_byok)

        tool_calls = resp.choices[0].message.tool_calls
        if not tool_calls:
            logger.warning("Deep dive: LLM returned no tool call")
            return {"what_this_is": [], "elements": [], "dependencies": []}

        try:
            return json.loads(tool_calls[0].function.arguments)
        except Exception as exc:
            logger.error("Deep dive: failed to parse tool call arguments: %s", exc)
            return {"what_this_is": [], "elements": [], "dependencies": []}

    async def get_evidence_sources(
        self,
        initiative: Initiative,
        item_title: str,
        item_rationale: str,
    ) -> list[DeepDiveSource]:
        """Run a fast evidence-only RAG lookup for an item.

        Called at the API layer for both cached and fresh deep dives so that
        document citations are always up-to-date regardless of cache age.
        """
        if not initiative.id:
            return []
        rag_query = f"{item_title} {item_rationale or ''}".strip()
        try:
            chunks = await self.rag.retrieve(
                query=rag_query,
                initiative_id=initiative.id,
                sources=["evidence"],
                evidence_top_k=5,
                corpus_top_k=0,
            )
        except Exception as exc:
            logger.warning("Evidence RAG failed for deep dive: %s", exc)
            return []

        seen_doc_ids: set[str] = set()
        sources: list[DeepDiveSource] = []
        for chunk in chunks:
            doc_id = str(chunk.source_doc_id)
            if doc_id in seen_doc_ids:
                continue
            seen_doc_ids.add(doc_id)
            sources.append(DeepDiveSource(
                title=chunk.source_title,
                url=None,
                source_type="evidence",
                excerpt=chunk.content[:300] if chunk.content else None,
                evidence_doc_id=doc_id,
                chunk_id=str(chunk.chunk_id),
            ))
        logger.info("Deep dive evidence sources for item=%r: %d doc(s)", item_title, len(sources))
        return sources
