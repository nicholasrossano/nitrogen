from pathlib import Path

from dotenv import load_dotenv
# Load .env before any config reads (backend/.env when run from backend/)
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from contextlib import asynccontextmanager  # noqa: E402
import logging  # noqa: E402
import os  # noqa: E402
import json  # noqa: E402
import traceback  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.core.database import engine  # noqa: E402
from app.api import initiatives, chat, evidence, generate, exports, corpus, tools, core_chat, project_plan, lcoe, carbon, gs_certification, project_materials, template, shares, users, compliance_precheck, pdd, pvwatts  # noqa: E402

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
    async with engine.begin():
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

# Rate limiting
from app.core.rate_limit import limiter  # noqa: E402
from slowapi.errors import RateLimitExceeded  # noqa: E402
from slowapi import _rate_limit_exceeded_handler as rate_limit_handler  # noqa: E402

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_handler)

# CORS — only allow known origins + Nitrogen Vercel preview deploys
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=r"https://nitrogen(-[a-z0-9-]+)?\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_DISK_FULL_NAMES = {"DiskFullError", "DiskFull"}


def _is_disk_full(exc: Exception) -> bool:
    """True when the exception (or any cause) is a database out-of-space error."""
    seen: set[int] = set()
    current: Exception | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        name = type(current).__name__
        msg = str(current).lower()
        if name in _DISK_FULL_NAMES or "project size limit" in msg or "disk full" in msg:
            return True
        current = current.__cause__ or current.__context__
    return False


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Return CORS-safe JSON on unhandled errors so the browser doesn't hide them."""
    logger.error(f"Unhandled exception on {request.method} {request.url.path}: {exc}")
    logger.error(traceback.format_exc())

    if _is_disk_full(exc):
        return JSONResponse(
            status_code=507,
            content={
                "detail": "Storage limit reached — no new files can be uploaded. Please delete unused files or upgrade your storage plan.",
                "error_type": "StorageLimitExceeded",
            },
        )

    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
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
app.include_router(pvwatts.router, prefix="/api/v1", tags=["pvwatts"])


@app.get("/")
async def root():
    return {"message": "Nitrogen API", "version": "0.1.0"}


@app.get("/health")
async def health():
    return {"status": "healthy"}



