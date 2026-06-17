import base64
import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

import httpx

from app.config import get_settings

settings = get_settings()

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "openid",
    "email",
]


def build_auth_url(state: str) -> str:
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",  # always request refresh token
        "state": state,
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


async def exchange_code(code: str) -> dict:
    """Exchange authorization code for access + refresh tokens."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        resp.raise_for_status()
        return resp.json()


async def refresh_access_token(refresh_token: str) -> dict:
    """Use a refresh token to obtain a new access token."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
        resp.raise_for_status()
        return resp.json()


async def get_google_email(access_token: str) -> str | None:
    """Fetch the Google account email for an access token."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code == 200:
            return resp.json().get("email")
    return None


async def revoke_token(token: str) -> None:
    """Best-effort revoke an access or refresh token."""
    async with httpx.AsyncClient() as client:
        await client.post(GOOGLE_REVOKE_URL, params={"token": token})


def create_oauth_state(user_id: str, project_id: str) -> str:
    """Create a signed, time-limited CSRF state token."""
    payload = json.dumps({"uid": user_id, "pid": project_id, "t": int(time.time())})
    sig = hmac.new(
        settings.google_client_secret.encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()[:20]
    raw = f"{payload}|{sig}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def verify_oauth_state(state: str) -> tuple[str, str]:
    """Verify and decode a state token. Returns (user_id, project_id)."""
    try:
        decoded = base64.urlsafe_b64decode(state.encode()).decode()
        payload_str, sig = decoded.rsplit("|", 1)
        expected = hmac.new(
            settings.google_client_secret.encode(),
            payload_str.encode(),
            hashlib.sha256,
        ).hexdigest()[:20]
        if not hmac.compare_digest(sig, expected):
            raise ValueError("Invalid signature")
        payload = json.loads(payload_str)
        if time.time() - payload["t"] > 600:
            raise ValueError("State expired (10-minute window)")
        return payload["uid"], payload.get("pid") or payload.get("iid")
    except (KeyError, ValueError) as e:
        raise ValueError(f"Invalid or expired state: {e}")
