from pydantic_settings import BaseSettings
from pydantic import field_validator, model_validator, computed_field
from functools import lru_cache
import json
from typing import Self


class Settings(BaseSettings):
    # Database (no default -- app will fail fast if DATABASE_URL is not set)
    database_url: str
    
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
    nitrogen_firebase_credentials: str = ""
    
    # App - debug defaults to True if database_url points to localhost
    debug: bool | None = None
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:3001"]
    
    @model_validator(mode='after')
    def set_debug_default(self) -> Self:
        """Auto-enable debug mode when running against localhost database"""
        if self.debug is None:
            self.debug = 'localhost' in self.database_url or '127.0.0.1' in self.database_url
        return self
    
    # OpenAlex
    openalex_email: str = ""
    openalex_base_url: str = "https://api.openalex.org"
    
    # Gold Standard template settings
    gs_cover_letter_template_url: str = "https://globalgoals.goldstandard.org/standards/T-PreReview_V2.0-Cover-Letter.docx"
    gs_preliminary_review_template_url: str = ""  # Optional: add when GS publishes direct DOCX URL
    gs_template_cache_ttl_hours: int = 24

    # PVWatts (NREL Solar Production Estimate)
    pvwatts_api_key: str = ""
    pvwatts_base_url: str = "https://developer.nrel.gov/api/pvwatts/v8.json"

    # RAG settings
    enable_corpus_rag: bool = False
    chunk_size: int = 300
    chunk_overlap: int = 75
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
