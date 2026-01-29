from openai import AsyncOpenAI
import json
from typing import Optional

from app.config import get_settings
from app.models.chat import ChatMessage
from app.schemas.chat import ExtractedFields

settings = get_settings()


class FieldExtractorService:
    """Service for extracting structured fields from conversation"""
    
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.model = settings.openai_model
    
    async def extract_fields(
        self,
        messages: list[ChatMessage],
    ) -> Optional[ExtractedFields]:
        """Extract initiative fields from conversation history"""
        # Build conversation text
        conversation = "\n".join([
            f"{msg.role.upper()}: {msg.content}"
            for msg in messages
        ])
        
        # Use function calling for structured extraction
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": "Extract structured information about the initiative from the conversation. Only extract fields that are explicitly mentioned or clearly implied."
                },
                {
                    "role": "user",
                    "content": f"Extract the initiative fields from this conversation:\n\n{conversation}"
                }
            ],
            tools=[{
                "type": "function",
                "function": {
                    "name": "extract_initiative_fields",
                    "description": "Extract initiative fields from conversation",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "title": {
                                "type": "string",
                                "description": "Short name or title for the initiative"
                            },
                            "sector": {
                                "type": "string",
                                "description": "Sector (e.g., clean_cooking, energy, health)"
                            },
                            "geography": {
                                "type": "string",
                                "description": "Country or region where initiative operates"
                            },
                            "target_population": {
                                "type": "string",
                                "description": "Who the initiative serves (beneficiaries)"
                            },
                            "goal": {
                                "type": "string",
                                "description": "One sentence describing what success looks like"
                            },
                            "budget_range": {
                                "type": "string",
                                "description": "Budget range if mentioned (e.g., $500K-1M)"
                            },
                            "timeline": {
                                "type": "string",
                                "description": "Timeline if mentioned (e.g., 18 months)"
                            },
                            "constraints": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Key constraints or limitations mentioned"
                            }
                        },
                        "required": []
                    }
                }
            }],
            tool_choice={"type": "function", "function": {"name": "extract_initiative_fields"}},
            temperature=0,
        )
        
        # Parse function call response
        if response.choices[0].message.tool_calls:
            tool_call = response.choices[0].message.tool_calls[0]
            try:
                args = json.loads(tool_call.function.arguments)
                return ExtractedFields(**args)
            except (json.JSONDecodeError, ValueError):
                return None
        
        return None
