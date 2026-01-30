from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.config import get_settings
from app.core.database import engine, Base
from app.api import initiatives, chat, evidence, generate, exports, corpus, tools


settings = get_settings()


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

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
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
