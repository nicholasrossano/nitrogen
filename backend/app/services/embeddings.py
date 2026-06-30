from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.llm_client import get_openai_client
from app.core.llm_invoke import aembedding

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
        vectors = await aembedding(self.user_id, self.db, texts=text)
        return vectors[0]

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts"""
        return await aembedding(self.user_id, self.db, texts=texts)
