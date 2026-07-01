from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional
import os
import json
import logging

from app.config import get_settings
from app.core.log_sanitizer import sanitize_exception

security = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)

# Initialize Firebase Admin SDK if configured
_firebase_initialized = False


def _init_firebase():
    global _firebase_initialized
    if _firebase_initialized:
        return True

    settings = get_settings()
    if not settings.firebase_project_id:
        return False

    try:
        import firebase_admin
        from firebase_admin import credentials

        # Check if already initialized
        try:
            firebase_admin.get_app()
            _firebase_initialized = True
            return True
        except ValueError:
            pass

        cred = None

        # Option 1: Service account JSON content as env var (for Railway/cloud)
        firebase_sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "")
        if firebase_sa_json:
            try:
                sa_dict = json.loads(firebase_sa_json)
                cred = credentials.Certificate(sa_dict)
                logger.info("Using Firebase credentials from FIREBASE_SERVICE_ACCOUNT_JSON env var")
            except json.JSONDecodeError as e:
                logger.warning(
                    "Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON: %s",
                    sanitize_exception(e),
                )

        # Option 2: Service account file path (for local dev)
        if (
            not cred
            and settings.nitrogen_firebase_credentials
            and os.path.exists(settings.nitrogen_firebase_credentials)
        ):
            cred = credentials.Certificate(settings.nitrogen_firebase_credentials)
            logger.info("Using Firebase credentials from file")

        # Option 3: Project ID only (works on GCP with default credentials)
        if cred:
            firebase_admin.initialize_app(cred)
        else:
            firebase_admin.initialize_app(options={"projectId": settings.firebase_project_id})
            logger.info("Using Firebase with project ID only (no service account)")

        _firebase_initialized = True
        logger.info("Firebase Admin SDK initialized successfully")
        return True
    except Exception as e:
        logger.warning("Failed to initialize Firebase Admin SDK: %s", sanitize_exception(e))
        return False


class AuthUser:
    """Authenticated user from Firebase."""

    def __init__(
        self,
        uid: str,
        email: str | None = None,
        *,
        email_verified: bool = True,
    ):
        self.uid = uid
        self.email = email
        self.email_verified = email_verified


def _require_firebase_configured() -> None:
    settings = get_settings()
    if not settings.firebase_project_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication not configured. Set FIREBASE_PROJECT_ID in .env.",
        )


async def authenticate_bearer_token(token: str) -> AuthUser:
    """Validate a Firebase bearer token and return the authenticated user."""
    _require_firebase_configured()

    if not _init_firebase():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service unavailable",
        )

    try:
        from firebase_admin import auth

        decoded_token = auth.verify_id_token(token)
        return AuthUser(
            uid=decoded_token["uid"],
            email=decoded_token.get("email"),
            email_verified=bool(decoded_token.get("email_verified", False)),
        )
    except Exception as e:
        logger.warning("Token verification failed: %s", sanitize_exception(e))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> AuthUser:
    """Get current user from Firebase ID token."""
    _require_firebase_configured()

    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return await authenticate_bearer_token(credentials.credentials)


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[AuthUser]:
    """Get current user if authenticated, otherwise None."""
    if not credentials:
        return None
    try:
        return await get_current_user(credentials)
    except HTTPException:
        return None


# Backwards compatibility alias
MockUser = AuthUser
