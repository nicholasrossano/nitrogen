"""
Orchestration Service

LLM-driven chat orchestration that decides what action to take next.
Uses function calling to constrain the LLM to valid actions only.

The LLM receives:
- Current project state
- Retrieved context from tiered retrieval (corpus, web, etc.)
- Available tools
- Chat history

And outputs one of the predefined actions.
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
from app.tools import get_tool_registry
from app.tools.base import BaseTool
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
            "description": "Send a conversational message to the user. Use this for answering questions, providing information, or general conversation. No widget is shown.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "The message to send to the user. Keep it concise (1-3 sentences). Include source citations when referencing retrieved context."
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
            "description": "Ask the user to upload relevant project documents. Use this early in the conversation to gather materials that will improve output quality.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Message asking for documents. Be specific about what types would be helpful."
                    },
                    "suggested_types": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Types of documents that would be helpful (e.g., 'pitch deck', 'feasibility study', 'financial projections')"
                    }
                },
                "required": ["message"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "show_tool_recommendations",
            "description": "Show recommended analysis tools based on the project. Use this when you understand the project well enough to suggest specific deliverables.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Message introducing the recommendations. Reference why these tools are appropriate for this project type."
                    },
                    "tool_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "IDs of tools to recommend. Must be valid tool IDs from the available tools list."
                    },
                    "reasoning": {
                        "type": "string",
                        "description": "Brief explanation of why these tools are recommended for this project."
                    }
                },
                "required": ["message", "tool_ids"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "ask_clarifying_questions",
            "description": "Ask the user for specific information needed for analysis. Use this to gather required inputs for selected tools.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Message asking for information. Be specific and ask 1-2 questions at a time."
                    },
                    "fields_needed": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Names of the specific fields/inputs you're asking about"
                    }
                },
                "required": ["message"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "proceed_to_alignment",
            "description": "User has provided enough information. Proceed to show the alignment/outline for a specific tool before generation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tool_id": {
                        "type": "string",
                        "description": "ID of the tool to show alignment for"
                    },
                    "message": {
                        "type": "string",
                        "description": "Message introducing the alignment review"
                    }
                },
                "required": ["tool_id", "message"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "proceed_to_generation",
            "description": "All alignments are confirmed. Show the deliverables overview and let user generate.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Message confirming readiness to generate deliverables"
                    }
                },
                "required": ["message"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "show_tool_selection",
            "description": "Show the tool selection interface. Use this when user wants to change their selected tools or go back to tool selection.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Message introducing tool selection"
                    }
                },
                "required": ["message"]
            }
        }
    }
]


# ============================================================
# ORCHESTRATION SYSTEM PROMPT
# ============================================================

ORCHESTRATION_SYSTEM_PROMPT = """You are an AI assistant helping users create professional documentation for sustainable development projects. You LEAD the conversation through a clear framework - don't just ask questions.

## YOUR FRAMEWORK (Follow this flow)

### PHASE 1: Project Description → Document Collection
When user first describes their project:
- Acknowledge what they're working on (1 sentence)
- IMMEDIATELY use **ask_for_documents** to request relevant materials
- Be specific about what documents would help (pitch decks, feasibility studies, financial models)

### PHASE 2: Document Response → Tool Recommendations  
After user uploads documents OR says they don't have any:
- If they uploaded: Briefly acknowledge receipt
- IMMEDIATELY use **show_tool_recommendations** with appropriate tools
- Recommend 1-2 tools based on project type (investment_memo for funding, due_diligence_checklist for assessment)
- Be proactive: "For [project type], I recommend..." not "What would you like to do?"

### PHASE 3: Tools Selected → Gather Inputs
After user selects tools:
- Check what inputs are missing
- Use **ask_clarifying_questions** to gather 1-2 missing inputs at a time
- When all inputs collected, proceed to alignment

### PHASE 4: Alignment → Generation
- Use **proceed_to_alignment** when inputs are ready
- Use **proceed_to_generation** when alignments confirmed

## Current Project State
- Title: {title}
- Type: {project_type}  
- Description: {description}
- Geography: {geography}
- Selected tools: {selected_tools}
- Missing required inputs: {missing_inputs}
- Has uploaded documents: {has_documents}
- Pending alignments: {pending_alignments}
- All alignments confirmed: {alignments_confirmed}

## Conversation Progress
- Documents requested: {documents_requested}
- Tool recommendations shown: {tools_shown}
- User messages so far: {user_message_count}

## Available Tools
{tool_descriptions}

## Retrieved Context
{retrieved_context}

## Decision Rules (FOLLOW STRICTLY)

**Rule 1: First user message (documents_requested = No)**
→ Use **ask_for_documents** - Ask if they have materials to upload

**Rule 2: After document request (documents_requested = Yes, tools_shown = No, selected_tools = None)**
→ Use **show_tool_recommendations** - Show relevant tools immediately

**Rule 3: Tools selected, inputs missing (selected_tools != None, missing_inputs != None)**
→ Use **ask_clarifying_questions** - Gather 1-2 missing inputs

**Rule 4: All inputs ready, alignments pending (missing_inputs = None, pending_alignments != None)**
→ Use **proceed_to_alignment** - Show alignment for first pending tool

**Rule 5: All alignments confirmed**
→ Use **proceed_to_generation** - Show deliverables overview

**Rule 6: User asks a question or wants to go back**
→ Use **send_message** to answer, or **show_tool_selection** if they want to change tools

## Style
- Be proactive and directive, not passive
- Lead with what YOU can do, not questions about what THEY want
- Keep messages to 1-2 sentences
- Reference the project type when recommending tools
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
        self.registry = get_tool_registry()
    
    async def get_next_action(
        self,
        messages: list[ChatMessage],
        initiative: Initiative,
    ) -> OrchestrationResult:
        """
        Decide what action to take next based on conversation and project state.
        
        Uses:
        1. Tiered retrieval for context (corpus → web → LLM)
        2. Function calling to constrain to valid actions
        
        Returns:
            OrchestrationResult with the chosen action and parameters
        """
        # Retrieve contextual information
        context_results = await self.retrieval.retrieve_for_context(initiative)
        context_str = self.retrieval.format_context_for_prompt(context_results)
        
        # Collect all sources used for citation tracking
        sources_used = []
        for result in context_results.values():
            sources_used.extend(result.facts)
        
        # Build tool descriptions
        tools = self.registry.get_all_tools()
        tool_descriptions = self._format_tool_descriptions(tools)
        
        # Build project state
        missing_inputs = initiative.get_missing_tool_inputs() if initiative.selected_tools else {}
        pending_alignments = initiative.get_pending_alignment_tools() if initiative.selected_tools else []
        alignments_confirmed = bool(initiative.selected_tools) and not pending_alignments and not missing_inputs
        
        # Analyze conversation history for flow tracking
        has_document_request = any(
            m.widget_type == "document_request" for m in messages if m.role == "assistant"
        )
        has_tool_checklist = any(
            m.widget_type == "tool_checklist" for m in messages if m.role == "assistant"
        )
        user_message_count = sum(1 for m in messages if m.role == "user")
        
        # Format system prompt
        system_prompt = ORCHESTRATION_SYSTEM_PROMPT.format(
            retrieved_context=context_str if context_str else "No additional context available.",
            tool_descriptions=tool_descriptions,
            title=initiative.title or "Not set",
            project_type=initiative.project_type or "Unknown",
            description=(initiative.project_description or "Not provided")[:300],
            geography=initiative.geography or "Not specified",
            selected_tools=", ".join(initiative.selected_tools) if initiative.selected_tools else "None",
            tool_inputs=self._format_inputs(initiative.tool_inputs),
            missing_inputs=self._format_missing_inputs(missing_inputs),
            has_documents="Yes" if initiative.evidence_ready else "No",
            pending_alignments=", ".join(pending_alignments) if pending_alignments else "None",
            alignments_confirmed="Yes" if alignments_confirmed else "No",
            documents_requested="Yes" if has_document_request else "No",
            tools_shown="Yes" if has_tool_checklist else "No",
            user_message_count=user_message_count,
        )
        
        # Build messages for API call
        api_messages = [{"role": "system", "content": system_prompt}]
        
        # Add recent chat history (last 15 messages)
        recent_messages = messages[-15:] if len(messages) > 15 else messages
        for msg in recent_messages:
            api_messages.append({
                "role": msg.role,
                "content": msg.content,
            })
        
        # Call orchestration model with function calling
        try:
            response = await self.client.chat.completions.create(
                model=settings.openai_orchestration_model,
                messages=api_messages,
                tools=ORCHESTRATION_ACTIONS,
                tool_choice="required",  # Must pick an action
                temperature=0.7,
            )
            
            # Parse the chosen action
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
            # Fallback to a safe default action
            return OrchestrationResult(
                action="send_message",
                parameters={"message": "I'm here to help. Could you tell me more about your project?"},
                sources_used=[],
            )
    
    def _format_tool_descriptions(self, tools: list[BaseTool]) -> str:
        """Format tool descriptions for the prompt."""
        lines = []
        for tool in tools:
            defn = tool.definition
            required_inputs = [inp.label for inp in tool.required_inputs]
            lines.append(
                f"- **{defn.id}**: {defn.name} - {defn.description}\n"
                f"  Required inputs: {', '.join(required_inputs) if required_inputs else 'None'}"
            )
        return "\n".join(lines)
    
    def _format_inputs(self, inputs: dict | None) -> str:
        """Format collected inputs for the prompt."""
        if not inputs:
            return "None collected"
        
        # Show only non-empty values
        collected = {k: v for k, v in inputs.items() if v}
        if not collected:
            return "None collected"
        
        return ", ".join(f"{k}: {str(v)[:50]}" for k, v in collected.items())
    
    def _format_missing_inputs(self, missing: dict[str, list[str]]) -> str:
        """Format missing inputs for the prompt."""
        if not missing:
            return "None - all inputs collected"
        
        all_missing = []
        for tool_id, fields in missing.items():
            all_missing.extend(fields)
        
        return ", ".join(all_missing) if all_missing else "None"
    
    async def extract_inputs_from_message(
        self,
        message: str,
        initiative: Initiative,
    ) -> dict[str, Any]:
        """
        Extract project inputs from a user message.
        Used to populate initiative fields and tool inputs.
        """
        if not initiative.selected_tools:
            # Just extract basic project info
            input_schema = {
                "project_title": {"type": "string", "description": "Title for the project"},
                "geography": {"type": "string", "description": "Location/country/region"},
                "project_description": {"type": "string", "description": "Brief description"},
                "target_beneficiaries": {"type": "string", "description": "Who will benefit"},
                "project_goal": {"type": "string", "description": "Main objective"},
            }
        else:
            # Include tool-specific inputs
            input_schema = {}
            for tool_id in initiative.selected_tools:
                tool = self.registry.get_tool(tool_id)
                if tool:
                    for inp in tool.all_inputs:
                        if inp.name not in input_schema:
                            input_schema[inp.name] = {
                                "type": "string",
                                "description": inp.description,
                            }
        
        try:
            response = await self.client.chat.completions.create(
                model=settings.openai_generation_model,  # Use cheaper model for extraction
                messages=[
                    {
                        "role": "system",
                        "content": "Extract project information from this message. Only include fields that are clearly stated. Leave out fields that aren't mentioned."
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
            
            # Filter out empty values
            return {k: v for k, v in extracted.items() if v}
            
        except Exception as e:
            logger.error(f"Input extraction failed: {e}")
            return {}
