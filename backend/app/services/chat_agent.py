"""Chat agent service for conversational workflow."""

from openai import AsyncOpenAI
import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.llm_client import get_openai_client, record_usage_from_response
from app.models.initiative import Initiative
from app.models.chat import CoreChatMessage

ChatMessage = CoreChatMessage
from app.assessments import get_assessment_registry

settings = get_settings()


class ChatAgentService:
    """Service for conversational intake and workflow agent."""
    
    def __init__(self, user_id: str | None = None, db: AsyncSession | None = None):
        self.user_id = user_id
        self.db = db
        self._client: AsyncOpenAI | None = None
        self._is_byok: bool = False
        self.model = settings.openai_model
        self.registry = get_assessment_registry()

    async def _get_client(self) -> AsyncOpenAI:
        if self._client is None:
            self._client, self._is_byok = await get_openai_client(self.user_id, self.db)
        return self._client
    
    def _get_system_prompt(self, initiative: Initiative, widget_type: str | None = None) -> str:
        """Get system prompt based on current context."""
        
        # If we're showing a widget, use context-specific prompts
        if widget_type == "tool_checklist":
            return """You are a professional advisor helping development practitioners shape the right framework for their project.

The user described their project. Write a brief, proactive response that:
1. Acknowledges what they're working on (1 short phrase)
2. Notes that you've outlined the assessments that are most relevant to complete first
3. Invites them to review the recommended assessments below

RULES:
- 2-3 sentences maximum
- Be proactive and knowledgeable
- Refer to assessments or framework steps, not generic deliverables
- Be professional, not casual
- Do NOT explain the project's impact or benefits
- Do NOT write more than 50 words"""

        elif widget_type == "deliverables_overview":
            return """The user has provided all the information needed. Write ONE brief sentence saying you're ready to generate their deliverables.

RULES:
- Maximum 1 sentence
- Just say you have what you need and here's the overview
- Do NOT summarize the project
- Do NOT list what you'll create

Example: "I have everything I need - here's what I'll prepare for you:" """

        # Default flexible prompt for general conversation
        context = self._build_context(initiative)
        
        return f"""You are a helpful assistant for Nitrogen, a platform that helps development professionals create project documentation like investment memos and due diligence checklists.

Current project state:
{context if context else "No project details yet."}

Your role:
- Help users describe their projects and gather information needed for outputs
- Answer questions about development projects, impact investing, or the platform
- Provide information about what teams typically prepare for different project types
- Guide them through the process naturally without forcing them down a specific path
- Help them understand what information is needed for different tools

RULES:
- Keep ALL responses to 1-3 sentences MAX (can be up to 4 for complex answers)
- Be concise and direct
- If the user asks a question, answer it directly - don't redirect to widgets
- If they want to explore options or go back, support that
- Don't lecture or over-explain
- Be friendly but professional and knowledgeable

If tools are selected and you notice missing required inputs, gently ask about them one at a time - but ONLY if they seem ready to proceed, not if they're just asking questions."""
    
    def _build_context(self, initiative: Initiative) -> str:
        """Build context string from initiative state."""
        parts = []
        
        if initiative.title:
            parts.append(f"Project title: {initiative.title}")
        if initiative.project_description:
            parts.append(f"Description: {initiative.project_description[:200]}")
        if initiative.project_type:
            parts.append(f"Type: {initiative.project_type}")
        if initiative.geography:
            parts.append(f"Location: {initiative.geography}")
        if initiative.target_population:
            parts.append(f"Target beneficiaries: {initiative.target_population}")
        if initiative.goal:
            parts.append(f"Goal: {initiative.goal}")
        
        if initiative.selected_tools:
            tool_names = []
            for tool_id in initiative.selected_tools:
                tool = self.registry.get_assessment(tool_id)
                if tool:
                    tool_names.append(tool.definition.name)
            if tool_names:
                parts.append(f"Selected outputs: {', '.join(tool_names)}")
        
        # Check for evidence
        if initiative.evidence_ready:
            parts.append("Evidence documents: Uploaded")
        
        # Check for deliverables (computed from assessment instances)
        deliverables = initiative.get_deliverables_dict()
        if deliverables:
            deliverable_names = list(deliverables.keys())
            if deliverable_names:
                parts.append(f"Generated outputs: {', '.join(deliverable_names)}")
        
        # Note missing inputs if tools are selected
        if initiative.selected_tools:
            missing = initiative.get_missing_tool_inputs()
            if missing:
                missing_fields = []
                for tool_id, fields in missing.items():
                    missing_fields.extend(fields)
                if missing_fields:
                    parts.append(f"Still needed: {', '.join(missing_fields[:3])}")
        
        return "\n".join(parts) if parts else ""
    
    def _build_messages(
        self, 
        chat_history: list[ChatMessage],
        initiative: Initiative,
        widget_type: str | None = None,
    ) -> list[dict]:
        """Build message list for OpenAI API."""
        messages = [{"role": "system", "content": self._get_system_prompt(initiative, widget_type)}]
        
        # Add chat history (last 10 messages to keep context manageable)
        recent_history = chat_history[-10:] if len(chat_history) > 10 else chat_history
        for msg in recent_history:
            messages.append({
                "role": msg.role,
                "content": msg.content,
            })
        
        return messages
    
    async def generate_response(
        self,
        messages: list[ChatMessage],
        initiative: Initiative,
        widget_type: str | None = None,
    ) -> str:
        """Generate assistant response based on conversation."""
        api_messages = self._build_messages(messages, initiative, widget_type)
        
        # Use lower max_tokens to enforce brevity
        max_tokens = 120 if widget_type else 200
        
        client = await self._get_client()
        response = await client.chat.completions.create(
            model=self.model,
            messages=api_messages,
            temperature=0.7,
            max_tokens=max_tokens,
        )
        await record_usage_from_response(self.user_id, self.model, response, self.db, is_byok=self._is_byok)
        
        return response.choices[0].message.content
    
    async def analyze_intent(
        self,
        messages: list[ChatMessage],
        initiative: Initiative,
    ) -> dict:
        """Analyze what the user is trying to do and what info they're providing."""
        
        # Get the last user message
        last_user_msg = None
        for msg in reversed(messages):
            if msg.role == "user":
                last_user_msg = msg.content
                break
        
        if not last_user_msg:
            return {"intent": "greeting", "extracted_info": {}}
        
        # Build context for analysis
        context = self._build_context(initiative)
        
        try:
            client = await self._get_client()
            response = await client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": f"""Analyze this user message and extract any project information they're providing.

Current project state:
{context if context else "New project, no details yet."}

Determine:
1. What intent the user has
2. What new information they're providing about their project
3. Whether they're describing a project (ANY mention of what they're working on counts as ready for tools)
4. Whether they want to go back or change something they previously confirmed

IMPORTANT: 
- If they mention ANYTHING about a project (e.g., "solar panels in Mongolia", "micro-grids in Kenya"), set ready_for_tools=true
- Only set is_question=true and intent="asking_question" if they're asking ABOUT the platform or process, NOT describing their project
- "Solar panels in Mongolia" is describing a project, NOT asking a question"""
                    },
                    {
                        "role": "user",
                        "content": last_user_msg
                    }
                ],
                tools=[{
                    "type": "function",
                    "function": {
                        "name": "analyze_message",
                        "description": "Analyze user intent and extract information",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "intent": {
                                    "type": "string",
                                    "enum": ["describing_project", "asking_question", "requesting_generation", "providing_info", "going_back", "general_conversation"],
                                    "description": "What the user is trying to do. Use 'going_back' if they want to change tools, go back, or modify something. Use 'asking_question' for questions about the platform, process, or their project. Use 'general_conversation' for casual chat."
                                },
                                "is_question": {
                                    "type": "boolean",
                                    "description": "True if the user is asking a question that needs an answer (not just providing info)"
                                },
                                "wants_to_proceed": {
                                    "type": "boolean",
                                    "description": "True if user explicitly wants to generate/proceed (e.g., 'let's do it', 'generate', 'I'm ready')"
                                },
                                "wants_to_go_back": {
                                    "type": "boolean",
                                    "description": "True if user wants to go back, change something, or isn't ready to proceed"
                                },
                                "project_description": {
                                    "type": "string",
                                    "description": "Brief description of the project if provided"
                                },
                                "project_type": {
                                    "type": "string",
                                    "enum": ["energy_access", "clean_cooking", "agriculture", "water_sanitation", "health", "general", ""],
                                    "description": "Type of project if identifiable"
                                },
                                "title": {
                                    "type": "string",
                                    "description": "Short, descriptive title (3-6 words) that captures the project - ALWAYS generate if user describes a project"
                                },
                                "geography": {
                                    "type": "string",
                                    "description": "Location/country/region - ALWAYS extract if ANY location is mentioned (e.g., 'Kenya', 'East Africa', 'rural India')"
                                },
                                "target_beneficiaries": {
                                    "type": "string",
                                    "description": "Who will benefit from this project if mentioned"
                                },
                                "project_goal": {
                                    "type": "string",
                                    "description": "Main goal or objective if mentioned"
                                },
                                "ready_for_tools": {
                                    "type": "boolean",
                                    "description": "True if user has provided enough project context to recommend tools"
                                }
                            },
                            "required": ["intent", "ready_for_tools", "is_question", "wants_to_proceed", "wants_to_go_back"]
                        }
                    }
                }],
                tool_choice={"type": "function", "function": {"name": "analyze_message"}},
                timeout=30.0,
            )
            await record_usage_from_response(self.user_id, self.model, response, self.db, is_byok=self._is_byok)
            
            tool_call = response.choices[0].message.tool_calls[0]
            result = json.loads(tool_call.function.arguments)
            
            # Ensure required fields have defaults
            result.setdefault("intent", "describing_project")
            result.setdefault("ready_for_tools", False)
            result.setdefault("is_question", False)
            result.setdefault("wants_to_proceed", False)
            result.setdefault("wants_to_go_back", False)
            
            return result
        except Exception as e:
            # If API call fails, return safe defaults
            import logging
            logging.error(f"OpenAI API call failed in analyze_intent: {e}")
            return {
                "intent": "describing_project",
                "ready_for_tools": False,
                "is_question": False,
                "wants_to_proceed": False,
                "wants_to_go_back": False,
            }
    
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
        
        client = await self._get_client()
        response = await client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": """Extract project information from this conversation. Return structured data.

CRITICAL EXTRACTION RULES:

1. TITLE (REQUIRED): Generate a concise, descriptive title (3-6 words) that captures what the user described.
   - User says "solar mini-grids in Kenya" → title: "Solar Mini-Grids in Kenya"
   - User says "LPG distribution project in Namibia" → title: "LPG Distribution in Namibia"  
   - User says "micro solar grids in Zimbabwe" → title: "Micro Solar Grids in Zimbabwe"
   - The title MUST match what the user described, not a generic example

2. GEOGRAPHY (REQUIRED if mentioned): Extract ANY location, country, or region mentioned.
   - "in Kenya" → geography: "Kenya"
   - "across East Africa" → geography: "East Africa"
   - "rural Mongolia" → geography: "Mongolia"
   - If the user mentions a location, you MUST extract it

3. PROJECT_TYPE (REQUIRED): Classify based on the primary focus area.

Do NOT return null/empty for title or geography if the user mentioned them."""
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
                                "description": "Short, descriptive title for the project (3-6 words) - MUST reflect what the user actually described"
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
                        "required": ["project_description", "project_type", "title"]
                    }
                }
            }],
            tool_choice={"type": "function", "function": {"name": "extract_project_info"}},
        )
        await record_usage_from_response(self.user_id, self.model, response, self.db, is_byok=self._is_byok)
        
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
            tool = self.registry.get_assessment(tool_id)
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
        
        client = await self._get_client()
        response = await client.chat.completions.create(
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
        await record_usage_from_response(self.user_id, self.model, response, self.db, is_byok=self._is_byok)
        
        tool_call = response.choices[0].message.tool_calls[0]
        return json.loads(tool_call.function.arguments)
    
    async def quick_doc_summary(self, preview_text: str) -> str:
        """Generate a ONE sentence summary of what the document appears to be about."""
        try:
            client = await self._get_client()
            response = await client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "Based on this document excerpt, write ONE short sentence (max 15 words) describing what the document covers. Start with 'This covers' or 'I can see this includes'. Example: 'This covers your project's financial model and revenue projections.'"
                    },
                    {
                        "role": "user",
                        "content": preview_text
                    }
                ],
                temperature=0.5,
                max_tokens=40,
            )
            await record_usage_from_response(self.user_id, self.model, response, self.db, is_byok=self._is_byok)
            return response.choices[0].message.content
        except Exception:
            return "I'll use this to create more accurate outputs."
    
    async def select_project_icon(self, title: str, description: str = "") -> str:
        """Select an appropriate icon for the project based on title and description."""
        context = title
        if description:
            context += f". {description[:300]}"
        
        try:
            client = await self._get_client()
            response = await client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": """Select the best icon for this project. Return ONLY the icon name, nothing else.

Available icons: Sun, Droplet, Droplets, Zap, Sprout, Factory, Heart, School, Building, Building2, Wind, Lightbulb, TreePine, Trees, Fish, Truck, Store, Home, Users, DollarSign, Recycle, Flame, Battery, BatteryCharging, Plug, Plug2, Leaf, Waves, CloudRain, Mountain, Wheat, Apple, Carrot, Milk, Beef, ShoppingCart, Package, Warehouse, Ship, Plane, Bus, Train, Car, Bike, Footprints, Radio, Smartphone, Wifi, Globe, MapPin, Map, Compass, Navigation, Briefcase, Calculator, BarChart3, TrendingUp, PiggyBank, CreditCard, Banknote, Coins, Wallet, Receipt, Target, Award, Trophy, Medal, Flag, Rocket, Sparkles, Star, Stethoscope, Pill, Utensils, Shovel, Gem, Power, PowerOff, Antenna, Signal, Satellite, Network, Handshake, HeartHandshake, Scale, Tractor, CircleDollarSign, BadgeDollarSign, GraduationCap, Library, BookOpen

Examples: solar/energy → Sun, water/sanitation → Droplet, agriculture/farming → Sprout or Tractor, health/medical → Stethoscope or Heart, education → GraduationCap or School, cooking/fuel → Flame, wind energy → Wind, finance → DollarSign"""
                    },
                    {
                        "role": "user",
                        "content": context
                    }
                ],
                temperature=0.3,
                max_tokens=10,
            )
            await record_usage_from_response(self.user_id, self.model, response, self.db, is_byok=self._is_byok)
            icon_name = response.choices[0].message.content.strip()
            return icon_name
        except Exception as e:
            import logging
            logging.error(f"Icon selection failed: {e}")
            return "FolderOpen"  # Fallback
    
    async def generate_materials_request_v2(self, user_description: str) -> str:
        """Generate a contextual materials request based on user's project description."""
        try:
            client = await self._get_client()
            response = await client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": """You help development practitioners prepare project documentation. Based on the user's project description, write a brief message asking if they have materials to upload.

Your response should follow this structure (but DO NOT include quotes):
For [relevant SDG or sector context], projects like this often involve [relevant financing/implementation approach]. Do you have any existing materials such as [2-3 relevant document types]?

RULES:
- Output ONLY the message text, no quotes or formatting
- Keep it to 2 sentences maximum
- Be specific to their project
- Mention a relevant SDG or sector context
- Reference financing/implementation approaches relevant to their project
- Suggest 2-3 document types useful for their specific project"""
                    },
                    {
                        "role": "user",
                        "content": user_description
                    }
                ],
                temperature=0.7,
                max_tokens=120,
            )
            await record_usage_from_response(self.user_id, self.model, response, self.db, is_byok=self._is_byok)
            # Strip any quotes the LLM might add
            result = response.choices[0].message.content.strip()
            if result.startswith('"') and result.endswith('"'):
                result = result[1:-1]
            return result
        except Exception:
            # Fallback to generic message if LLM fails
            return "For impact projects like this, teams often have supporting documentation. Do you have any existing materials such as pitch decks, feasibility studies, or financial projections?"
