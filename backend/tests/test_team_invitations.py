"""Protect invitation generations, activation gates and durable delivery acknowledgements.

Real fixture API/SQL state is combined with simulated internal-worker receipts. Tests
ensure that private credentials stay server-side and obsolete deliveries cannot regain authority."""

import json
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.db import SessionLocal
from app.models import MailMessage, User
from app.services.mailing import cipher


def invite_agent(client, headers):
    """Create a fixture support agent through Team and return its metadata plus the server-side decrypted test
    credential for activation checks.
    """
    response = client.post(
        "/api/v1/team/users",
        headers=headers,
        json={"email": "invited-agent@example.com", "full_name": "Invited Agent", "role": "support_agent"},
    )
    assert response.status_code == 201, response.text
    agent = response.json()
    with SessionLocal() as db:
        message = db.scalar(
            select(MailMessage).where(MailMessage.user_id == agent["id"], MailMessage.template == "invitation")
        )
        password = json.loads(cipher().decrypt(message.sensitive_payload.encode()))["initial_password"]
        # Only the invitation participates in these disposable outbox tests.
        for other in db.scalars(select(MailMessage).where(MailMessage.template != "invitation")):
            other.status = "canceled"
        db.commit()
        message_id = message.id
    return agent, password, message_id


def worker_headers(monkeypatch):
    """Configure a separate test-only mail-service token so internal delivery endpoints cannot be confused with user
    JWT access.
    """
    from app.core.config import get_settings

    token = "fixture-mailer-token-at-least-32-characters"
    monkeypatch.setattr(get_settings(), "mailer_service_token", token)
    return {"X-Mailer-Token": token}


def claim(client, worker):
    """Claim the next queued fixture message through the authenticated internal worker endpoint."""
    response = client.post(
        "/api/v1/internal/mail/claim", headers=worker, json={"smtp_ready": True, "detail": "local_capture"}
    )
    assert response.status_code == 200, response.text
    return response.json()["message"]


def test_expired_invitation_cannot_be_accepted_with_an_existing_session(client, auth_headers):
    """Expire an invitation after issuing a JWT and require the existing session to lose activation authority too."""
    agent, initial, _ = invite_agent(client, auth_headers)
    login = client.post("/api/v1/auth/login", json={"email": agent["email"], "password": initial})
    session = {"Authorization": "Bearer " + login.json()["access_token"]}
    with SessionLocal() as db:
        db.get(User, agent["id"]).temporary_password_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    response = client.post(
        "/api/v1/auth/change-password",
        headers=session,
        json={"current_password": initial, "new_password": "Replacement-password-2026!"},
    )
    assert response.status_code == 403, response.text


def test_renewal_does_not_invalidate_a_password_being_sent(client, auth_headers, monkeypatch):
    """Reject credential rotation while a delivery claim is active so SMTP cannot send an already-invalid invitation."""
    agent, initial, _ = invite_agent(client, auth_headers)
    delivery = claim(client, worker_headers(monkeypatch))
    assert delivery["payload"]["initial_password"] == initial
    response = client.post(f"/api/v1/team/users/{agent['id']}/invite", headers=auth_headers)
    assert response.status_code == 409, response.text
    assert client.post("/api/v1/auth/login", json={"email": agent["email"], "password": initial}).status_code == 200


def test_delivery_acknowledgement_is_idempotent(client, auth_headers, monkeypatch):
    """Accept an identical delivery receipt replay without repeating delivery or changing the invitation generation."""
    _, _, _ = invite_agent(client, auth_headers)
    worker = worker_headers(monkeypatch)
    delivery = claim(client, worker)
    payload = {"claim_token": delivery["claim_token"], "success": True, "message_id": "accepted-fixture"}
    path = f"/api/v1/internal/mail/{delivery['id']}/result"
    assert client.post(path, headers=worker, json=payload).status_code == 200
    assert client.post(path, headers=worker, json=payload).status_code == 200
    assert client.post(path, headers=worker, json={**payload, "message_id": "different-outcome"}).status_code == 409


def test_reactivating_an_unaccepted_invitation_issues_fresh_credentials(client, auth_headers):
    """Reactivate a pending member with a new invitation rather than restoring obsolete initial credentials."""
    agent, initial, message_id = invite_agent(client, auth_headers)
    path = f"/api/v1/team/users/{agent['id']}"
    assert client.patch(path, headers=auth_headers, json={"is_active": False}).status_code == 200
    with SessionLocal() as db:
        previous = db.get(MailMessage, message_id)
        assert previous.status == "canceled" and previous.sensitive_payload is None
    assert client.patch(path, headers=auth_headers, json={"is_active": True}).status_code == 200
    assert client.post("/api/v1/auth/login", json={"email": agent["email"], "password": initial}).status_code == 401


def test_delivery_and_expiration_are_visible_without_credentials(client, auth_headers, monkeypatch):
    """Expose safe Team delivery/expiry metadata while excluding initial passwords, encrypted payloads and worker
    receipts.
    """
    agent, initial, _ = invite_agent(client, auth_headers)
    worker = worker_headers(monkeypatch)
    delivery = claim(client, worker)
    client.post(
        f"/api/v1/internal/mail/{delivery['id']}/result",
        headers=worker,
        json={"claim_token": delivery["claim_token"], "success": True},
    )
    response = client.get("/api/v1/team/users", headers=auth_headers)
    member = next(row for row in response.json() if row["id"] == agent["id"])
    assert member["invitation_state"] == "pending" and member["temporary_password_expires_at"]
    assert (
        member["invitation_delivery"]["status"] == "sent" and member["invitation_delivery"]["mode"] == "local_capture"
    )
    assert initial not in response.text and delivery["claim_token"] not in response.text
    assert "sensitive_payload" not in response.text and "credential_version" not in response.text
    with SessionLocal() as db:
        db.get(User, agent["id"]).temporary_password_expires_at = datetime.now(UTC) - timedelta(days=1)
        db.commit()
    member = next(
        row for row in client.get("/api/v1/team/users", headers=auth_headers).json() if row["id"] == agent["id"]
    )
    assert member["invitation_state"] == "expired"


def test_changing_pending_role_replaces_the_invitation(client, auth_headers):
    """Bind an unaccepted member's invitation to the current role and revoke credentials issued for the former role."""
    agent, initial, previous_id = invite_agent(client, auth_headers)
    response = client.patch(f"/api/v1/team/users/{agent['id']}", headers=auth_headers, json={"role": "tenant_admin"})
    assert response.status_code == 200
    with SessionLocal() as db:
        assert db.get(MailMessage, previous_id).status == "canceled"
        latest = db.scalar(
            select(MailMessage).where(MailMessage.user_id == agent["id"], MailMessage.status == "queued")
        )
        assert latest.payload["role"] == "tenant_admin"
        assert latest.payload["credential_version"] == db.get(User, agent["id"]).token_version
    assert client.post("/api/v1/auth/login", json={"email": agent["email"], "password": initial}).status_code == 401


def test_old_failed_invitation_cannot_be_retried_as_current(client, auth_headers):
    """Prevent retry of an obsolete failed generation after a newer invitation became authoritative."""
    from app.routers.mail import retry

    agent, _, previous_id = invite_agent(client, auth_headers)
    assert client.post(f"/api/v1/team/users/{agent['id']}/invite", headers=auth_headers).status_code == 200
    with SessionLocal() as db:
        previous = db.get(MailMessage, previous_id)
        previous.status = "failed"
        db.commit()
        with pytest.raises(HTTPException) as error:
            retry(previous_id, db, db.get(User, agent["id"]))
        assert error.value.status_code == 409


def test_invalid_encrypted_invitation_does_not_poison_the_queue(client, auth_headers, monkeypatch):
    """Fail and scrub corrupt invitation ciphertext while allowing the worker to continue with another queued
    message.
    """
    _, _, message_id = invite_agent(client, auth_headers)
    with SessionLocal() as db:
        db.get(MailMessage, message_id).sensitive_payload = "corrupt-fixture-payload"
        db.commit()
    assert claim(client, worker_headers(monkeypatch)) is None
    with SessionLocal() as db:
        item = db.get(MailMessage, message_id)
        assert item.status == "failed" and item.sensitive_payload is None
        assert item.error_code == "invitation_credentials_unavailable"


def test_lost_claim_recovery_runs_even_when_smtp_is_offline(client, auth_headers, monkeypatch):
    """Recover abandoned sending claims even when SMTP is not ready, retaining honest delivery-unknown state."""
    agent, _, message_id = invite_agent(client, auth_headers)
    worker = worker_headers(monkeypatch)
    claim(client, worker)
    with SessionLocal() as db:
        db.get(MailMessage, message_id).locked_at = datetime.now(UTC) - timedelta(minutes=10)
        db.commit()
    response = client.post(
        "/api/v1/internal/mail/claim", headers=worker, json={"smtp_ready": False, "detail": "connection_failed"}
    )
    assert response.status_code == 200 and response.json()["message"] is None
    with SessionLocal() as db:
        assert db.get(MailMessage, message_id).error_code == "delivery_unknown"
    assert client.post(f"/api/v1/team/users/{agent['id']}/invite", headers=auth_headers).status_code == 200


def test_account_without_invitation_deadline_is_not_permanently_valid(client, auth_headers):
    """Reject a pending account without an expiry deadline instead of granting unlimited initial-password access."""
    agent, initial, _ = invite_agent(client, auth_headers)
    with SessionLocal() as db:
        db.get(User, agent["id"]).temporary_password_expires_at = None
        db.commit()
    assert client.post("/api/v1/auth/login", json={"email": agent["email"], "password": initial}).status_code == 403


def test_failure_acknowledgement_replay_does_not_extend_retry_delay(client, auth_headers, monkeypatch):
    """Replay an identical failed receipt without moving its retry time or consuming another failure attempt."""
    _, _, message_id = invite_agent(client, auth_headers)
    worker = worker_headers(monkeypatch)
    delivery = claim(client, worker)
    path = f"/api/v1/internal/mail/{message_id}/result"
    payload = {"claim_token": delivery["claim_token"], "success": False, "error_code": "connection_failed"}
    assert client.post(path, headers=worker, json=payload).json()["status"] == "queued"
    with SessionLocal() as db:
        available = db.get(MailMessage, message_id).available_at
    assert client.post(path, headers=worker, json=payload).status_code == 200
    with SessionLocal() as db:
        item = db.get(MailMessage, message_id)
        assert item.attempts == 1 and item.available_at == available
    assert client.post(path, headers=worker, json={**payload, "success": True}).status_code == 409


def test_daily_quota_counts_inflight_deliveries(client, auth_headers, monkeypatch):
    """Reserve mail quota for active claims so concurrent workers cannot each consume the same daily capacity."""
    from app.core.config import get_settings
    from app.services.mailing import queue_mail

    invite_agent(client, auth_headers)
    monkeypatch.setattr(get_settings(), "mail_daily_limit", 1)
    worker = worker_headers(monkeypatch)
    delivery = claim(client, worker)
    with SessionLocal() as db:
        queue_mail(db, recipient="quota@example.com", subject="Quota fixture", template="broadcast", payload={})
        db.commit()
    paused = client.post(
        "/api/v1/internal/mail/claim", headers=worker, json={"smtp_ready": True, "detail": "local_capture"}
    )
    assert paused.json() == {"message": None, "paused": "daily_limit"}
    assert (
        client.post(
            f"/api/v1/internal/mail/{delivery['id']}/result",
            headers=worker,
            json={"claim_token": delivery["claim_token"], "success": True},
        ).status_code
        == 200
    )
    assert claim(client, worker) is None


def test_accepted_account_reactivation_keeps_its_personal_password(client, auth_headers):
    """Reactivate an accepted member without resetting their chosen password or restoring initial-account
    restrictions.
    """
    agent, initial, _ = invite_agent(client, auth_headers)
    session = client.post("/api/v1/auth/login", json={"email": agent["email"], "password": initial}).json()
    personal = "Accepted-personal-password-2026!"
    changed = client.post(
        "/api/v1/auth/change-password",
        headers={"Authorization": "Bearer " + session["access_token"]},
        json={"current_password": initial, "new_password": personal},
    )
    assert changed.status_code == 204
    path = f"/api/v1/team/users/{agent['id']}"
    assert client.patch(path, headers=auth_headers, json={"is_active": False}).status_code == 200
    assert client.patch(path, headers=auth_headers, json={"is_active": True}).status_code == 200
    assert client.post("/api/v1/auth/login", json={"email": agent["email"], "password": personal}).status_code == 200
    assert client.post(path + "/invite", headers=auth_headers).status_code == 400
