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
from app.models.initiative import Initiative
from app.schemas.provenance import (
    Derivation,
    ItemProvenance,
    SourceAttribution,
    source_attribution_from_retrieved_fact,
)
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
                    "items": {"type": "string"},
                    "description": (
                        "2–3 plain-English sentences — no more — summarizing what this requirement "
                        "is and why it exists. Each sentence must add new information; do not restate "
                        "or paraphrase a point already made. Be concrete and specific to the project "
                        "context. Bold the single most important takeaway sentence using **markdown "
                        "bold** (e.g. '**This permit is required before any ground disturbance.**'). "
                        "Bold at most one sentence."
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


@dataclass
class DeepDiveResult:
    item_id: str
    item_title: str
    pillar_name: str
    what_this_is: list[str]
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

    def __init__(self, db: AsyncSession):
        self.db = db
        self.retrieval = TieredRetrievalService(db)
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

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

        # Step 2: Fire all queries in parallel
        search_results = await asyncio.gather(
            *[self.retrieval.search_web(q, max_results=5, max_content_length=800) for q in queries]
        )

        # Step 3: Deduplicate by URL (fall back to title)
        seen: set[str] = set()
        all_facts: list[RetrievedFact] = []
        for batch in search_results:
            for fact in batch:
                key = (fact.source_url or fact.source_title).lower().strip()
                if key not in seen:
                    seen.add(key)
                    all_facts.append(fact)

        logger.info("Deep dive gathered %d unique web facts", len(all_facts))

        # Step 4: Generate structured output
        result_data = await self._generate_structured(
            item_title=item_title,
            item_classification=item_classification,
            item_rationale=item_rationale,
            pillar_name=pillar_name,
            project_context=project_context,
            facts=all_facts,
        )

        # Attach per-element provenance from LLM-emitted source_indices
        elements: list[DeepDiveElement] = []
        referenced_indices: set[int] = set()
        for el in result_data.get("elements", []):
            indices = el.get("source_indices") or []
            source_attrs = []
            for idx in indices:
                if 1 <= idx <= len(all_facts):
                    referenced_indices.add(idx)
                    source_attrs.append(
                        source_attribution_from_retrieved_fact(all_facts[idx - 1]).model_dump()
                    )
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

        # Build source list — only facts the LLM actually referenced
        sources = [
            DeepDiveSource(
                title=f.source_title,
                url=f.source_url,
                source_type=f.source_type.value,
                publisher=f.publisher,
            )
            for idx, f in enumerate(all_facts, 1)
            if idx in referenced_indices and f.source_url
        ]

        elapsed_ms = int((time.time() - start) * 1000)
        return DeepDiveResult(
            item_id=item_id,
            item_title=item_title,
            pillar_name=pillar_name,
            what_this_is=result_data.get("what_this_is", []),
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
            resp = await self.client.chat.completions.create(
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
    ) -> dict:
        """Call the LLM with forced function calling to produce the structured result."""
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
                "\n\nFor each element, include source_indices referencing the [S1], [S2], etc. "
                "numbered sources above that support it. Required elements MUST cite at least one source."
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
            f"{evidence_block}{source_cite_instruction}"
        )

        messages: list[dict] = [
            {"role": "system", "content": DEEP_DIVE_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ]

        resp = await self.client.chat.completions.create(
            model=settings.openai_orchestration_model,
            messages=messages,
            tools=[DEEP_DIVE_FUNCTION],
            tool_choice={"type": "function", "function": {"name": "produce_deep_dive"}},
            temperature=0.3,
            max_tokens=2000,
        )

        tool_calls = resp.choices[0].message.tool_calls
        if not tool_calls:
            logger.warning("Deep dive: LLM returned no tool call")
            return {"what_this_is": [], "elements": [], "dependencies": []}

        try:
            return json.loads(tool_calls[0].function.arguments)
        except Exception as exc:
            logger.error("Deep dive: failed to parse tool call arguments: %s", exc)
            return {"what_this_is": [], "elements": [], "dependencies": []}
