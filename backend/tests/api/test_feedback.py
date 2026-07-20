"""Tests for POST /api/v1/feedback email delivery."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api import feedback as feedback_api
from app.core.auth import AuthUser

submit_feedback = feedback_api.submit_feedback.__wrapped__


def _user(email: str = "user@example.com") -> AuthUser:
    return AuthUser(uid="uid-1", email=email, email_verified=True)


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/api/v1/feedback",
            "raw_path": b"/api/v1/feedback",
            "query_string": b"",
            "headers": [(b"user-agent", b"TestAgent/1.0")],
            "client": ("203.0.113.10", 12345),
            "server": ("test", 80),
        }
    )


class _FakeResponse:
    def __init__(self, status_code: int = 200, text: str = "ok"):
        self.status_code = status_code
        self.text = text


def _mock_http_client(response: _FakeResponse) -> AsyncMock:
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    return mock_client


def _fake_db(*, display_name: str | None = "Ada", tier: str = "trial", sub_status: str = "active"):
    db = AsyncMock()
    db.get = AsyncMock(return_value=SimpleNamespace(display_name=display_name))
    db.execute = AsyncMock(
        return_value=SimpleNamespace(
            scalar_one_or_none=lambda: SimpleNamespace(tier=tier, status=sub_status)
        )
    )
    return db


@pytest.mark.asyncio
async def test_submit_feedback_uses_resend_when_configured():
    settings = MagicMock(
        feedback_to_email="maintainer@example.com",
        resend_api_key="re_test",
        feedback_from_email="Nitrogen AI <onboarding@resend.dev>",
        smtp_host="",
        smtp_user="",
        smtp_password="",
    )
    mock_client = _mock_http_client(_FakeResponse(200))

    with (
        patch.object(feedback_api, "get_settings", return_value=settings),
        patch.object(feedback_api, "ensure_user_exists", new_callable=AsyncMock),
        patch.object(feedback_api.httpx, "AsyncClient", return_value=mock_client),
    ):
        result = await submit_feedback(
            request=_request(),
            body=feedback_api.FeedbackRequest(message="  Hello there  ", subject="Hello"),
            user=_user(),
            db=_fake_db(),
        )

    assert result.ok is True
    mock_client.post.assert_awaited_once()
    args, kwargs = mock_client.post.await_args
    assert args[0] == feedback_api.RESEND_API_URL
    assert kwargs["json"]["to"] == ["maintainer@example.com"]
    assert kwargs["json"]["reply_to"] == "user@example.com"
    assert kwargs["json"]["subject"] == "[Nitrogen AI] Hello"
    text = kwargs["json"]["text"]
    assert "Hello there" in text
    assert "uid-1" in text
    assert "user@example.com" in text
    assert "Ada" in text
    assert "trial" in text
    assert "203.0.113.10" in text
    assert "TestAgent/1.0" in text
    assert "maintainer@example.com" not in text


@pytest.mark.asyncio
async def test_submit_feedback_uses_smtp_when_resend_missing():
    settings = MagicMock(
        feedback_to_email="maintainer@example.com",
        resend_api_key="",
        feedback_from_email="maintainer@example.com",
        smtp_host="smtp.example.com",
        smtp_port=587,
        smtp_user="maintainer@example.com",
        smtp_password="secret",
        smtp_use_tls=True,
    )

    with (
        patch.object(feedback_api, "get_settings", return_value=settings),
        patch.object(feedback_api, "ensure_user_exists", new_callable=AsyncMock),
        patch.object(feedback_api, "_send_via_smtp") as send_smtp,
    ):
        result = await submit_feedback(
            request=_request(),
            body=feedback_api.FeedbackRequest(message="Idea", subject="Feature"),
            user=_user(),
            db=_fake_db(),
        )

    assert result.ok is True
    send_smtp.assert_called_once()
    assert send_smtp.call_args.kwargs["to_email"] == "maintainer@example.com"
    assert send_smtp.call_args.kwargs["subject"] == "[Nitrogen AI] Feature"


@pytest.mark.asyncio
async def test_submit_feedback_rejects_blank_after_strip():
    settings = MagicMock(
        feedback_to_email="maintainer@example.com",
        resend_api_key="re_test",
        smtp_host="",
        smtp_user="",
        smtp_password="",
    )
    with patch.object(feedback_api, "get_settings", return_value=settings):
        with pytest.raises(HTTPException) as exc:
            await submit_feedback(
                request=_request(),
                body=feedback_api.FeedbackRequest(message="   ", subject="Title"),
                user=_user(),
                db=_fake_db(),
            )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_submit_feedback_requires_provider():
    settings = MagicMock(
        feedback_to_email="maintainer@example.com",
        resend_api_key="",
        smtp_host="",
        smtp_user="",
        smtp_password="",
    )
    with patch.object(feedback_api, "get_settings", return_value=settings):
        with pytest.raises(HTTPException) as exc:
            await submit_feedback(
                request=_request(),
                body=feedback_api.FeedbackRequest(message="Hi", subject="Title"),
                user=_user(),
                db=_fake_db(),
            )
    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_submit_feedback_surfaces_provider_errors():
    settings = MagicMock(
        feedback_to_email="maintainer@example.com",
        resend_api_key="re_test",
        feedback_from_email="Nitrogen AI <onboarding@resend.dev>",
        smtp_host="",
        smtp_user="",
        smtp_password="",
    )
    mock_client = _mock_http_client(_FakeResponse(500, "boom"))

    with (
        patch.object(feedback_api, "get_settings", return_value=settings),
        patch.object(feedback_api, "ensure_user_exists", new_callable=AsyncMock),
        patch.object(feedback_api.httpx, "AsyncClient", return_value=mock_client),
    ):
        with pytest.raises(HTTPException) as exc:
            await submit_feedback(
                request=_request(),
                body=feedback_api.FeedbackRequest(message="Hi", subject="Title"),
                user=_user(),
                db=_fake_db(),
            )
    assert exc.value.status_code == 502
