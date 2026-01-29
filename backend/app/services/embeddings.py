from openai import AsyncOpenAI
from typing import Optional

from app.config import get_settings

settings = get_settings()


class EmbeddingsService:
    """Service for generating text embeddings"""
    
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.model = settings.openai_embedding_model
    
    async def embed_text(self, text: str) -> list[float]:
        """Generate embedding for a single text"""
        response = await self.client.embeddings.create(
            model=self.model,
            input=text,
        )
        return response.data[0].embedding
    
    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts"""
        if not texts:
            return []
        
        # OpenAI supports batch embedding
        response = await self.client.embeddings.create(
            model=self.model,
            input=texts,
        )
        
        # Sort by index to maintain order
        embeddings = sorted(response.data, key=lambda x: x.index)
        return [e.embedding for e in embeddings]
