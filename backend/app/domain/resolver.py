"""Resolve the active backend domain pack."""

from __future__ import annotations

from app.config import get_settings


def get_active_domain() -> str:
    """Return normalized active domain key."""
    return (get_settings().active_domain or "energy").strip().lower()


def get_domain_prompt_path(prompt_filename: str) -> str:
    """Return domain prompt path for the active domain."""
    domain = get_active_domain()
    if domain == "energy":
        return f"app/domain/energy/prompts/{prompt_filename}"
    raise ValueError(f"Unsupported ACTIVE_DOMAIN '{domain}'")

