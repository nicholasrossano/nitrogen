from pathlib import Path

from dotenv import load_dotenv
# Load .env before any config reads (backend/.env when run from backend/)
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import logging
import os
import json
import traceback

from app.config import get_settings
from app.core.database import engine, Base
from app.api import initiatives, chat, evidence, generate, exports, corpus, tools, core_chat, project_plan, lcoe, carbon, gs_certification, project_materials, template, shares, users, compliance_precheck, pdd

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()

PRODUCTION_ORIGINS = [
    "https://the-nitrogen.ai",
    "https://www.the-nitrogen.ai",
]

# CORS origins: prefer settings (loaded from .env by pydantic) since os.environ
# may not have CORS_ORIGINS when pydantic-settings loads .env for its own use
def get_cors_origins():
    base_origins: list[str] = []
    cors_env = os.environ.get('CORS_ORIGINS', '')
    if cors_env:
        try:
            parsed = json.loads(cors_env)
            if isinstance(parsed, list) and parsed:
                logger.info(f"CORS origins from env: {parsed}")
                base_origins = parsed
        except json.JSONDecodeError:
            origins = [o.strip() for o in cors_env.split(',') if o.strip()]
            if origins:
                logger.info(f"CORS origins (comma-sep): {origins}")
                base_origins = origins
    if not base_origins:
        base_origins = settings.cors_origins or ["http://localhost:3000", "http://localhost:3001"]
        logger.info(f"CORS origins from settings: {base_origins}")
    merged = list(dict.fromkeys(base_origins + PRODUCTION_ORIGINS))
    return merged

cors_origins = get_cors_origins()
logger.info(f"Final CORS origins: {cors_origins}")


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

# CORS - use directly parsed origins + allow all Vercel deployments
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=r"https://.*\.vercel\.app|http://localhost:\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Return CORS-safe JSON on unhandled errors so the browser doesn't hide them."""
    logger.error(f"Unhandled exception on {request.method} {request.url.path}: {exc}")
    logger.error(traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error_type": type(exc).__name__},
    )


# Include routers
app.include_router(initiatives.router, prefix="/api/v1", tags=["initiatives"])
app.include_router(chat.router, prefix="/api/v1", tags=["chat"])
app.include_router(evidence.router, prefix="/api/v1", tags=["evidence"])
app.include_router(generate.router, prefix="/api/v1", tags=["generate"])
app.include_router(exports.router, prefix="/api/v1", tags=["exports"])
app.include_router(corpus.router, prefix="/api/v1", tags=["corpus"])
app.include_router(tools.router, prefix="/api/v1", tags=["tools"])
app.include_router(core_chat.router, prefix="/api/v1", tags=["core-chat"])
app.include_router(project_plan.router, prefix="/api/v1", tags=["project-plan"])
app.include_router(lcoe.router, prefix="/api/v1", tags=["lcoe"])
app.include_router(carbon.router, prefix="/api/v1", tags=["carbon"])
app.include_router(gs_certification.router, prefix="/api/v1", tags=["gs-certification"])
app.include_router(project_materials.router, prefix="/api/v1", tags=["project-materials"])
app.include_router(template.router, prefix="/api/v1", tags=["template"])
app.include_router(shares.router, prefix="/api/v1", tags=["shares"])
app.include_router(users.router, prefix="/api/v1", tags=["users"])
app.include_router(compliance_precheck.router, prefix="/api/v1", tags=["compliance-precheck"])
app.include_router(pdd.router, prefix="/api/v1", tags=["pdd"])


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


@app.get("/debug/config")
async def debug_config():
    """Debug endpoint to check application configuration"""
    return {
        "storage_type": settings.storage_type,
        "exports_dir": settings.exports_dir,
        "uploads_dir": settings.uploads_dir,
        "exports_dir_exists": os.path.exists(settings.exports_dir),
        "uploads_dir_exists": os.path.exists(settings.uploads_dir),
        "debug_mode": settings.debug,
        "database_host": "***" if settings.database_url else None,  # Don't expose full URL
        "openai_configured": bool(settings.openai_api_key),
        "firebase_configured": bool(settings.firebase_project_id),
    }


@app.get("/debug/test-export/{initiative_id}")
async def debug_test_export(initiative_id: str):
    """Debug endpoint to test export without auth - REMOVE IN PRODUCTION"""
    from sqlalchemy import select
    from app.core.database import get_db
    from app.models.initiative import Initiative
    from app.models.memo import MemoVersion
    from uuid import UUID
    
    try:
        initiative_uuid = UUID(initiative_id)
    except ValueError:
        return {"error": "Invalid initiative ID format"}
    
    db_gen = get_db()
    db = await anext(db_gen)
    
    try:
        # Check initiative exists
        result = await db.execute(
            select(Initiative).where(Initiative.id == initiative_uuid)
        )
        initiative = result.scalar_one_or_none()
        
        if not initiative:
            return {"error": "Initiative not found", "initiative_id": initiative_id}
        
        # Check memo exists
        memo_result = await db.execute(
            select(MemoVersion)
            .where(MemoVersion.initiative_id == initiative_uuid)
            .order_by(MemoVersion.created_at.desc())
            .limit(1)
        )
        memo = memo_result.scalar_one_or_none()
        
        if not memo:
            return {
                "error": "No memo found for this initiative",
                "initiative_id": initiative_id,
                "initiative_user_id": str(initiative.user_id),
                "initiative_title": initiative.title,
            }
        
        # Check memo content structure
        return {
            "initiative_found": True,
            "initiative_id": str(initiative.id),
            "initiative_user_id": str(initiative.user_id),
            "initiative_title": initiative.title,
            "memo_found": True,
            "memo_id": str(memo.id),
            "memo_content_keys": list(memo.content.keys()) if memo.content else [],
            "memo_has_citations": "citations" in (memo.content or {}),
            "export_path": memo.export_path,
        }
    except Exception as e:
        return {"error": str(e), "error_type": type(e).__name__}
    finally:
        await db.close()
