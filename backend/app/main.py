from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
import os
import json

from app.config import get_settings
from app.core.database import engine, Base
from app.api import initiatives, chat, evidence, generate, exports, corpus, tools

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()

# Parse CORS origins directly from env var to avoid pydantic issues
def get_cors_origins():
    cors_env = os.environ.get('CORS_ORIGINS', '')
    if cors_env:
        try:
            parsed = json.loads(cors_env)
            if isinstance(parsed, list):
                logger.info(f"CORS origins from env: {parsed}")
                return parsed
        except json.JSONDecodeError:
            # Try comma-separated
            origins = [o.strip() for o in cors_env.split(',') if o.strip()]
            logger.info(f"CORS origins (comma-sep): {origins}")
            return origins
    # Fallback to settings
    logger.info(f"CORS origins from settings: {settings.cors_origins}")
    return settings.cors_origins

cors_origins = get_cors_origins()
# TEMPORARY: Add wildcard to debug CORS issues
cors_origins = ["*"]
logger.info(f"Final CORS origins (using wildcard for debug): {cors_origins}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    async with engine.begin() as conn:
        # Tables are managed by Alembic, but this ensures connection works
        pass
    yield
    # Shutdown
    await engine.dispose()


app = FastAPI(
    title="Nitrogen API",
    description="Chat-first decision packet studio",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS - use directly parsed origins
# Note: allow_credentials must be False when using wildcard "*"
use_credentials = cors_origins != ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=use_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(initiatives.router, prefix="/api/v1", tags=["initiatives"])
app.include_router(chat.router, prefix="/api/v1", tags=["chat"])
app.include_router(evidence.router, prefix="/api/v1", tags=["evidence"])
app.include_router(generate.router, prefix="/api/v1", tags=["generate"])
app.include_router(exports.router, prefix="/api/v1", tags=["exports"])
app.include_router(corpus.router, prefix="/api/v1", tags=["corpus"])
app.include_router(tools.router, prefix="/api/v1", tags=["tools"])


@app.get("/")
async def root():
    return {"message": "Nitrogen API", "version": "0.1.0"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/debug/cors")
async def debug_cors():
    """Debug endpoint to check CORS configuration"""
    return {
        "cors_origins_env": os.environ.get('CORS_ORIGINS', 'NOT SET'),
        "cors_origins_used": cors_origins,
        "cors_origins_type": str(type(cors_origins)),
    }
