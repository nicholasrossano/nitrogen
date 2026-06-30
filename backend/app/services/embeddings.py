from sqlalchemy.ext.asyncio import AsyncSession

from app.core.llm_invoke import aembedding


class EmbeddingsService:
    """Service for generating text embeddings"""

    def __init__(self, user_id: str | None = None, db: AsyncSession | None = None):
        self.user_id = user_id
        self.db = db

    async def embed_text(self, text: str) -> list[float]:
        """Generate embedding for a single text"""
        vectors = await aembedding(self.user_id, self.db, texts=text)
        return vectors[0]

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts"""
        return await aembedding(self.user_id, self.db, texts=texts)
