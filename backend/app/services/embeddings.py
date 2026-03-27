from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.llm_client import get_openai_client, record_usage_from_response

settings = get_settings()


class EmbeddingsService:
    """Service for generating text embeddings"""
    
    def __init__(self, user_id: str | None = None, db: AsyncSession | None = None):
        self.user_id = user_id
        self.db = db
        self._client: AsyncOpenAI | None = None
        self._is_byok: bool = False
        self.model = settings.openai_embedding_model

    async def _get_client(self) -> AsyncOpenAI:
        if self._client is None:
            self._client, self._is_byok = await get_openai_client(self.user_id, self.db)
        return self._client
    
    async def embed_text(self, text: str) -> list[float]:
        """Generate embedding for a single text"""
        client = await self._get_client()
        response = await client.embeddings.create(
            model=self.model,
            input=text,
        )
        await record_usage_from_response(self.user_id, self.model, response, self.db, is_byok=self._is_byok)
        return response.data[0].embedding
    
    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts"""
        if not texts:
            return []
        
        client = await self._get_client()
        response = await client.embeddings.create(
            model=self.model,
            input=texts,
        )
        await record_usage_from_response(self.user_id, self.model, response, self.db, is_byok=self._is_byok)
        
        # Sort by index to maintain order
        embeddings = sorted(response.data, key=lambda x: x.index)
        return [e.embedding for e in embeddings]
