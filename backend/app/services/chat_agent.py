from openai import AsyncOpenAI
from typing import Optional
from pathlib import Path

from app.config import get_settings
from app.models.initiative import Initiative
from app.models.chat import ChatMessage

settings = get_settings()


class ChatAgentService:
    """Service for conversational intake agent"""
    
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.model = settings.openai_model
        self.system_prompt = self._load_system_prompt()
    
    def _load_system_prompt(self) -> str:
        """Load system prompt from file"""
        prompt_path = Path(__file__).parent.parent / "prompts" / "intake_system.txt"
        if prompt_path.exists():
            return prompt_path.read_text()
        return self._default_system_prompt()
    
    def _default_system_prompt(self) -> str:
        return """You are a helpful assistant guiding users through defining their development initiative. Your goal is to gather the following information through natural conversation:

REQUIRED FIELDS (must gather all):
- Initiative title or short name
- Sector (default to "clean cooking" if discussing cookstoves, fuels, etc.)
- Geography (country or region)
- Target population / beneficiary
- Goal (one sentence describing success)

OPTIONAL FIELDS (ask if natural):
- Budget range
- Timeline
- Key constraints (1-3 bullets)

CONVERSATION GUIDELINES:
1. Ask ONE question at a time
2. Be conversational and friendly, not robotic
3. Acknowledge what the user shares before asking the next question
4. If the user provides multiple pieces of information at once, acknowledge them all
5. Don't repeat information the user has already provided
6. Once you have all required fields, summarize what you've learned and indicate readiness to proceed

IMPORTANT:
- Keep responses concise (2-3 sentences max)
- Don't use bullet points in your responses
- Don't explain the process, just guide through it naturally
- If the user's response is unclear, ask a clarifying follow-up"""
    
    def _build_messages(
        self, 
        chat_history: list[ChatMessage],
        initiative: Initiative,
    ) -> list[dict]:
        """Build message list for OpenAI API"""
        messages = [{"role": "system", "content": self.system_prompt}]
        
        # Add context about current initiative state
        context = self._build_context(initiative)
        if context:
            messages.append({
                "role": "system", 
                "content": f"Current initiative state:\n{context}"
            })
        
        # Add chat history
        for msg in chat_history:
            messages.append({
                "role": msg.role,
                "content": msg.content,
            })
        
        return messages
    
    def _build_context(self, initiative: Initiative) -> str:
        """Build context string from initiative fields"""
        parts = []
        if initiative.title:
            parts.append(f"Title: {initiative.title}")
        if initiative.sector:
            parts.append(f"Sector: {initiative.sector}")
        if initiative.geography:
            parts.append(f"Geography: {initiative.geography}")
        if initiative.target_population:
            parts.append(f"Target population: {initiative.target_population}")
        if initiative.goal:
            parts.append(f"Goal: {initiative.goal}")
        if initiative.budget_range:
            parts.append(f"Budget: {initiative.budget_range}")
        if initiative.timeline:
            parts.append(f"Timeline: {initiative.timeline}")
        if initiative.constraints:
            parts.append(f"Constraints: {', '.join(initiative.constraints)}")
        
        return "\n".join(parts) if parts else ""
    
    async def generate_response(
        self,
        messages: list[ChatMessage],
        initiative: Initiative,
    ) -> str:
        """Generate assistant response based on conversation"""
        api_messages = self._build_messages(messages, initiative)
        
        # Check if all required fields are complete
        if initiative.is_intake_complete():
            # Add instruction to wrap up
            api_messages.append({
                "role": "system",
                "content": "All required fields have been gathered. Provide a brief summary of the initiative and indicate that you're ready to proceed to the next step (uploading evidence)."
            })
        
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=api_messages,
            temperature=0.7,
            max_tokens=500,
        )
        
        return response.choices[0].message.content
