"""
Compliance Chat Service

Two-step orchestration:
  1. A lightweight planning call (function-calling) decides which data
     sources to query. The planner is encouraged to use multiple sources
     (scholarly + web) for comprehensive answers.
  2. Requested tools run in parallel; the answer is generated from all
     gathered evidence and cites only what it actually used.

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
ResearchStepCallback = Callable[[str, str, str], Awaitable[None]]  # (id, label, status)

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
                "Search OpenAlex for peer-reviewed academic papers, research studies, and published evidence. "
                "Good for: empirical data, case studies, impact evaluations, published methodology comparisons, "
                "and peer-reviewed analysis of specific topics or regions."
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
                "Search the web for information from NGOs, governments, standards bodies, news outlets, "
                "industry reports, and other authoritative sources. Good for: current regulations, policies, "
                "program requirements, recent developments, market data, country-specific information, "
                "practical guidance, organizational reports, and real-world project examples."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Focused search query for web sources (max 20 words).",
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
    {
        "type": "function",
        "function": {
            "name": "run_lcoe_model",
            "description": (
                "Build an LCOE (Levelized Cost of Energy) model to estimate cost per kWh. "
                "ALWAYS use this when the user asks for: LCOE, levelized cost, cost of energy, "
                "cost per kWh, project economics, financial feasibility of an energy project, "
                "or when they mention capex/opex/discount rate/WACC/capacity factor in a project costing context. "
                "Also use when the user says 'build me an LCOE', 'model the economics', or "
                "'is this project viable/feasible' for an energy project. "
                "Extract any numbers mentioned in the conversation as inputs."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "technology_type": {
                        "type": "string",
                        "description": "Energy technology: solar_pv, wind, battery, mini_grid, clean_cooking, or other. Infer from conversation.",
                    },
                    "reason": {
                        "type": "string",
                        "description": "One sentence explaining why the LCOE tool is appropriate here.",
                    },
                },
                "required": ["reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_carbon_model",
            "description": (
                "Build a Carbon Emissions model to estimate emission reductions (tCO₂e). "
                "ALWAYS use this when the user asks about: carbon credits, emission reductions, "
                "tCO₂e, baseline vs project emissions, cookstove methodology, fNRB, leakage, "
                "Gold Standard ER calculations, fuel consumption savings from clean cooking, "
                "or 'how many credits will this project generate'. "
                "Extract any numbers mentioned in the conversation as inputs."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "method_pack": {
                        "type": "string",
                        "description": "Methodology pack: cookstoves or other. Infer from conversation.",
                    },
                    "reason": {
                        "type": "string",
                        "description": "One sentence explaining why the carbon tool is appropriate here.",
                    },
                },
                "required": ["reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_input_value",
            "description": (
                "Propose a specific value for a model input field (LCOE or Carbon). "
                "Use when the user asks to investigate, estimate, or determine a value for a "
                "specific input (e.g. 'what should net capacity be?', 'investigate Total CAPEX', "
                "'estimate capacity factor'). The value is shown in a confirmation widget."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "field_name": {
                        "type": "string",
                        "description": "Exact field_name from the model inputs (e.g. 'net_capacity_kw').",
                    },
                    "proposed_value": {
                        "type": "number",
                        "description": "The proposed numeric value.",
                    },
                    "model_type": {
                        "type": "string",
                        "enum": ["lcoe", "carbon"],
                        "description": "Which model this input belongs to.",
                    },
                    "confidence": {
                        "type": "string",
                        "enum": ["high", "moderate", "low"],
                        "description": "Confidence in this estimate.",
                    },
                    "reason": {
                        "type": "string",
                        "description": "One sentence explaining the proposal.",
                    },
                },
                "required": ["field_name", "proposed_value", "model_type", "confidence", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "start_gs_certification",
            "description": (
                "Start the Gold Standard (GS4GG) certification workflow. "
                "Use this when the user asks about Gold Standard certification, "
                "GS4GG submission, cover letter preparation, design review submission, "
                "pre-monitoring requirements, or wants to see what documents are needed "
                "for Gold Standard project registration. Returns a checklist of required "
                "artifacts and opens the Cover Letter editor."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "description": "One sentence explaining why the GS certification tool is appropriate here.",
                    },
                },
                "required": ["reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_cover_letter_value",
            "description": (
                "Propose a text value for a specific Gold Standard Cover Letter field. "
                "Use when the user asks to help fill in a cover letter field, investigate "
                "what should go in a specific field, or when the GS certification workspace "
                "is active and the user provides information relevant to a cover letter field."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "field_id": {
                        "type": "string",
                        "description": "The field_id from the cover letter schema (e.g. 'project_title', 'project_country').",
                    },
                    "proposed_value": {
                        "type": "string",
                        "description": "The proposed text value for the field.",
                    },
                    "confidence": {
                        "type": "string",
                        "enum": ["high", "moderate", "low"],
                        "description": "Confidence in this proposal.",
                    },
                    "reason": {
                        "type": "string",
                        "description": "Brief explanation of why this value is appropriate.",
                    },
                },
                "required": ["field_id", "proposed_value", "confidence", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_template_value",
            "description": (
                "Propose a value for a template/form requirement field. "
                "Use when the user message contains a [TEMPLATE_CONTEXT] block. "
                "ALWAYS combine with search_scholarly_literature AND search_web_sources. "
                "Determine if the value can be researched or must be gathered offline, "
                "then either propose a concrete value or provide specific guidance."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "requirement_label": {
                        "type": "string",
                        "description": "The full question/label of the template requirement.",
                    },
                    "field_type": {
                        "type": "string",
                        "description": "Field type: text, number, currency, boolean, yes_no, date, narrative, formula.",
                    },
                    "proposed_value": {
                        "type": "string",
                        "description": "The proposed value (as string). Use empty string if this must be gathered offline.",
                    },
                    "can_be_determined": {
                        "type": "boolean",
                        "description": "True if this value can be determined from research/project docs. False if user must gather offline.",
                    },
                    "confidence": {
                        "type": "string",
                        "enum": ["high", "moderate", "low"],
                        "description": "Confidence in the proposal.",
                    },
                    "reason": {
                        "type": "string",
                        "description": "Brief explanation of the proposal or why it must be gathered offline.",
                    },
                },
                "required": ["requirement_label", "field_type", "can_be_determined", "confidence", "reason"],
            },
        },
    },
]

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

PLANNING_SYSTEM_PROMPT = """You are a research-planning assistant for an environmental compliance advisor.

Your only job is to decide which tools (if any) to call before generating a response.

You have these data sources available — they are all equally valid and complement each other:
- search_scholarly_literature: peer-reviewed papers, empirical studies, impact evaluations
- search_web_sources: NGO reports, government data, standards bodies, news, market info, practical guidance
- run_lcoe_model: builds a Levelized Cost of Energy model when the user wants energy project economics
- run_carbon_model: builds a carbon emissions model when the user wants emission reduction estimates
- propose_input_value: proposes a specific value for a model input field when the user asks to investigate, estimate, or determine a value for a specific LCOE or Carbon model input field
- start_gs_certification: starts the Gold Standard (GS4GG) certification workflow with a checklist and Cover Letter editor
- propose_cover_letter_value: proposes a text value for a specific Gold Standard Cover Letter field
- propose_template_value: proposes a value for a template/form requirement field when the user message contains [TEMPLATE_CONTEXT]

GUIDELINES:

The user may be working inside a project workspace. Project documents are ALREADY searched automatically — you do not need to call any tool to search them. When the user asks about THEIR project's specific details (budget, partners, timeline, scope, deliverables, etc.), do NOT call search_scholarly_literature or search_web_sources — the project documents already provide the answer.

For general research questions that go BEYOND the project's own documents (e.g. industry benchmarks, regulatory standards, methodology comparisons, best practices), call BOTH search_scholarly_literature AND search_web_sources.

Call run_lcoe_model when the user wants a numerical energy cost model (LCOE, cost per kWh, project economics, capex/opex/WACC analysis). This can be combined with search tools.

Call run_carbon_model when the user wants a numerical emissions model (carbon credits, tCO₂e, emission reductions, cookstove methodology, fNRB). This can be combined with search tools.

Call propose_input_value when the user asks to investigate, estimate, research, or help determine a value for a SPECIFIC model input field (e.g. "what should net capacity be?", "investigate Total CAPEX", "estimate capacity factor for solar PV in Cambodia"). Combine with search tools (scholarly + web) to ground the proposal in evidence.

Call start_gs_certification when the user asks about Gold Standard certification, GS4GG submission, cover letter, design review, pre-monitoring requirements, or what documents are needed for Gold Standard project registration. This opens the certification checklist and cover letter editor.

Call propose_cover_letter_value when a GS certification workspace is active and the user provides information relevant to a cover letter field, or asks to help fill in a specific cover letter field.

Call propose_template_value when the user message contains a [TEMPLATE_CONTEXT] block — this means they are investigating a template/form requirement. ALWAYS combine with search_scholarly_literature AND search_web_sources to ground the answer in evidence. Extract the requirement label, field type, and category from the context block.

Call NEITHER search tool only when:
- The question is purely conversational, definitional, or a simple clarification (e.g. "what is MRV?", "thanks")
- The conversation already contains a direct answer

When in doubt, call both search tools. More context is better than less.

{model_inputs_context}

Do not produce any text — only make tool calls (or no calls)."""

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
- When evidence contains specific numbers, names, dates, or data — QUOTE THEM DIRECTLY. Do not paraphrase with vague language when the source has the concrete answer.
- Ground your answers in the provided evidence whenever possible.
- CITE EVERY FACT from evidence inline using the EXACT tag shown at the start of each evidence block. Place citations immediately after each claim.
  Format: [Source Type: Title, pN] where N is the chunk index (if present in the evidence tag).
  Examples: [Evidence: project_report.pdf, p3] [Scholarly: Cookstove adoption in Ghana] [Web: Gold Standard MRV requirements]
- A response with evidence but NO inline citations is UNACCEPTABLE. If you use evidence, you MUST cite it.
- ONLY cite a source if you actually used it to inform your answer.
- If no evidence was retrieved, answer from general knowledge and flag uncertainty explicitly.
- Be explicit about uncertainty, assumptions, and jurisdictional variability.
- Structure longer answers with clear headings and bullet points.
- Keep answers focused and actionable.
- Never fabricate specific regulations, statistics, or citations.
- For calculations and formulas, use plain text arithmetic (e.g. "200,000 × 0.02 = 4,000 USD"). Do NOT use LaTeX \\text{}, \\times, or \\frac{} commands."""

EVIDENCE_BLOCK_TEMPLATE = """

RETRIEVED EVIDENCE (use these to ground your response):
{evidence}

CITATION RULES (MANDATORY — you will be penalized for missing citations):
1. Every claim, fact, or data point from the evidence MUST have an inline citation.
2. Copy the EXACT tag from the start of each block, including the ", pN" suffix if present.
3. Place the citation IMMEDIATELY after the sentence or clause it supports — not at the end of a paragraph.
4. If multiple blocks support one claim, cite all of them.

GOOD example:
  The project targets 50% thermal efficiency [Evidence: project_report.pdf, p3] and covers 12 districts [Evidence: project_report.pdf, p0].

BAD example (missing citations):
  The project targets high thermal efficiency and covers several districts.
"""

# Pattern to extract inline citations the LLM produces, e.g. [Scholarly: Some Title] or [Evidence: file.pdf, p3]
_CITATION_RE = re.compile(r'\[([^\]:]+):\s*([^\],]{4,200})(?:,\s*p(\d+))?\]')


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class ComplianceChatResponse:
    content: str
    sources: list[RetrievedFact]
    tiers_used: list[str]
    latency_ms: int
    widget_type: str | None = None
    widget_data: dict | None = None


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class ComplianceChatService:
    """
    Orchestrates compliance chat using a plan-then-retrieve-then-generate loop.

    Step 1  — Corpus search (always; fast, local) + tool planning run in parallel
    Step 2  — Execute the planner's requested tools (typically both scholarly
               and web search) in parallel
    Step 3  — Generate final answer using all gathered evidence
    Step 4  — Filter returned sources to only those cited in the answer
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.retrieval = TieredRetrievalService(db)
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

    _HINT_TO_PLANNER_TOOL: dict[str, str] = {
        "lcoe_model": "run_lcoe_model",
        "carbon_model": "run_carbon_model",
        "gs_certification": "start_gs_certification",
    }

    async def generate_response(
        self,
        user_message: str,
        history: list[dict[str, str]],
        on_thinking: ThinkingCallback | None = None,
        *,
        project_context: str | None = None,
        tool_hint: str | None = None,
        model_inputs_context: str | None = None,
        on_research_step: ResearchStepCallback | None = None,
        initiative_id: str | None = None,
    ) -> ComplianceChatResponse:
        start = time.time()

        async def _think(text: str) -> None:
            if on_thinking:
                await on_thinking(text)

        async def _step(step_id: str, label: str, status: str) -> None:
            if on_research_step:
                await on_research_step(step_id, label, status)

        # Step 1: corpus search (if enabled) + tool planning run in parallel (independent)
        search_query = await self._build_search_query(user_message, history)

        await _step("scan_docs", "Scanning project documents", "running")

        async def _corpus_search() -> list[RetrievedFact]:
            if initiative_id:
                from uuid import UUID as _UUID
                try:
                    return await self.retrieval.search_corpus(search_query, _UUID(initiative_id))
                except ValueError:
                    pass
            if not settings.enable_corpus_rag:
                return []
            return await self.retrieval.search_corpus(search_query, None)

        # Search project materials when inside a workspace
        async def _material_search() -> list[RetrievedFact]:
            if not initiative_id:
                return []
            from uuid import UUID as _UUID
            try:
                iid = _UUID(initiative_id)
            except ValueError:
                return []
            return await self.retrieval.search_project_materials(search_query, iid)

        forced_fn = self._HINT_TO_PLANNER_TOOL.get(tool_hint or "")

        corpus_task = asyncio.create_task(_corpus_search())
        plan_task = asyncio.create_task(
            self._plan_tool_calls(user_message, history, model_inputs_context=model_inputs_context)
        )
        corpus_facts, tool_calls = await asyncio.gather(corpus_task, plan_task)

        # Only fall back to keyword search when vector search found nothing for this initiative
        all_facts: list[RetrievedFact] = list(corpus_facts)
        if not corpus_facts and initiative_id:
            material_facts = await _material_search()
            all_facts.extend(material_facts)

        tiers_used: list[str] = []

        doc_count = len(all_facts)
        if doc_count:
            tiers_used.append("corpus")
            await _think(f"Found {doc_count} relevant sections in project documents")
            await _step("scan_docs", f"Found {doc_count} relevant sections", "done")
        else:
            await _step("scan_docs", "No matching document sections", "done")

        # Step 2: execute requested tools — search tools run in parallel
        widget_type: str | None = None
        widget_data: dict | None = None

        # Parse all tool calls
        parsed_calls: list[tuple[str, dict]] = []
        for tool_call in tool_calls:
            fn_name = tool_call.function.name
            try:
                args = json.loads(tool_call.function.arguments)
            except Exception:
                args = {}
            reason = args.get("reason", "")
            logger.info(f"Tool called: {fn_name} | query={args.get('query', '')!r} | reason={reason!r}")
            parsed_calls.append((fn_name, args))

        # If user explicitly selected a computational tool, force it into execution
        # (overrides planner; deduplicate in case planner also picked the same tool)
        if forced_fn:
            if not any(fn == forced_fn for fn, _ in parsed_calls):
                logger.info(f"Injecting forced tool call from tool_hint: {forced_fn}")
                parsed_calls.append((forced_fn, {"reason": "user explicitly selected this tool"}))

        # Run search tools (scholarly + web) concurrently
        async def _run_scholarly(query: str) -> list[RetrievedFact]:
            await _step("search_scholarly", "Searching scholarly databases", "running")
            await _think(f"Searching scholarly databases: \"{query}\"...")
            facts = await self.retrieval.search_openalex(query)
            if facts:
                await _think(f"Found {len(facts)} scholarly works")
                await _step("search_scholarly", f"Found {len(facts)} scholarly works", "done")
            else:
                await _think("No relevant scholarly works found")
                await _step("search_scholarly", "No scholarly works found", "done")
            return facts

        async def _run_web(query: str) -> list[RetrievedFact]:
            await _step("search_web", "Searching web sources", "running")
            await _think("Searching web sources...")
            facts = await self.retrieval.search_web(query)
            if facts:
                await _think(f"Found {len(facts)} web sources")
                await _step("search_web", f"Found {len(facts)} web sources", "done")
            else:
                await _think("No web sources found")
                await _step("search_web", "No web sources found", "done")
            return facts

        search_tasks = []
        search_labels = []
        for fn_name, args in parsed_calls:
            tool_query = args.get("query", search_query)
            if fn_name == "search_scholarly_literature":
                search_tasks.append(_run_scholarly(tool_query))
                search_labels.append("openalex")
            elif fn_name == "search_web_sources":
                search_tasks.append(_run_web(tool_query))
                search_labels.append("web")

        if search_tasks:
            search_results = await asyncio.gather(*search_tasks)
            for label, facts in zip(search_labels, search_results):
                if facts:
                    all_facts.extend(facts)
                    tiers_used.append(label)

        # Run model tools (LCOE / carbon) sequentially — they produce widgets
        for fn_name, args in parsed_calls:
            if fn_name in ("run_lcoe_model", "run_carbon_model"):
                from app.tools.lcoe_tool import LCOETool
                from app.tools.carbon_tool import CarbonTool

                is_lcoe = fn_name == "run_lcoe_model"
                tool = LCOETool() if is_lcoe else CarbonTool()
                label = "lcoe" if is_lcoe else "carbon"

                await _think(f"Building {'LCOE' if is_lcoe else 'carbon emissions'} model...")
                tiers_used.append(label)

                conversation_text = "\n".join(
                    f"{m['role']}: {m['content']}"
                    for m in (history[-20:] if len(history) > 20 else history)
                )
                conversation_text += f"\nuser: {user_message}"

                try:
                    widget_type, widget_data = await tool.execute_from_conversation(
                        conversation_text=conversation_text,
                        planner_args=args,
                        on_progress=_think,
                    )
                except Exception as e:
                    logger.error(f"{label.upper()} tool failed: {e}", exc_info=True)
                    await _think(f"{label.upper()} model encountered an error — falling back to text response")

            elif fn_name == "propose_input_value":
                await _think(f"Proposing value for {args.get('field_name', 'field')}...")
                widget_type = "proposed_value"
                widget_data = {
                    "field_name": args.get("field_name", ""),
                    "label": "",
                    "unit": "",
                    "proposed_value": args.get("proposed_value"),
                    "model_type": args.get("model_type", "lcoe"),
                    "confidence": args.get("confidence", "moderate"),
                    "explanation": args.get("reason", ""),
                }
                if model_inputs_context:
                    widget_data = self._enrich_proposal_from_context(widget_data, model_inputs_context)

            elif fn_name == "start_gs_certification":
                await _think("Loading Gold Standard certification checklist...")
                tiers_used.append("gs_certification")
                from app.services.gs_cover_letter import GS_CHECKLIST_ITEMS
                from app.services.gs_template_service import (
                    GSTemplateService, TEMPLATE_TYPE_COVER_LETTER,
                    TEMPLATE_TYPE_PRELIMINARY_REVIEW,
                )
                from app.services.gs_cover_letter import _get_fallback_field_schema
                try:
                    template_svc = GSTemplateService(self.db)
                    # Hard cap at 30s so we never hang chat indefinitely
                    template = await asyncio.wait_for(
                        template_svc.get_or_fetch_active_template(TEMPLATE_TYPE_COVER_LETTER),
                        timeout=30.0,
                    )
                    section_context = template_svc.get_section_contexts(TEMPLATE_TYPE_COVER_LETTER)
                    widget_type = "gs_checklist"
                    widget_data = {
                        "checklist_items": GS_CHECKLIST_ITEMS,
                        "template_version_id": str(template.id),
                        "template_version_label": template.version_label,
                        "template_status": template.status,
                        "field_schema": template.field_schema or [],
                        "section_context": section_context,
                        "supported_template_types": [TEMPLATE_TYPE_COVER_LETTER, TEMPLATE_TYPE_PRELIMINARY_REVIEW],
                    }
                    await _think("Checklist and Cover Letter template loaded")
                except Exception as e:
                    logger.error(f"GS certification tool failed: {e}", exc_info=True)
                    await _think("Using offline field definitions for Cover Letter")
                    section_context = GSTemplateService(self.db).get_section_contexts(TEMPLATE_TYPE_COVER_LETTER)
                    widget_type = "gs_checklist"
                    widget_data = {
                        "checklist_items": GS_CHECKLIST_ITEMS,
                        "template_version_id": None,
                        "template_version_label": None,
                        "template_status": None,
                        "field_schema": _get_fallback_field_schema(),
                        "section_context": section_context,
                        "supported_template_types": [TEMPLATE_TYPE_COVER_LETTER, TEMPLATE_TYPE_PRELIMINARY_REVIEW],
                    }

            elif fn_name == "propose_cover_letter_value":
                field_id = args.get("field_id", "")
                await _think(f"Proposing value for cover letter field: {field_id}...")
                widget_type = "gs_proposed_field"
                widget_data = {
                    "field_id": field_id,
                    "proposed_value": args.get("proposed_value", ""),
                    "confidence": args.get("confidence", "moderate"),
                    "explanation": args.get("reason", ""),
                }

            elif fn_name == "propose_template_value":
                req_label = args.get("requirement_label", "requirement")
                await _think(f"Researching: {req_label[:60]}...")
                can_determine = args.get("can_be_determined", True)
                proposed = args.get("proposed_value", "")
                widget_type = "template_proposed_value"
                widget_data = {
                    "requirement_label": req_label,
                    "field_type": args.get("field_type", "text"),
                    "proposed_value": proposed,
                    "can_be_determined": can_determine,
                    "confidence": args.get("confidence", "moderate"),
                    "explanation": args.get("reason", ""),
                }

        # Track propose intent (field_name set by planner if it called propose_input_value)
        propose_field_name: str | None = None
        propose_model_type: str = "lcoe"
        for fn_name, args in parsed_calls:
            if fn_name == "propose_input_value":
                propose_field_name = args.get("field_name") or None
                propose_model_type = args.get("model_type", "lcoe")

        # Step 4: generate answer — LLM only sees what was actually retrieved
        ranked_facts = self._rank_facts(all_facts)
        source_count = len([f for f in ranked_facts if f.source_type != SourceType.LLM_ESTIMATE])

        await _step("analyze_sources", f"Analyzing {source_count} sources" if source_count else "Generating response", "running")
        if source_count > 0:
            await _think(f"Generating response from {source_count} sources...")
        else:
            await _think("Generating response...")

        # For propose requests: use the full research context to generate the answer,
        # then extract the concrete proposal from the text afterward.
        is_propose_request = (
            widget_type == "proposed_value"
            or self._is_investigate_request(user_message)
        )

        if widget_type == "template_proposed_value" and widget_data:
            content = await self._generate_template_investigate_answer(
                user_message, history, widget_data, ranked_facts, project_context=project_context,
            )
        elif widget_type and widget_data and widget_type.startswith("carbon_"):
            content = await self._generate_carbon_answer(
                user_message, history, widget_data, ranked_facts
            )
        elif widget_type and widget_data and widget_type.startswith("lcoe_"):
            content = await self._generate_lcoe_answer(
                user_message, history, widget_data, ranked_facts
            )
        else:
            combined_context = project_context or ""
            if model_inputs_context:
                combined_context = f"{combined_context}\n\n## Current Model Inputs\n{model_inputs_context}" if combined_context else f"## Current Model Inputs\n{model_inputs_context}"
            content = await self._generate_answer(
                user_message, history, ranked_facts, project_context=combined_context or None
            )

        # Step 4b: if this was an investigate/propose request, extract a structured
        # proposal from the generated text so we can show a confirm widget.
        if is_propose_request and model_inputs_context and not widget_type:
            proposal = await self._extract_value_proposal(
                answer_text=content,
                user_message=user_message,
                model_inputs_context=model_inputs_context,
                hint_field_name=propose_field_name,
                hint_model_type=propose_model_type,
            )
            if proposal:
                widget_type = "proposed_value"
                widget_data = proposal

        await _step("analyze_sources", "Analysis complete", "done")

        # Step 5: return only sources that appear cited in the response
        cited_sources = self._extract_cited_sources(content, ranked_facts)

        # Step 5b: attach provenance to proposed_value widget data
        if widget_type == "proposed_value" and widget_data:
            from app.schemas.provenance import (
                Derivation,
                ItemProvenance,
                source_attribution_from_retrieved_fact,
            )
            source_attrs = [
                source_attribution_from_retrieved_fact(s).model_dump()
                for s in cited_sources
                if s.source_type != SourceType.LLM_ESTIMATE
            ]
            from app.schemas.provenance import SourceAttribution as _SA
            derivation = Derivation.RESEARCHED if source_attrs else Derivation.INFERRED
            widget_data["provenance"] = ItemProvenance(
                derivation=derivation,
                sources=[_SA(**sa) for sa in source_attrs],
                rationale=widget_data.get("explanation", ""),
            ).model_dump()

        elapsed_ms = int((time.time() - start) * 1000)
        return ComplianceChatResponse(
            content=content,
            sources=cited_sources,
            tiers_used=tiers_used,
            latency_ms=elapsed_ms,
            widget_type=widget_type,
            widget_data=widget_data,
        )

    # -----------------------------------------------------------------------
    # Internal helpers
    # -----------------------------------------------------------------------

    async def _generate_carbon_answer(
        self,
        user_message: str,
        history: list[dict[str, str]],
        widget_data: dict,
        facts: list[RetrievedFact],
    ) -> str:
        """Generate a short text answer to accompany the carbon widget."""
        result = widget_data.get("result")
        missing = widget_data.get("missing_essentials", [])
        computable = widget_data.get("computable", False)

        if computable and result:
            net_er = result["net_er_tco2e"]
            assumption_count = result.get("assumption_count", 0)
            quality = result.get("quality_label", "moderate")

            carbon_context = (
                f"I've built a carbon emissions model based on what you've shared. "
                f"The result is **{net_er:,.2f} tCO₂e/year** in net emission reductions "
                f"({assumption_count} assumption{'s' if assumption_count != 1 else ''}, "
                f"{quality} confidence).\n\n"
                "The full inputs table, emissions breakdown, sensitivity analysis, and ER schedule "
                "are shown below. You can click any input value to edit it and I'll recalculate instantly."
            )

            if assumption_count >= 5:
                carbon_context += (
                    "\n\n⚠️ **High assumption load** — many values are using defaults. "
                    "Providing actual project numbers for devices, fuel consumption, and fNRB "
                    "will significantly improve accuracy."
                )
        else:
            missing_labels = {
                "devices_households": "number of devices/households",
                "baseline_fuel_consumption_kg_yr": "baseline fuel consumption (kg/yr)",
            }
            nice_names = [missing_labels.get(m, m) for m in missing]
            carbon_context = (
                "I've started building your carbon emissions model and pre-filled what I could "
                "from our conversation with methodology-appropriate defaults.\n\n"
                f"To calculate emission reductions I still need: **{', '.join(nice_names)}**. "
                "Can you provide these? You can also edit any value in the table below."
            )

        if facts:
            evidence_lines = []
            for f in facts[:5]:
                evidence_lines.append(f"{f.to_citation_string()}\n{f.content[:300]}")
            evidence_block = "\n\nRELEVANT CONTEXT:\n" + "\n\n".join(evidence_lines)
        else:
            evidence_block = ""

        messages: list[dict] = [
            {
                "role": "system",
                "content": (
                    "You are an expert carbon project advisor. The user asked for a carbon emissions model. "
                    "A carbon widget with full inputs and outputs has been generated and will be "
                    "displayed alongside your message. Write a SHORT (2-4 sentence) contextual "
                    "introduction. Do NOT reproduce the numbers in detail — the widget shows those. "
                    "Focus on: what methodology/context this models, any caveats about the assumptions, "
                    "and what the user should look at or edit next."
                    + evidence_block
                ),
            },
        ]
        for msg in (history[-6:] if len(history) > 6 else history):
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": user_message})
        messages.append({"role": "assistant", "content": carbon_context})

        try:
            resp = await self.client.chat.completions.create(
                model=settings.openai_generation_model,
                messages=messages,
                temperature=0.4,
                max_tokens=400,
            )
            return resp.choices[0].message.content or carbon_context
        except Exception:
            return carbon_context

    async def _generate_lcoe_answer(
        self,
        user_message: str,
        history: list[dict[str, str]],
        widget_data: dict,
        facts: list[RetrievedFact],
    ) -> str:
        """Generate a short text answer to accompany the LCOE widget."""
        result = widget_data.get("result")
        missing = widget_data.get("missing_essentials", [])
        computable = widget_data.get("computable", False)

        if computable and result:
            lcoe_val = result["lcoe"]
            currency = result.get("currency", "USD")
            assumption_count = result.get("assumption_count", 0)
            quality = result.get("quality_label", "moderate")

            lcoe_context = (
                f"I've built an LCOE model based on what you've shared. "
                f"The result is **{currency} {lcoe_val:.4f}/kWh** "
                f"({assumption_count} assumption{'s' if assumption_count != 1 else ''}, "
                f"{quality} confidence).\n\n"
                "The full inputs table, cost breakdown, sensitivity analysis, and cash flows "
                "are shown below. You can click any input value to edit it and I'll recalculate instantly."
            )

            if assumption_count >= 5:
                lcoe_context += (
                    "\n\n⚠️ **High assumption load** — many values are using defaults. "
                    "Providing actual project numbers for capacity, CAPEX, and O&M "
                    "will significantly improve accuracy."
                )
        else:
            missing_labels = {
                "net_capacity_kw": "net capacity (kW)",
                "total_capex": "total CAPEX",
                "annual_opex": "annual O&M cost",
            }
            nice_names = [missing_labels.get(m, m) for m in missing]
            lcoe_context = (
                "I've started building your LCOE model and pre-filled what I could "
                "from our conversation with technology-appropriate defaults.\n\n"
                f"To calculate the LCOE I still need: **{', '.join(nice_names)}**. "
                "Can you provide these? You can also edit any value in the table below."
            )

        if facts:
            evidence_lines = []
            for f in facts[:5]:
                evidence_lines.append(f"{f.to_citation_string()}\n{f.content[:300]}")
            evidence_block = "\n\nRELEVANT CONTEXT:\n" + "\n\n".join(evidence_lines)
        else:
            evidence_block = ""

        messages: list[dict] = [
            {
                "role": "system",
                "content": (
                    "You are an expert energy finance advisor. The user asked for an LCOE model. "
                    "An LCOE widget with full inputs and outputs has been generated and will be "
                    "displayed alongside your message. Write a SHORT (2-4 sentence) contextual "
                    "introduction. Do NOT reproduce the numbers in detail — the widget shows those. "
                    "Focus on: what technology/context this models, any caveats about the assumptions, "
                    "and what the user should look at or edit next."
                    + evidence_block
                ),
            },
        ]
        for msg in (history[-6:] if len(history) > 6 else history):
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": user_message})
        messages.append({"role": "assistant", "content": lcoe_context})

        try:
            resp = await self.client.chat.completions.create(
                model=settings.openai_generation_model,
                messages=messages,
                temperature=0.4,
                max_tokens=400,
            )
            return resp.choices[0].message.content or lcoe_context
        except Exception:
            return lcoe_context

    async def _plan_tool_calls(
        self,
        user_message: str,
        history: list[dict[str, str]],
        model_inputs_context: str | None = None,
    ) -> list:
        """
        Ask a fast LLM which search tools (if any) to invoke.
        Returns a list of OpenAI tool_call objects (may be empty).
        """
        inputs_block = ""
        if model_inputs_context:
            inputs_block = f"\nCurrent model inputs state:\n{model_inputs_context}\n"
        planning_prompt = PLANNING_SYSTEM_PROMPT.format(
            model_inputs_context=inputs_block,
        )
        messages: list[dict] = [{"role": "system", "content": planning_prompt}]
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

    @staticmethod
    def _is_investigate_request(user_message: str) -> bool:
        """Return True if the message is asking to investigate/propose a value for a model input."""
        lower = user_message.lower()
        investigate_keywords = [
            "investigate", "propose", "suggest a value", "estimate a value",
            "what should", "what value", "help me find", "research the value",
            "propose a specific", "estimate for", "validate the value",
        ]
        return any(k in lower for k in investigate_keywords)

    async def _extract_value_proposal(
        self,
        answer_text: str,
        user_message: str,
        model_inputs_context: str,
        hint_field_name: str | None = None,
        hint_model_type: str = "lcoe",
    ) -> dict | None:
        """
        After the main answer is generated, extract a concrete numeric proposal from it.
        Returns a dict matching the proposed_value widget schema, or None if not applicable.
        """
        extraction_prompt = (
            "You are extracting a structured value proposal from a research response.\n\n"
            f"## Current Model Inputs\n{model_inputs_context}\n\n"
            f"## User Request\n{user_message}\n\n"
            f"## Research Answer\n{answer_text}\n\n"
            "Does this answer propose a specific numeric value for a model input field? "
            "If yes, extract it. If the answer discusses ranges, choose the most appropriate single value. "
            "If no concrete numeric value is proposed, return nothing."
        )
        tool_def = {
            "type": "function",
            "function": {
                "name": "extract_proposal",
                "description": "Extract a proposed numeric value for a model input field from the answer text.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "field_name": {
                            "type": "string",
                            "description": "Exact field_name from model inputs (e.g. 'net_capacity_kw', 'capacity_factor'). Match to the inputs list above.",
                        },
                        "label": {
                            "type": "string",
                            "description": "Human-readable label for the field, exactly as shown in the model inputs (e.g. 'Annual O&M', 'Net Capacity', 'Capacity Factor'). Copy from the inputs list.",
                        },
                        "unit": {
                            "type": "string",
                            "description": "Unit for the value, exactly as shown in the model inputs (e.g. 'USD', 'kW', 'USD/yr'). Copy from the inputs list. Empty string if unitless.",
                        },
                        "proposed_value": {
                            "type": "number",
                            "description": "The single best numeric value being proposed.",
                        },
                        "model_type": {
                            "type": "string",
                            "enum": ["lcoe", "carbon"],
                            "description": "Which model this field belongs to.",
                        },
                        "confidence": {
                            "type": "string",
                            "enum": ["high", "moderate", "low"],
                        },
                        "explanation": {
                            "type": "string",
                            "description": "1-2 sentence summary of why this value is proposed (for the widget).",
                        },
                    },
                    "required": ["field_name", "label", "unit", "proposed_value", "model_type", "confidence", "explanation"],
                },
            },
        }
        if hint_field_name:
            extraction_prompt += f"\n\nHint: the field being investigated is likely '{hint_field_name}' ({hint_model_type} model)."

        try:
            resp = await self.client.chat.completions.create(
                model=settings.openai_orchestration_model,
                messages=[{"role": "user", "content": extraction_prompt}],
                tools=[tool_def],
                tool_choice={"type": "function", "function": {"name": "extract_proposal"}},
                temperature=0,
                max_tokens=300,
            )
            tool_calls = resp.choices[0].message.tool_calls
            if not tool_calls:
                return None
            import json as _json
            result = _json.loads(tool_calls[0].function.arguments)
            if result.get("proposed_value") is not None and result.get("field_name"):
                # Ensure label and unit are populated from the model inputs context
                if not result.get("label") or not result.get("unit"):
                    result = self._enrich_proposal_from_context(result, model_inputs_context)
                return result
            return None
        except Exception as e:
            logger.warning(f"Value proposal extraction failed: {e}")
            return None

    async def _generate_template_investigate_answer(
        self,
        user_message: str,
        history: list[dict[str, str]],
        widget_data: dict,
        facts: list[RetrievedFact],
        *,
        project_context: str | None = None,
    ) -> str:
        """Generate a targeted answer for a template requirement investigation."""
        req_label = widget_data.get("requirement_label", "")
        field_type = widget_data.get("field_type", "text")
        can_determine = widget_data.get("can_be_determined", True)

        if facts:
            lines = []
            for f in facts:
                citation = f.to_citation_string()
                snippet = f.content[:500]
                lines.append(f"{citation}\n{snippet}")
            evidence_block = "\n\nRESEARCH EVIDENCE:\n" + "\n\n".join(lines)
        else:
            evidence_block = "\n\nNo external sources were retrieved.\n"

        context_block = ""
        if project_context:
            context_block = f"\n\n## Project Context\n{project_context}\n"

        system_prompt = (
            "You are an expert advisor helping fill out a compliance/regulatory form. "
            "The user is investigating a specific requirement from a template.\n\n"
            f"**Requirement:** {req_label}\n"
            f"**Field type:** {field_type}\n"
            f"**Can be determined from research:** {'Yes' if can_determine else 'No — requires offline data gathering'}\n"
            f"{context_block}{evidence_block}\n\n"
            "INSTRUCTIONS:\n"
            "You MUST follow one of these two paths:\n\n"
            "**Path A — Value can be determined:** If the requirement can be answered from "
            "project documents, public data, or reasonable inference:\n"
            "1. State a concrete proposed value or answer clearly at the top.\n"
            "2. Cite the specific sources that support it using [Source Type: Title] format.\n"
            "3. Explain your reasoning in 2-3 sentences.\n"
            "4. If applicable, suggest a time-bound commitment plan if the answer is 'No' or partial.\n\n"
            "**Path B — Requires offline data:** If this requires internal company data, "
            "proprietary records, or information the user must obtain themselves:\n"
            "1. State clearly this must be gathered from a specific internal source.\n"
            "2. Name the EXACT department, record type, or contact that would have this data.\n"
            "3. Suggest a concrete 1-2 year commitment plan with specific milestones if the "
            "user doesn't have this yet.\n"
            "4. Provide real-world examples of what these look like from the research evidence.\n\n"
            "CRITICAL RULES:\n"
            "- NEVER give generic advice like 'contact local agencies' without specifics.\n"
            "- ALWAYS cite specific sources from the evidence block — do not invent citations.\n"
            "- If suggesting a commitment plan, include concrete milestones with timeframes.\n"
            "- Keep the response focused and actionable — max 300 words.\n"
            "- If you found relevant examples in the research, cite them with specific details."
        )

        messages: list[dict] = [{"role": "system", "content": system_prompt}]
        for msg in (history[-6:] if len(history) > 6 else history):
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": user_message})

        try:
            resp = await self.client.chat.completions.create(
                model=settings.openai_generation_model,
                messages=messages,
                temperature=0.4,
                max_tokens=800,
            )
            return resp.choices[0].message.content or ""
        except Exception as e:
            logger.error(f"Template investigate answer failed: {e}", exc_info=True)
            return f"I was unable to fully research this requirement. Please try again."

    @staticmethod
    def _enrich_proposal_from_context(proposal: dict, model_inputs_context: str) -> dict:
        """Fill in label/unit from the model inputs context if the extraction missed them."""
        field_name = proposal.get("field_name", "")
        if not field_name:
            return proposal
        # Parse lines like:
        #   "- Total CAPEX (field_name=total_capex): — USD [missing]"
        #   "- Annual O&M (field_name=annual_opex): 0 USD/yr [assumed]"
        #   "- Capacity Factor (field_name=capacity_factor): 0.2  [assumed]"
        import re
        pattern = re.compile(
            r"- (.+?) \(field_name=" + re.escape(field_name) + r"\): ([^\[]*)\[",
        )
        match = pattern.search(model_inputs_context)
        if match:
            label_str = match.group(1).strip()
            value_unit_str = match.group(2).strip()
            if not proposal.get("label") and label_str:
                proposal["label"] = label_str
            if not proposal.get("unit"):
                # value_unit_str is like "— USD" or "0 USD/yr" or "0.2 "
                # The unit is everything after the numeric/dash part
                unit_match = re.search(r'[\d.—\-]+\s*(.*)', value_unit_str)
                if unit_match:
                    unit = unit_match.group(1).strip()
                    if unit and unit != "—":
                        proposal["unit"] = unit
        return proposal

    def _rank_facts(self, facts: list[RetrievedFact]) -> list[RetrievedFact]:
        """Rank and deduplicate facts by source quality and confidence."""
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
        seen: set[tuple[str, str | None]] = set()
        deduped: list[RetrievedFact] = []
        for fact in sorted_facts:
            key = (fact.source_title.lower().strip(), fact.chunk_id)
            if key not in seen:
                seen.add(key)
                deduped.append(fact)
        return deduped[:8]

    async def _generate_answer(
        self,
        user_message: str,
        history: list[dict[str, str]],
        facts: list[RetrievedFact],
        *,
        project_context: str | None = None,
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

        context_prefix = ""
        if project_context:
            context_prefix = (
                f"## Active Project Context\n{project_context}\n\n"
                "Ground your answer in this project's specific details where relevant. "
                "The user is working on this project and expects responses tailored to it.\n\n"
            )

        messages: list[dict] = [
            {"role": "system", "content": context_prefix + SYSTEM_PROMPT + evidence_block},
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
        Parse [Source Type: Title(, pN)?] citations from the generated response
        and return ONLY the RetrievedFact objects that were actually cited inline.

        The sources toolbar should mirror what's cited in the message — nothing more.
        """
        matches = _CITATION_RE.findall(content)
        if not matches:
            return []

        cited: list[RetrievedFact] = []
        for _source_type, cited_title, chunk_idx_str in matches:
            cited_lower = cited_title.lower().strip()
            chunk_idx = int(chunk_idx_str) if chunk_idx_str else None

            best: RetrievedFact | None = None
            for fact in facts:
                if fact in cited:
                    continue
                fact_lower = fact.source_title.lower().strip()
                title_match = cited_lower in fact_lower or fact_lower in cited_lower
                if not title_match:
                    cited_words = {w for w in cited_lower.split() if len(w) > 3}
                    fact_words = {w for w in fact_lower.split() if len(w) > 3}
                    title_match = len(cited_words & fact_words) >= 2
                if not title_match:
                    continue
                if chunk_idx is not None and fact.chunk_index == chunk_idx:
                    best = fact
                    break
                if best is None:
                    best = fact

            if best is not None and best not in cited:
                cited.append(best)

        return cited
