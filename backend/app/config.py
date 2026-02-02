from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/nitrogen"
    
    # OpenAI
    openai_api_key: str = ""
    openai_model: str = "gpt-4-turbo-preview"
    openai_embedding_model: str = "text-embedding-ada-002"
    
    # Storage
    storage_type: str = "local"  # local | gcs
    exports_dir: str = "./exports"
    uploads_dir: str = "./uploads"
    gcs_bucket: str = ""
    
    # Firebase (optional)
    firebase_project_id: str = ""
    google_application_credentials: str = ""
    
    # App
    debug: bool = False
    cors_origins: list[str] = ["http://localhost:3000"]
    
    # RAG settings
    chunk_size: int = 500
    chunk_overlap: int = 50
    retrieval_top_k: int = 5
    
    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
