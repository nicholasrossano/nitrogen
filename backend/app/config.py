from pydantic_settings import BaseSettings
from pydantic import field_validator, model_validator, computed_field
from functools import lru_cache
import json
from typing import Self


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/nitrogen"
    
    # OpenAI - Model separation for cost/capability optimization
    openai_api_key: str = ""
    # Orchestration model: Used for deciding actions, understanding intent (smart, fast)
    openai_orchestration_model: str = "gpt-4o"
    # Generation model: Used for content creation, memos, checklists (cheaper for bulk)
    openai_generation_model: str = "gpt-4o-mini"
    # Embedding model for RAG
    openai_embedding_model: str = "text-embedding-ada-002"
    
    # Legacy alias - maps to generation model for backward compatibility
    @computed_field
    @property
    def openai_model(self) -> str:
        return self.openai_generation_model
    
    # Storage
    storage_type: str = "local"  # local | gcs
    exports_dir: str = "./exports"
    uploads_dir: str = "./uploads"
    gcs_bucket: str = ""
    
    # Firebase (optional)
    firebase_project_id: str = ""
    google_application_credentials: str = ""
    
    # App - debug defaults to True if database_url points to localhost
    debug: bool | None = None
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:3001"]
    
    @model_validator(mode='after')
    def set_debug_default(self) -> Self:
        """Auto-enable debug mode when running against localhost database"""
        if self.debug is None:
            self.debug = 'localhost' in self.database_url or '127.0.0.1' in self.database_url
        return self
    
    # RAG settings
    chunk_size: int = 500
    chunk_overlap: int = 50
    retrieval_top_k: int = 5
    
    @field_validator('cors_origins', mode='before')
    @classmethod
    def parse_cors_origins(cls, v):
        """Parse CORS_ORIGINS from JSON string or return as-is if already a list"""
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                if isinstance(parsed, list):
                    return parsed
            except json.JSONDecodeError:
                # Try comma-separated fallback
                return [origin.strip() for origin in v.split(',') if origin.strip()]
        return v
    
    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
