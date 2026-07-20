"""Authenticated product feedback: emailed to the maintainer, address never exposed to clients."""

from __future__ import annotations

import logging
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.auth import AuthUser, get_current_user
from app.core.database import get_db
from app.core.permissions import ensure_user_exists
from app.core.rate_limit import limiter
from app.models.subscription import Subscription
from app.models.user import User

router = APIRouter()
logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"
MAX_MESSAGE_LEN = 5000
MAX_SUBJECT_LEN = 200


class FeedbackRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=MAX_MESSAGE_LEN)
    subject: str = Field(..., min_length=1, max_length=MAX_SUBJECT_LEN)


class FeedbackResponse(BaseModel):
    ok: bool = True


def _smtp_configured(settings) -> bool:
    return bool(
        settings.smtp_host
        and settings.smtp_user
        and settings.smtp_password
        and settings.feedback_to_email
    )


def _email_configured(settings) -> bool:
    if not settings.feedback_to_email:
        return False
    return bool(settings.resend_api_key) or _smtp_configured(settings)


def _build_email_body(
    *,
    message: str,
    user: AuthUser,
    display_name: str | None,
    billing_tier: str | None,
    billing_status: str | None,
    client_host: str | None,
    user_agent: str | None,
) -> str:
    submitted_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    lines = [
        "New feedback from Nitrogen AI",
        "=" * 40,
        f"Submitted at: {submitted_at}",
        f"User ID: {user.uid}",
        f"Email: {user.email or '(none)'}",
        f"Email verified: {user.email_verified}",
        f"Display name: {display_name or '(none)'}",
        f"Billing tier: {billing_tier or '(unknown)'}",
        f"Billing status: {billing_status or '(unknown)'}",
        f"Client IP: {client_host or '(unknown)'}",
        f"User-Agent: {user_agent or '(unknown)'}",
        "=" * 40,
        "",
        message.strip(),
        "",
    ]
    return "\n".join(lines)


async def _send_via_resend(
    *,
    api_key: str,
    to_email: str,
    from_email: str,
    subject: str,
    body: str,
    reply_to: str | None,
) -> None:
    payload: dict = {
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "text": body,
    }
    if reply_to:
        payload["reply_to"] = reply_to

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                RESEND_API_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.HTTPError as exc:
        logger.error("Resend feedback request failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not send feedback right now. Please try again later.",
        ) from exc

    if response.status_code >= 400:
        logger.error(
            "Resend feedback email failed: status=%s body=%s",
            response.status_code,
            response.text[:500],
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not send feedback right now. Please try again later.",
        )


def _send_via_smtp(
    *,
    host: str,
    port: int,
    username: str,
    password: str,
    use_tls: bool,
    to_email: str,
    from_email: str,
    subject: str,
    body: str,
    reply_to: str | None,
) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content(body)

    try:
        with smtplib.SMTP(host, port, timeout=20) as smtp:
            if use_tls:
                smtp.starttls()
            smtp.login(username, password)
            smtp.send_message(msg)
    except Exception as exc:
        logger.error("SMTP feedback email failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not send feedback right now. Please try again later.",
        ) from exc


@router.post("/feedback", response_model=FeedbackResponse)
@limiter.limit("5/hour")
async def submit_feedback(
    request: Request,
    body: FeedbackRequest,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Email product feedback to the maintainer. Recipient address is server-only."""
    settings = get_settings()
    if not _email_configured(settings):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Feedback email is not configured on this server.",
        )

    message = body.message.strip()
    subject = body.subject.strip()
    if not message or not subject:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Title and message are required.",
        )

    await ensure_user_exists(db, user)
    db_user = await db.get(User, user.uid)
    sub_result = await db.execute(
        select(Subscription).where(Subscription.user_id == user.uid)
    )
    subscription = sub_result.scalar_one_or_none()

    client_host = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")

    email_body = _build_email_body(
        message=message,
        user=user,
        display_name=db_user.display_name if db_user else None,
        billing_tier=subscription.tier if subscription else None,
        billing_status=subscription.status if subscription else None,
        client_host=client_host,
        user_agent=user_agent,
    )
    reply_to = user.email

    if settings.resend_api_key:
        await _send_via_resend(
            api_key=settings.resend_api_key,
            to_email=settings.feedback_to_email,
            from_email=settings.feedback_from_email,
            subject=f"[Nitrogen AI] {subject}",
            body=email_body,
            reply_to=reply_to,
        )
    else:
        from_email = settings.feedback_from_email
        if "<" not in from_email and "@" not in from_email:
            from_email = settings.smtp_user or settings.feedback_to_email
        _send_via_smtp(
            host=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_user,
            password=settings.smtp_password,
            use_tls=settings.smtp_use_tls,
            to_email=settings.feedback_to_email,
            from_email=from_email if "@" in from_email else (settings.smtp_user or settings.feedback_to_email),
            subject=f"[Nitrogen AI] {subject}",
            body=email_body,
            reply_to=reply_to,
        )

    return FeedbackResponse()
