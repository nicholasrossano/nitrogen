"""Shared redirect URL validation for billing flows."""

from urllib.parse import urlparse

from fastapi import HTTPException, status

from app.config import get_settings


def validate_billing_redirect_url(url: str) -> str:
    """Allow redirects only to configured frontend/CORS origins."""
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid redirect URL",
        )

    origin = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    settings = get_settings()
    allowed = {settings.frontend_url.rstrip("/"), *settings.cors_origins}
    allowed = {item.rstrip("/") for item in allowed if item}

    if origin not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Redirect URL origin is not allowed",
        )
    return url
