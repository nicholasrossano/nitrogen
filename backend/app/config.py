from pydantic_settings import BaseSettings
from pydantic import field_validator, model_validator, computed_field
from functools import lru_cache
import json
from typing import Self


class Settings(BaseSettings):
    # Active domain pack (workspace-level deployment toggle)
    active_domain: str = "energy"

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
    storage_type: str = "local"  # local | firebase
    exports_dir: str = "./exports"
    uploads_dir: str = "./uploads"
    gcs_bucket: str = ""

    # Firebase (used for auth and Storage)
    firebase_project_id: str = ""
    nitrogen_firebase_credentials: str = ""
    firebase_storage_bucket: str = ""  # e.g. nitrogen-ai.firebasestorage.app
    
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

    # World Bank public APIs
    worldbank_api_base: str = "https://api.worldbank.org/v2"
    worldbank_search_base: str = "https://search.worldbank.org/api/v2"

    # IATI Datastore v3
    iati_api_key: str = ""
    
    # PVWatts (NREL Solar Production Estimate)
    pvwatts_api_key: str = ""
    pvwatts_base_url: str = "https://developer.nlr.gov/api/pvwatts/v8.json"

    # RAG settings
    enable_corpus_rag: bool = False
    chunk_size: int = 300
    chunk_overlap: int = 75
    retrieval_top_k: int = 5

    # Google Drive OAuth
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/v1/google/callback"
    frontend_url: str = "http://localhost:3000"

    # Stripe billing
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_id: str = ""
    # Deprecated — kept for existing Stripe price / subscription rows
    stripe_starter_price_id: str = ""
    stripe_pro_price_id: str = ""
    billing_testing_mode: bool = False

    # Free trial limits
    trial_message_limit: int = 10
    trial_cost_limit_usd: float = 1.0

    # Access code — upgrades trial to subscription-equivalent budget (one-time)
    access_code: str = ""

    # Usage limits (estimated API cost in USD per billing period)
    subscription_usage_limit_usd: float = 20.0
    # Deprecated aliases
    starter_usage_limit_usd: float = 14.0
    pro_usage_limit_usd: float = 42.0

    # OpenRouter (platform LLM routing — required for non-BYOK users)
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"

    # Encryption key for BYOK API keys at rest (Fernet key)
    api_key_encryption_key: str = ""

    @computed_field
    @property
    def billing_enabled(self) -> bool:
        return bool(self.stripe_secret_key)
    
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
