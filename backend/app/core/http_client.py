"""Shared httpx.AsyncClient for outbound HTTP requests.

Re-uses connections across requests instead of creating a new client per call.
"""
import httpx

_client: httpx.AsyncClient | None = None


def get_http_client() -> httpx.AsyncClient:
    """Return a assessment-level shared AsyncClient (lazy-initialised)."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=30.0)
    return _client


async def close_http_client() -> None:
    """Close the shared client (call during app shutdown)."""
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
        _client = None
