"""Chat agent service for conversational workflow."""

from openai import AsyncOpenAI
from typing import Optional
from pathlib import Path

from app.config import get_settings
from app.models.initiative import Initiative, InitiativeStage
from app.models.chat import ChatMessage
from app.tools import get_tool_registry

settings = get_settings()


class ChatAgentService:
    """Service for conversational intake and workflow agent."""
    
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.model = settings.openai_model
        self.registry = get_tool_registry()
    
    def _get_system_prompt(self, stage: str, widget_type: str | None = None) -> str:
        """Get system prompt based on current stage and widget context."""
        
        # If we're showing a widget, use ultra-brief prompts
        if widget_type == "tool_checklist":
            return """You are a professional advisor helping development practitioners prepare project documentation.

The user described their project. Write a brief, professional response that:
1. Acknowledges their project (1 short phrase)
2. Explains what deliverables are typically prepared for this type of project
3. Introduces the tool recommendations

RULES:
- 2-3 sentences maximum
- Be professional, not casual
- Reference what practitioners typically prepare for this project type
- Do NOT explain the project's potential impact or benefits
- Do NOT write more than 50 words

Example for a solar mini-grid project:
"For energy access projects like this, teams typically prepare investment memos to secure funding and due diligence checklists to assess implementation risks. Based on your mini-grid initiative in Kenya, I'd recommend:"

Example for an LPG project:
"Clean cooking initiatives often require investment documentation and risk assessments for stakeholder review. For your LPG distribution project in Namibia, here's what I'd suggest:"

BAD (too casual): "Great project! Here are some tools:"
BAD (too long): "Your initiative focuses on promoting the use of..." """

        elif widget_type == "deliverables_overview":
            return """The user has provided all the information needed. Write ONE brief sentence saying you're ready to generate their deliverables.

RULES:
- Maximum 1 sentence
- Just say you have what you need and here's the overview
- Do NOT summarize the project
- Do NOT list what you'll create

Example: "I have everything I need - here's what I'll prepare for you:"
"""

        elif stage == InitiativeStage.DESCRIBE.value:
            return """You are a helpful assistant for Wisterion, a platform that helps development professionals create project documentation.

Your goal is to understand what project the user is working on. Keep it conversational and brief.

RULES:
- Keep ALL responses to 1-2 sentences MAX
- Ask ONE question at a time
- Be friendly but concise
- Don't explain the platform
- Don't elaborate on their project's potential impact"""

        elif stage == InitiativeStage.SELECT_TOOLS.value:
            return """The user is selecting which tools to use. Keep responses very brief.

RULES:
- 1-2 sentences maximum
- Just acknowledge their selection briefly"""

        elif stage == InitiativeStage.GATHER_INPUTS.value:
            return """You are gathering information needed for the user's selected tools. Ask questions to fill in missing details.

RULES:
- Keep responses to 1-2 sentences
- Ask ONE specific question at a time
- If user doesn't have info, that's okay - move on
- Be helpful but concise"""

        elif stage == InitiativeStage.REVIEW.value:
            return """The user is reviewing their project overview before generation.

RULES:
- Keep responses very brief (1 sentence)
- Just acknowledge and let them review"""

        else:
            return """You are a helpful assistant. Keep responses brief and helpful.

RULES:
- Maximum 2 sentences
- Be concise and direct"""
    
    def _build_messages(
        self, 
        chat_history: list[ChatMessage],
        initiative: Initiative,
        widget_type: str | None = None,
    ) -> list[dict]:
        """Build message list for OpenAI API."""
        stage = initiative.stage or InitiativeStage.DESCRIBE.value
        messages = [{"role": "system", "content": self._get_system_prompt(stage, widget_type)}]
        
        # Add context about current state
        context = self._build_context(initiative)
        if context:
            messages.append({
                "role": "system", 
                "content": f"Project context:\n{context}"
            })
        
        # Add chat history (last 10 messages to keep context manageable)
        recent_history = chat_history[-10:] if len(chat_history) > 10 else chat_history
        for msg in recent_history:
            messages.append({
                "role": msg.role,
                "content": msg.content,
            })
        
        return messages
    
    def _build_context(self, initiative: Initiative) -> str:
        """Build context string from initiative state."""
        parts = []
        
        if initiative.project_description:
            parts.append(f"Project: {initiative.project_description[:200]}")
        if initiative.project_type:
            parts.append(f"Type: {initiative.project_type}")
        if initiative.title:
            parts.append(f"Title: {initiative.title}")
        if initiative.geography:
            parts.append(f"Location: {initiative.geography}")
        if initiative.selected_tools:
            tool_names = []
            for tool_id in initiative.selected_tools:
                tool = self.registry.get_tool(tool_id)
                if tool:
                    tool_names.append(tool.definition.name)
            if tool_names:
                parts.append(f"Selected tools: {', '.join(tool_names)}")
        
        return "\n".join(parts) if parts else ""
    
    async def generate_response(
        self,
        messages: list[ChatMessage],
        initiative: Initiative,
        widget_type: str | None = None,
    ) -> str:
        """Generate assistant response based on conversation."""
        api_messages = self._build_messages(messages, initiative, widget_type)
        
        # Use lower max_tokens to enforce brevity
        max_tokens = 120 if widget_type else 150
        
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=api_messages,
            temperature=0.7,
            max_tokens=max_tokens,
        )
        
        return response.choices[0].message.content
    
    async def extract_project_info(
        self,
        messages: list[ChatMessage],
    ) -> dict:
        """Extract project information from conversation."""
        
        # Build conversation text
        conversation = "\n".join([
            f"{msg.role}: {msg.content}" 
            for msg in messages
        ])
        
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": "Extract project information from this conversation. Return structured data."
                },
                {
                    "role": "user",
                    "content": conversation
                }
            ],
            tools=[{
                "type": "function",
                "function": {
                    "name": "extract_project_info",
                    "description": "Extract project information from conversation",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "project_description": {
                                "type": "string",
                                "description": "Brief description of the project (1-2 sentences max)"
                            },
                            "project_type": {
                                "type": "string",
                                "enum": ["energy_access", "clean_cooking", "agriculture", "water_sanitation", "health", "general"],
                                "description": "Type of project"
                            },
                            "title": {
                                "type": "string",
                                "description": "Short title for the project (3-6 words)"
                            },
                            "geography": {
                                "type": "string",
                                "description": "Location/geography of the project"
                            },
                            "target_beneficiaries": {
                                "type": "string",
                                "description": "Who will benefit from this project"
                            },
                            "project_goal": {
                                "type": "string",
                                "description": "Main goal or objective"
                            }
                        },
                        "required": ["project_description", "project_type"]
                    }
                }
            }],
            tool_choice={"type": "function", "function": {"name": "extract_project_info"}},
        )
        
        import json
        tool_call = response.choices[0].message.tool_calls[0]
        return json.loads(tool_call.function.arguments)
    
    async def extract_tool_inputs(
        self,
        messages: list[ChatMessage],
        tool_ids: list[str],
    ) -> dict:
        """Extract tool-specific inputs from conversation."""
        
        # Get input definitions for selected tools
        input_schema = {}
        for tool_id in tool_ids:
            tool = self.registry.get_tool(tool_id)
            if tool:
                for inp in tool.all_inputs:
                    if inp.name not in input_schema:
                        input_schema[inp.name] = {
                            "type": "string",
                            "description": inp.description,
                        }
        
        # Build conversation text
        conversation = "\n".join([
            f"{msg.role}: {msg.content}" 
            for msg in messages
        ])
        
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": "Extract project and tool input information from this conversation. Only include fields that are clearly stated."
                },
                {
                    "role": "user",
                    "content": conversation
                }
            ],
            tools=[{
                "type": "function",
                "function": {
                    "name": "extract_inputs",
                    "description": "Extract inputs from conversation",
                    "parameters": {
                        "type": "object",
                        "properties": input_schema,
                    }
                }
            }],
            tool_choice={"type": "function", "function": {"name": "extract_inputs"}},
        )
        
        import json
        tool_call = response.choices[0].message.tool_calls[0]
        return json.loads(tool_call.function.arguments)
