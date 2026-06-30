import pytest

from app.api import billing as billing_api


@pytest.mark.asyncio
async def test_billing_webhook_missing_stripe_signature_returns_400(
    api_client,
    override_db,
):
    override_db()

    response = await api_client.post("/api/v1/billing/webhook", content=b"{}")

    assert response.status_code == 400
    assert response.json()["detail"] == "Missing stripe-signature header"


@pytest.mark.asyncio
async def test_billing_webhook_success(
    api_client,
    override_db,
    monkeypatch: pytest.MonkeyPatch,
):
    fake_db = override_db()
    calls: list[tuple[bytes, str, object]] = []

    async def fake_handle_webhook_event(payload, sig_header, db):
        calls.append((payload, sig_header, db))

    monkeypatch.setattr(billing_api, "handle_webhook_event", fake_handle_webhook_event)

    response = await api_client.post(
        "/api/v1/billing/webhook",
        content=b'{"type":"checkout.session.completed"}',
        headers={"stripe-signature": "sig_test_123"},
    )

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert len(calls) == 1
    assert calls[0][0] == b'{"type":"checkout.session.completed"}'
    assert calls[0][1] == "sig_test_123"
    assert calls[0][2] is fake_db
