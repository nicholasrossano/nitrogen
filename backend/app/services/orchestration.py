"""
Orchestration Service

LLM-driven chat orchestration that decides what action to take next.
Uses function calling to constrain the LLM to valid actions only.

The goal: quickly gather enough project context (type, technology, locale)
from the user's description and uploaded docs to generate a specific
environmental project plan with tangible deliverables.
"""

from dataclasses import dataclass
from typing import Any
import json
import logging

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.initiative import Initiative
from app.models.chat import ChatMessage
from app.services.tiered_retrieval import TieredRetrievalService, RetrievedFact

settings = get_settings()
logger = logging.getLogger(__name__)


# ============================================================
# ORCHESTRATION ACTIONS (Guardrails)
# The LLM can ONLY call these predefined functions
# ============================================================

ORCHESTRATION_ACTIONS = [
    {
        "type": "function",
        "function": {
            "name": "send_message",
            "description": "Send a conversational message to the user. Use for answering questions, acknowledging info, or general conversation. No widget is shown.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "The message to send. Keep it concise (1-3 sentences)."
                    }
                },
                "required": ["message"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "ask_for_documents",
            "description": "Ask the user to upload relevant project documents that will improve the project plan. Use this in the first exchange alongside acknowledging the project.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Message asking for documents. Be specific about what types would help for THIS project (e.g. feasibility study, site assessment, permit applications)."
                    },
                    "suggested_types": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Types of documents that would be helpful"
                    }
                },
                "required": ["message"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "ask_clarifying_questions",
            "description": "Ask 1-2 targeted clarifying questions when critical project information is missing. Only use when geography OR project type/technology is truly ambiguous.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Message with 1-2 specific questions. Be direct and explain why you need this info."
                    },
                    "fields_needed": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Names of the missing fields (e.g. 'geography', 'project_type', 'technology')"
                    }
                },
                "required": ["message", "fields_needed"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_project_plan",
            "description": "Generate the project plan. Use this when you have enough information: at minimum a project description with identifiable geography and project type/technology.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Brief message (1 sentence) telling the user you're generating their project plan."
                    }
                },
                "required": ["message"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_project_plan",
            "description": "Update the existing project plan based on the user's requested changes. Use this when a project plan already exists and the user asks to add, remove, rename, or modify sections, pillars, or items — including adding entirely new sections the user requests.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Brief message (1 sentence) confirming what changes you'll apply."
                    },
                    "user_request": {
                        "type": "string",
                        "description": "Clear, concise summary of exactly what the user wants changed in the plan."
                    }
                },
                "required": ["message", "user_request"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_lcoe_tool",
            "description": "Run the LCOE (Levelized Cost of Energy) tool to model project economics. Use this when the user asks for LCOE, cost per kWh, project economics, feasibility analysis, or when evaluating whether an energy project is financially viable. Also use when the user mentions capex, opex, discount rate, WACC, or capacity factor in the context of project costing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Brief message (1-2 sentences) telling the user you're building their LCOE model."
                    }
                },
                "required": ["message"]
            }
        }
    },
]


# ============================================================
# ORCHESTRATION SYSTEM PROMPT
# ============================================================

ORCHESTRATION_SYSTEM_PROMPT = """You are an AI assistant helping users develop environmental project plans with specific, tangible deliverables (permits, certifications, grant applications, etc.).

Your goal: quickly understand the user's project and generate a project plan that maps the specific environmental requirements, permits, certifications, and deliverables they need. Minimize questions — extract what you can from their description and uploaded documents.

## YOUR FRAMEWORK (3 phases)

### PHASE 1: Describe
User describes their project. You should:
- Acknowledge what they're working on (1 sentence)
- Offer to accept document uploads using **ask_for_documents** — but ONLY on the first exchange
- Extract as much as you can: project type, technology, geography, scale

### PHASE 2: Clarify (often skippable)
If critical info is missing after Phase 1, ask 1-2 targeted questions using **ask_clarifying_questions**. Critical info means:
- Geography/locale (needed to identify jurisdiction-specific permits and regulations)
- Project type or technology (needed to identify which environmental standards apply)

If you can reasonably infer these from context, SKIP this phase and go straight to plan generation.
Do NOT ask more than 2 clarifying questions total across the entire conversation.

### PHASE 3: Generate Plan
Once you have enough context, use **generate_project_plan**. "Enough context" means you can identify:
- What kind of project it is (solar, wind, water treatment, reforestation, etc.)
- Where it is (country/region/state — even approximate is fine)

You do NOT need: exact budget, timeline, team size, target population, or other nice-to-haves. Generate the plan and let the user refine from there.

## Current Project State
- Title: {title}
- Type: {project_type}
- Description: {description}
- Geography: {geography}
- Has uploaded documents: {has_documents}
- Project plan exists: {has_plan}

## Conversation Progress
- Documents requested: {documents_requested}
- Clarifying questions asked: {clarifying_asked}
- User messages so far: {user_message_count}

## Retrieved Context
{retrieved_context}

## Decision Rules (FOLLOW STRICTLY)

**Rule 1: First user message (documents_requested = No)**
→ Use **ask_for_documents** — acknowledge project and offer document upload

**Rule 2: Have geography + project type (or can infer them)**
→ Use **generate_project_plan** — don't delay

**Rule 3: Missing geography OR project type, and cannot infer (clarifying_asked < 2)**
→ Use **ask_clarifying_questions** — ask ONLY about what's missing, max 1-2 questions

**Rule 4: Already asked clarifying questions and have a response**
→ Use **generate_project_plan** — don't keep asking

**Rule 5: User asks a general question or makes conversation**
→ Use **send_message** to answer, then steer back toward plan generation

**Rule 6: Project plan already exists and user wants to change, add, or remove something**
→ Use **update_project_plan** — users can override and extend the default structure, including adding new sections beyond the standard three pillars

**Rule 7: Project plan already exists and user is asking a question (not requesting changes)**
→ Use **send_message** to answer their question about the plan

**Rule 8: User asks for LCOE, project economics, cost per kWh, feasibility check, or mentions capex/opex/discount rate in a costing context**
→ Use **run_lcoe_tool** — extract what you can from conversation and build the model

**Rule 9: User uploads a document and asks "is this viable?" or "what's the cost?" for an energy project**
→ Use **run_lcoe_tool** — the tool will extract inputs from docs and fill gaps with assumptions

## Style
- Be proactive and directive — move toward the plan quickly
- Keep messages to 1-2 sentences
- Don't lecture about what the platform does
- Don't ask unnecessary questions — if you can infer it, infer it
"""


@dataclass
class OrchestrationResult:
    """Result of an orchestration decision."""
    action: str
    parameters: dict[str, Any]
    sources_used: list[RetrievedFact]

    def to_dict(self) -> dict:
        return {
            "action": self.action,
            "parameters": self.parameters,
            "sources_used": [s.to_dict() for s in self.sources_used],
        }


class OrchestrationService:
    """
    LLM-driven orchestration that decides what action to take next.
    Uses function calling with predefined actions as guardrails.
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.retrieval = TieredRetrievalService(db)

    async def get_next_action(
        self,
        messages: list[ChatMessage],
        initiative: Initiative,
    ) -> OrchestrationResult:
        """
        Decide what action to take next based on conversation and project state.
        """
        context_results = await self.retrieval.retrieve_for_context(initiative)
        context_str = self.retrieval.format_context_for_prompt(context_results)

        sources_used = []
        for result in context_results.values():
            sources_used.extend(result.facts)

        has_document_request = any(
            m.widget_type == "document_request" for m in messages if m.role == "assistant"
        )
        clarifying_asked = sum(
            1 for m in messages
            if m.role == "assistant" and m.widget_type == "clarifying_questions"
        )
        user_message_count = sum(1 for m in messages if m.role == "user")

        system_prompt = ORCHESTRATION_SYSTEM_PROMPT.format(
            retrieved_context=context_str if context_str else "No additional context available.",
            title=initiative.title or "Not set",
            project_type=initiative.project_type or "Unknown",
            description=(initiative.project_description or "Not provided")[:500],
            geography=initiative.geography or "Not specified",
            has_documents="Yes" if initiative.evidence_ready else "No",
            has_plan="Yes" if initiative.project_plan else "No",
            documents_requested="Yes" if has_document_request else "No",
            clarifying_asked=clarifying_asked,
            user_message_count=user_message_count,
        )

        api_messages = [{"role": "system", "content": system_prompt}]

        recent_messages = messages[-15:] if len(messages) > 15 else messages
        for msg in recent_messages:
            api_messages.append({
                "role": msg.role,
                "content": msg.content,
            })

        try:
            response = await self.client.chat.completions.create(
                model=settings.openai_orchestration_model,
                messages=api_messages,
                tools=ORCHESTRATION_ACTIONS,
                tool_choice="required",
                temperature=0.7,
            )

            tool_call = response.choices[0].message.tool_calls[0]
            action = tool_call.function.name
            parameters = json.loads(tool_call.function.arguments)

            logger.info(f"Orchestration chose action: {action}")

            return OrchestrationResult(
                action=action,
                parameters=parameters,
                sources_used=sources_used,
            )

        except Exception as e:
            logger.error(f"Orchestration failed: {e}", exc_info=True)
            return OrchestrationResult(
                action="send_message",
                parameters={"message": "I'm here to help. Could you tell me more about your project?"},
                sources_used=[],
            )

    async def extract_inputs_from_message(
        self,
        message: str,
        initiative: Initiative,
    ) -> dict[str, Any]:
        """
        Extract project inputs from a user message.
        Used to populate initiative fields from conversation.
        """
        input_schema = {
            "project_title": {"type": "string", "description": "Short descriptive title for the project (3-6 words)"},
            "geography": {"type": "string", "description": "Location/country/region/state"},
            "project_description": {"type": "string", "description": "Brief description of the project"},
            "project_type": {"type": "string", "description": "Type/sector (e.g. solar, wind, reforestation, water treatment, clean cooking)"},
            "technology": {"type": "string", "description": "Specific technology if mentioned (e.g. crystalline silicon PV, biomass gasifier)"},
        }

        try:
            response = await self.client.chat.completions.create(
                model=settings.openai_orchestration_model,
                messages=[
                    {
                        "role": "system",
                        "content": "Extract project information from this message. Only include fields that are clearly stated or can be directly inferred. Leave out fields that aren't mentioned."
                    },
                    {
                        "role": "user",
                        "content": message
                    }
                ],
                tools=[{
                    "type": "function",
                    "function": {
                        "name": "extract_inputs",
                        "description": "Extract inputs from the message",
                        "parameters": {
                            "type": "object",
                            "properties": input_schema,
                        }
                    }
                }],
                tool_choice={"type": "function", "function": {"name": "extract_inputs"}},
            )

            tool_call = response.choices[0].message.tool_calls[0]
            extracted = json.loads(tool_call.function.arguments)

            return {k: v for k, v in extracted.items() if v}

        except Exception as e:
            logger.error(f"Input extraction failed: {e}")
            return {}
