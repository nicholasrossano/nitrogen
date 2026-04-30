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
import re  # noqa: E402
import traceback  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.core.database import engine  # noqa: E402
from app.core.log_sanitizer import sanitize_text, sanitize_exception  # noqa: E402
import app.core.initiative_activity_listeners  # noqa: F401, E402  # registers ORM hooks for project sort
from app.api import initiatives, onboarding, evidence, exports, corpus, module_catalog, chat, project_plan, lcoe, carbon, project_materials, shares, users, pvwatts, google_drive, billing, api_keys, module_workflow, workspaces, assumptions  # noqa: E402
from app.mcp import get_mcp_http_app  # noqa: E402

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()

PRODUCTION_ORIGINS = [
    "https://the-nitrogen.ai",
    "https://www.the-nitrogen.ai",
    "https://app.the-nitrogen.ai",
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

_VERCEL_PREVIEW_ORIGIN_RE = re.compile(
    r"https://nitrogen(-[a-z0-9-]+)?\.vercel\.app\Z"
)


def cors_headers_for_request(request: Request) -> dict[str, str]:
    """Mirror CORSMiddleware allowlist so error responses still expose CORS headers."""
    origin = request.headers.get("origin")
    if not origin:
        return {}
    allowed = origin in cors_origins or bool(_VERCEL_PREVIEW_ORIGIN_RE.fullmatch(origin))
    if not allowed:
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    async with engine.begin():
        pass
    # Restart-safety: pick up any evidence docs that were mid-processing when
    # the previous worker died and re-enqueue them.  Fire-and-forget — a DB
    # hiccup during reclaim must never prevent the API from serving.
    try:
        from app.services.evidence_processor import reclaim_stale_jobs

        import asyncio as _asyncio

        _asyncio.create_task(reclaim_stale_jobs())
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not schedule reclaim_stale_jobs at startup: %s", exc)
    yield
    # Shutdown
    from app.core.http_client import close_http_client
    await close_http_client()
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
    logger.error(
        "Unhandled exception on %s %s: %s",
        request.method,
        request.url.path,
        sanitize_exception(exc),
    )
    logger.error(sanitize_text(traceback.format_exc()))

    if _is_disk_full(exc):
        return JSONResponse(
            status_code=507,
            content={
                "detail": "Storage limit reached — no new files can be uploaded. Please delete unused files or upgrade your storage plan.",
                "error_type": "StorageLimitExceeded",
            },
            headers=cors_headers_for_request(request),
        )

    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
        headers=cors_headers_for_request(request),
    )


# Include routers
app.include_router(initiatives.router, prefix="/api/v1", tags=["initiatives"])
app.include_router(workspaces.router, prefix="/api/v1", tags=["workspaces"])
app.include_router(onboarding.router, prefix="/api/v1", tags=["onboarding"])
app.include_router(evidence.router, prefix="/api/v1", tags=["evidence"])
app.include_router(exports.router, prefix="/api/v1", tags=["exports"])
app.include_router(corpus.router, prefix="/api/v1", tags=["corpus"])
app.include_router(module_catalog.router, prefix="/api/v1", tags=["modules"])
app.include_router(module_workflow.router, prefix="/api/v1", tags=["module-workflow"])
app.include_router(assumptions.router, prefix="/api/v1", tags=["assumptions"])
app.include_router(chat.router, prefix="/api/v1", tags=["chat"])
app.include_router(project_plan.router, prefix="/api/v1", tags=["project-plan"])
app.include_router(lcoe.router, prefix="/api/v1", tags=["lcoe"])
app.include_router(carbon.router, prefix="/api/v1", tags=["carbon"])
app.include_router(project_materials.router, prefix="/api/v1", tags=["project-materials"])
app.include_router(shares.router, prefix="/api/v1", tags=["shares"])
app.include_router(users.router, prefix="/api/v1", tags=["users"])
app.include_router(pvwatts.router, prefix="/api/v1", tags=["pvwatts"])
app.include_router(google_drive.router, prefix="/api/v1", tags=["google-drive"])
app.include_router(billing.router, prefix="/api/v1", tags=["billing"])
app.include_router(api_keys.router, prefix="/api/v1", tags=["api-keys"])
app.mount("/mcp", get_mcp_http_app())


@app.get("/")
async def root():
    return {"message": "Nitrogen API", "version": "0.1.0"}


@app.get("/health")
async def health():
    return {"status": "healthy"}



