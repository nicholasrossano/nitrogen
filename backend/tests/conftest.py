"""
Shared pytest fixtures.

Sets required env vars before any app modules are imported so that pydantic-settings
doesn't fail on missing DATABASE_URL / OPENAI_API_KEY in CI.
"""
import os

# Must be set before importing app modules
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("OPENAI_API_KEY", "test-key-not-real")
os.environ.setdefault("FIREBASE_PROJECT_ID", "test-project")
