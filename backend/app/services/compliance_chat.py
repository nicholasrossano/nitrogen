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
]

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

PLANNING_SYSTEM_PROMPT = """You are a research-planning assistant for an environmental compliance advisor.

Your only job is to decide which tools (if any) to call before generating a response.

ALWAYS call run_lcoe_model when the user:
- Asks for an LCOE, levelized cost of energy, or cost per kWh
- Asks to "build me an LCOE" or "model the economics" for an energy project
- Asks about project financial feasibility or viability for an energy project
- Mentions capex, opex, discount rate, WACC, or capacity factor in a project costing context
- Asks "what would the cost of energy be" for solar, wind, battery, mini-grid, or clean cooking projects
This takes priority over search tools when the user wants a numerical economic model.

ALWAYS call run_carbon_model when the user:
- Asks about carbon credits, emission reductions, or tCO₂e
- Asks about baseline vs project emissions, cookstove methodology, fNRB, or leakage
- Asks "how many credits" or "what are the emission reductions" for a project
- Discusses fuel consumption savings from clean cooking or improved stove programs
- Mentions Gold Standard ER calculations or carbon credit methodology
This takes priority over search tools when the user wants a numerical carbon/emissions model.

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

You may call multiple tools, one, or none. Do not produce any text — only make tool calls (or no calls)."""

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
    widget_type: str | None = None
    widget_data: dict | None = None


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
        *,
        project_context: str | None = None,
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
        widget_type: str | None = None
        widget_data: dict | None = None

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

            elif fn_name == "run_lcoe_model":
                await _think("Building LCOE model...")
                tiers_used.append("lcoe")
                try:
                    widget_type, widget_data = await self._run_lcoe(
                        user_message, history, args, _think
                    )
                except Exception as e:
                    logger.error(f"LCOE tool failed: {e}", exc_info=True)
                    await _think("LCOE model encountered an error — falling back to text response")

            elif fn_name == "run_carbon_model":
                await _think("Building carbon emissions model...")
                tiers_used.append("carbon")
                try:
                    widget_type, widget_data = await self._run_carbon(
                        user_message, history, args, _think
                    )
                except Exception as e:
                    logger.error(f"Carbon tool failed: {e}", exc_info=True)
                    await _think("Carbon model encountered an error — falling back to text response")

        # Step 4: generate answer — LLM only sees what was actually retrieved
        ranked_facts = self._rank_facts(all_facts)
        source_count = len([f for f in ranked_facts if f.source_type != SourceType.LLM_ESTIMATE])

        if source_count > 0:
            await _think(f"Generating response from {source_count} sources...")
        else:
            await _think("Generating response from general knowledge...")

        if widget_type and widget_data and widget_type.startswith("carbon_"):
            content = await self._generate_carbon_answer(
                user_message, history, widget_data, ranked_facts
            )
        elif widget_type and widget_data and widget_type.startswith("lcoe_"):
            content = await self._generate_lcoe_answer(
                user_message, history, widget_data, ranked_facts
            )
        else:
            content = await self._generate_answer(
                user_message, history, ranked_facts, project_context=project_context
            )

        # Step 5: return only sources that appear cited in the response
        cited_sources = self._extract_cited_sources(content, ranked_facts)

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

    async def _run_lcoe(
        self,
        user_message: str,
        history: list[dict[str, str]],
        planner_args: dict,
        on_thinking: Callable[[str], Awaitable[None]],
    ) -> tuple[str, dict]:
        """Run the LCOE engine from within the compliance chat.

        Returns (widget_type, widget_data).
        """
        from app.services.lcoe_engine import LCOEEngine, LCOEInput

        tech_type = planner_args.get("technology_type")

        conversation_text = "\n".join(
            f"{m['role']}: {m['content']}" for m in (history[-20:] if len(history) > 20 else history)
        )
        conversation_text += f"\nuser: {user_message}"

        await on_thinking("Extracting inputs from conversation...")

        extracted = await self._extract_lcoe_inputs(conversation_text, tech_type)

        if not tech_type and extracted.get("technology_type"):
            tech_type = extracted.pop("technology_type", None)

        extracted.pop("location", None)

        engine_inputs = LCOEEngine.build_default_inputs(
            tech_type=tech_type,
            known_values=extracted,
        )

        missing = LCOEEngine.get_missing_essentials(engine_inputs)
        computable = LCOEEngine.is_computable(engine_inputs)

        widget_data: dict = {
            "inputs": {k: v.to_dict() for k, v in engine_inputs.items()},
            "missing_essentials": missing,
            "computable": computable,
            "technology_type": tech_type,
        }

        if computable:
            await on_thinking("Calculating LCOE...")
            result = LCOEEngine.calculate(engine_inputs)
            widget_data["result"] = result.to_dict()

            await on_thinking("Running sensitivity analysis...")
            sensitivity = LCOEEngine.run_sensitivity(engine_inputs)
            widget_data["sensitivity"] = [s.to_dict() for s in sensitivity]
            widget_data["is_unruly"] = LCOEEngine.is_unruly(engine_inputs)

            widget_type = "lcoe_output"
            await on_thinking(
                f"LCOE: {result.currency} {result.lcoe:.4f}/kWh "
                f"({result.assumption_count} assumptions, {result.quality_label} confidence)"
            )
        else:
            widget_type = "lcoe_inputs"
            await on_thinking(f"Need {len(missing)} more inputs to compute — showing input table")

        return widget_type, widget_data

    async def _extract_lcoe_inputs(
        self,
        conversation_text: str,
        tech_type: str | None,
    ) -> dict:
        """LLM extraction of LCOE inputs from conversation text."""
        from app.tools.lcoe_tool import INPUT_EXTRACTION_SCHEMA

        try:
            resp = await self.client.chat.completions.create(
                model=settings.openai_orchestration_model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are an energy project analyst. Extract any LCOE-relevant "
                            "numeric inputs from the conversation below. "
                            "Only include values that are explicitly stated or clearly implied. "
                            "Convert units where needed (e.g. MW → kW). "
                            "For capacity_factor and discount_rate, return as decimals (0-1)."
                        ),
                    },
                    {"role": "user", "content": conversation_text},
                ],
                tools=[{
                    "type": "function",
                    "function": {
                        "name": "extract_lcoe_inputs",
                        "description": "Extract LCOE model inputs from conversation",
                        "parameters": INPUT_EXTRACTION_SCHEMA,
                    },
                }],
                tool_choice={"type": "function", "function": {"name": "extract_lcoe_inputs"}},
                temperature=0,
            )
            tool_call = resp.choices[0].message.tool_calls[0]
            extracted = json.loads(tool_call.function.arguments)
            return {k: v for k, v in extracted.items() if v is not None}
        except Exception as e:
            logger.error(f"LCOE input extraction failed: {e}")
            return {}

    async def _run_carbon(
        self,
        user_message: str,
        history: list[dict[str, str]],
        planner_args: dict,
        on_thinking: Callable[[str], Awaitable[None]],
    ) -> tuple[str, dict]:
        """Run the carbon engine from within the compliance chat."""
        from app.services.carbon_engine import CarbonEngine, CarbonInput

        method_pack = planner_args.get("method_pack")

        conversation_text = "\n".join(
            f"{m['role']}: {m['content']}" for m in (history[-20:] if len(history) > 20 else history)
        )
        conversation_text += f"\nuser: {user_message}"

        await on_thinking("Extracting carbon inputs from conversation...")

        extracted = await self._extract_carbon_inputs(conversation_text, method_pack)

        if not method_pack and extracted.get("method_pack"):
            method_pack = extracted.pop("method_pack", None)

        engine_inputs = CarbonEngine.build_default_inputs(
            method_pack=method_pack,
            known_values=extracted,
        )

        missing = CarbonEngine.get_missing_essentials(engine_inputs)
        computable = CarbonEngine.is_computable(engine_inputs)

        widget_data: dict = {
            "inputs": {k: v.to_dict() for k, v in engine_inputs.items()},
            "missing_essentials": missing,
            "computable": computable,
            "method_pack": method_pack,
        }

        if computable:
            await on_thinking("Calculating emission reductions...")
            result = CarbonEngine.calculate(engine_inputs)
            widget_data["result"] = result.to_dict()

            await on_thinking("Running sensitivity analysis...")
            sensitivity = CarbonEngine.run_sensitivity(engine_inputs)
            widget_data["sensitivity"] = [s.to_dict() for s in sensitivity]
            widget_data["is_unruly"] = CarbonEngine.is_unruly(engine_inputs)

            widget_type = "carbon_output"
            await on_thinking(
                f"Net ERs: {result.net_er_tco2e:,.2f} tCO₂e/yr "
                f"({result.assumption_count} assumptions, {result.quality_label} confidence)"
            )
        else:
            widget_type = "carbon_inputs"
            await on_thinking(f"Need {len(missing)} more inputs to compute — showing input table")

        return widget_type, widget_data

    async def _extract_carbon_inputs(
        self,
        conversation_text: str,
        method_pack: str | None,
    ) -> dict:
        """LLM extraction of carbon inputs from conversation text."""
        from app.tools.carbon_tool import INPUT_EXTRACTION_SCHEMA

        try:
            resp = await self.client.chat.completions.create(
                model=settings.openai_orchestration_model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a carbon project analyst specialising in cookstove and "
                            "clean-cooking methodologies. Extract any carbon-ER-relevant "
                            "numeric inputs from the conversation below. "
                            "Only include values that are explicitly stated or clearly implied. "
                            "Convert units where needed (e.g. tonnes → kg). "
                            "For rates (usage_rate, adoption_rate, fnrb, efficiencies), return as decimals (0-1). "
                            "If the project clearly involves cookstoves, set method_pack to 'cookstoves'."
                        ),
                    },
                    {"role": "user", "content": conversation_text},
                ],
                tools=[{
                    "type": "function",
                    "function": {
                        "name": "extract_carbon_inputs",
                        "description": "Extract carbon emissions model inputs from conversation",
                        "parameters": INPUT_EXTRACTION_SCHEMA,
                    },
                }],
                tool_choice={"type": "function", "function": {"name": "extract_carbon_inputs"}},
                temperature=0,
            )
            tool_call = resp.choices[0].message.tool_calls[0]
            extracted = json.loads(tool_call.function.arguments)
            return {k: v for k, v in extracted.items() if v is not None}
        except Exception as e:
            logger.error(f"Carbon input extraction failed: {e}")
            return {}

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
