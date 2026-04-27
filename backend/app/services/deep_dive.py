"""
Deep Dive Service

Given a project plan sub-item and project context, performs targeted research to
identify the key elements needed to complete that requirement.

Flow:
  1. LLM (gpt-4o-mini) generates 4 precision search queries from item title +
     rationale + geography, targeting government portals and official checklists.
  2. Fire all 4 queries in parallel via web search.
  3. Deduplicate results by URL.
  4. Call main LLM with structured function calling to produce the deep dive output,
     grounded in the retrieved sources.
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone

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
from app.services.tiered_retrieval import RetrievedFact, TieredRetrievalService

settings = get_settings()
logger = logging.getLogger(__name__)

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

    def __init__(self, db: AsyncSession, user_id: str | None = None):
        self.db = db
        self.user_id = user_id
        self._client: AsyncOpenAI | None = None
        self._is_byok: bool = False
        self.retrieval = TieredRetrievalService(db)
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
        project_context = "\n".join(context_lines) if context_lines else "Not specified"

        # Step 1: Generate precision search queries via fast LLM call
        queries = await self._generate_search_queries(
            item_title=item_title,
            item_rationale=item_rationale,
            geography=initiative.geography or "",
            pillar_name=pillar_name,
        )

        logger.info("Deep dive item=%r  queries=%r", item_id, queries)

        # Step 2: Fire web searches + evidence RAG in parallel
        rag_query = f"{item_title} {item_rationale or ''}"
        search_coros = [self.retrieval.search_web(q, max_results=5, max_content_length=800) for q in queries]
        evidence_coro = self.rag.retrieve(
            query=rag_query,
            initiative_id=initiative.id,
            sources=["evidence"],
            evidence_top_k=5,
            corpus_top_k=0,
        )
        results = await asyncio.gather(*search_coros, evidence_coro, return_exceptions=True)

        web_batches = results[:-1]
        evidence_chunks_result = results[-1]

        # Collect web facts
        seen: set[str] = set()
        all_facts: list[RetrievedFact] = []
        for batch in web_batches:
            if isinstance(batch, BaseException):
                logger.warning("Web search batch failed: %s", batch)
                continue
            for fact in batch:
                key = (fact.source_url or fact.source_title).lower().strip()
                if key not in seen:
                    seen.add(key)
                    all_facts.append(fact)

        # Collect evidence chunks (RAG results from uploaded documents)
        evidence_chunks = []
        if not isinstance(evidence_chunks_result, BaseException):
            evidence_chunks = evidence_chunks_result
        else:
            logger.warning("Evidence RAG failed: %s", evidence_chunks_result)

        logger.info(
            "Deep dive gathered %d unique web facts + %d evidence chunks",
            len(all_facts), len(evidence_chunks),
        )

        # Step 3: Generate structured output
        result_data = await self._generate_structured(
            item_title=item_title,
            item_classification=item_classification,
            item_rationale=item_rationale,
            pillar_name=pillar_name,
            project_context=project_context,
            facts=all_facts,
            evidence_chunks=evidence_chunks,
        )

        # Collect the exact source references the model attached to visible summary
        # sentences and element classifications.
        raw_summary = result_data.get("what_this_is", [])
        summary_items: list[dict] = []
        referenced_web_indices: set[int] = set()
        referenced_doc_indices: set[int] = set()
        for item in raw_summary:
            if isinstance(item, str):
                summary_items.append({"text": item, "source_indices": [], "document_indices": []})
                continue
            if not isinstance(item, dict):
                continue
            text = str(item.get("text") or "").strip()
            if not text:
                continue
            source_indices = [
                idx for idx in item.get("source_indices", [])
                if isinstance(idx, int) and 1 <= idx <= len(all_facts)
            ]
            document_indices = [
                idx for idx in item.get("document_indices", [])
                if isinstance(idx, int) and 1 <= idx <= len(evidence_chunks)
            ]
            referenced_web_indices.update(source_indices)
            referenced_doc_indices.update(document_indices)
            summary_items.append({
                "text": text,
                "source_indices": source_indices,
                "document_indices": document_indices,
            })

        # Attach per-element provenance from LLM-emitted source indices.
        elements: list[DeepDiveElement] = []
        for el in result_data.get("elements", []):
            indices = el.get("source_indices") or []
            doc_indices = el.get("document_indices") or []
            source_attrs = []
            for idx in indices:
                if isinstance(idx, int) and 1 <= idx <= len(all_facts):
                    referenced_web_indices.add(idx)
                    source_attrs.append(
                        source_attribution_from_retrieved_fact(all_facts[idx - 1]).model_dump()
                    )
            for idx in doc_indices:
                if isinstance(idx, int) and 1 <= idx <= len(evidence_chunks):
                    referenced_doc_indices.add(idx)
            derivation = Derivation.RESEARCHED if source_attrs else Derivation.INFERRED
            prov = ItemProvenance(
                derivation=derivation,
                sources=[SourceAttribution(**sa) for sa in source_attrs],
                rationale=el.get("description", ""),
            ).model_dump()
            elements.append(DeepDiveElement(
                title=el["title"],
                description=el["description"],
                classification=el["classification"],
                provenance=prov,
            ))

        # Build source list — only facts/documents the model explicitly cited.
        sources: list[DeepDiveSource] = []
        web_index_to_citation_number: dict[int, int] = {}
        doc_index_to_citation_number: dict[int, int] = {}
        for idx, f in enumerate(all_facts, 1):
            if idx not in referenced_web_indices or not f.source_url:
                continue
            sources.append(DeepDiveSource(
                title=f.source_title,
                url=f.source_url,
                source_type=f.source_type.value,
                publisher=f.publisher,
            ))
            web_index_to_citation_number[idx] = len(sources)

        for idx, chunk in enumerate(evidence_chunks, 1):
            if idx not in referenced_doc_indices:
                continue
            sources.append(DeepDiveSource(
                title=chunk.source_title,
                url=None,
                source_type="evidence",
                excerpt=chunk.content[:300] if chunk.content else None,
                evidence_doc_id=str(chunk.source_doc_id),
                chunk_id=str(chunk.chunk_id),
            ))
            doc_index_to_citation_number[idx] = len(sources)

        summary_citations: list[list[int]] = []
        for item in summary_items:
            citation_numbers: list[int] = []
            for idx in item["source_indices"]:
                citation_number = web_index_to_citation_number.get(idx)
                if citation_number and citation_number not in citation_numbers:
                    citation_numbers.append(citation_number)
            for idx in item["document_indices"]:
                citation_number = doc_index_to_citation_number.get(idx)
                if citation_number and citation_number not in citation_numbers:
                    citation_numbers.append(citation_number)
            summary_citations.append(citation_numbers)

        elapsed_ms = int((time.time() - start) * 1000)
        return DeepDiveResult(
            item_id=item_id,
            item_title=item_title,
            pillar_name=pillar_name,
            what_this_is=[item["text"] for item in summary_items],
            summary_citations=summary_citations,
            elements=elements,
            dependencies=[
                DeepDiveDependency(
                    condition=d["condition"],
                    effect=d["effect"],
                )
                for d in result_data.get("dependencies", [])
            ],
            sources=sources,
            generated_at=datetime.now(timezone.utc).isoformat(),
            latency_ms=elapsed_ms,
        )

    # -----------------------------------------------------------------------
    # Internal
    # -----------------------------------------------------------------------

    async def _generate_search_queries(
        self,
        item_title: str,
        item_rationale: str,
        geography: str,
        pillar_name: str,
    ) -> list[str]:
        """Use gpt-4o-mini to generate 3 precision search queries targeting government sources."""
        user_message = (
            f"Requirement: {item_title}\n"
            f"Pillar: {pillar_name}\n"
            f"Geography: {geography or 'Not specified'}\n"
            f"Rationale (may name specific regulations/agencies): {item_rationale or 'Not provided'}\n\n"
            "Generate 3 search queries to find the official government portal pages, "
            "application forms, and regulatory checklists for this requirement."
        )

        try:
            client = await self._get_client()
            resp = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": QUERY_GEN_SYSTEM_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                tools=[QUERY_GEN_FUNCTION],
                tool_choice={"type": "function", "function": {"name": "generate_search_queries"}},
                temperature=0.2,
                max_tokens=300,
            )
            await record_usage_from_response(self.user_id, "gpt-4o-mini", resp, self.db, is_byok=self._is_byok)
            tool_calls = resp.choices[0].message.tool_calls
            if tool_calls:
                data = json.loads(tool_calls[0].function.arguments)
                queries = data.get("queries", [])
                if len(queries) >= 2:
                    return queries[:3]
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
        resp = await client.chat.completions.create(
            model=settings.openai_orchestration_model,
            messages=messages,
            tools=[DEEP_DIVE_FUNCTION],
            tool_choice={"type": "function", "function": {"name": "produce_deep_dive"}},
            temperature=0.3,
            max_tokens=2000,
        )
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
