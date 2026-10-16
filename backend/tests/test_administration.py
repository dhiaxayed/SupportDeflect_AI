"""Exercise platform administration, ledger and encrypted-mail contracts through the API.

Fixtures create distinct platform, tenant and internal-worker identities. All business
records are synthetic, SQL assertions inspect the disposable DB, and SMTP delivery
results are simulated here; actual SMTP belongs to the browser/mailer integration."""

import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import event, func, select

from app.core.config import get_settings
from app.core.datetime import as_utc
from app.db import SessionLocal
from app.models import (
    AuditEvent,
    BillingEntry,
    ConversationLog,
    Document,
    IngestionJob,
    MailMessage,
    Organization,
    User,
)
from app.security import create_access_token
from app.services.billing import list_payments
from app.services.mailing import cipher
from scripts.create_super_admin import create_super_admin
from tests.conftest import register_org


@pytest.fixture
def platform(client):
    """Create a synthetic super administrator without tenant membership and return its real signed API authorization
    header.
    """
    with SessionLocal() as db:
        create_super_admin(db, "platform@example.com", "platform-password-123", "Platform")
        user = db.scalar(select(User).where(User.email == "platform@example.com"))
        return {"Authorization": f"Bearer {create_access_token(user.id)}"}


@pytest.fixture
def worker(monkeypatch):
    """Configure a test-only internal mail-service token and return its header independently of user JWT
    authentication.
    """
    token = "test-mail-worker-secret-more-than-32-characters"
    monkeypatch.setattr(get_settings(), "mailer_service_token", token)
    return {"X-Mailer-Token": token}


def create_org(client, platform, email="owner@example.com"):
    """Create a paid fixture organization through platform administration and return its metadata after checking HTTP
    success.
    """
    result = client.post(
        "/api/v1/platform/organizations",
        headers=platform,
        json={
            "name": "Customer One",
            "admin_email": email,
            "admin_name": "Owner",
            "subscription_plan": "pro",
            "monthly_fee_minor": 12000,
            "billing_currency": "EUR",
        },
    )
    assert result.status_code == 201, result.text
    return result.json()


def test_organization_lifecycle_and_period_controls(client, platform):
    """Verify period adjustment, expiry, archive/restore, widget denial and matching actor-scoped audit records as one
    API lifecycle.
    """
    tenant, account = register_org(client, "Customer", "owner@example.com")
    org_id = account["user"]["organization"]["id"]
    base = "/api/v1/platform/organizations/" + org_id
    expired = (datetime.now(UTC) - timedelta(days=2)).isoformat()
    result = client.patch(
        base,
        headers=platform,
        json={
            "name": "Renamed",
            "subscription_plan": "pro",
            "subscription_status": "active",
            "subscription_ends_at": expired,
            "monthly_fee_minor": 15000,
        },
    )
    assert result.status_code == 200, result.text
    assert client.post("/api/v1/chat", headers=tenant, json={"question": "Support question"}).status_code == 402
    assert client.get("/api/v1/platform/organizations?due=expired", headers=platform).json()["total"] == 1
    extended = client.post(base + "/period", headers=platform, json={"days": 30, "reason": "Retention credit"})
    assert extended.status_code == 200, extended.text
    assert as_utc(
        datetime.fromisoformat(extended.json()["subscription_ends_at"].replace("Z", "+00:00"))
    ) > datetime.now(UTC) + timedelta(days=29)
    assert client.post("/api/v1/chat", headers=tenant, json={"question": "Support question"}).status_code == 200
    assert (
        client.post(base + "/period", headers=platform, json={"days": -40, "reason": "Period correction"}).status_code
        == 200
    )
    assert client.post("/api/v1/chat", headers=tenant, json={"question": "Support question"}).status_code == 402
    assert client.request("DELETE", base, headers=platform, json={"confirm_name": "wrong"}).status_code == 400
    assert client.request("DELETE", base, headers=platform, json={"confirm_name": "Renamed"}).status_code == 200
    assert client.get("/api/v1/auth/me", headers=tenant).status_code == 403
    company = account["user"]["organization"]["public_id"]
    assert (
        client.post(
            f"/api/v1/widget/{company}/chat",
            headers={"Origin": "https://customer.example"},
            json={"question": "Support question", "visitor_id": "visitor_one"},
        ).status_code
        == 403
    )
    assert client.get("/api/v1/platform/organizations", headers=platform).json()["total"] == 0
    assert client.get("/api/v1/platform/organizations?archived=true", headers=platform).json()["total"] == 1
    assert client.post(base + "/restore", headers=platform).status_code == 200
    assert client.get("/api/v1/auth/me", headers=tenant).status_code == 200
    audit = client.get("/api/v1/platform/audit-events?org_id=" + org_id, headers=platform).json()
    assert {e["action"] for e in audit} >= {
        "organization.archived",
        "organization.restored",
        "subscription.period_adjusted",
    }
    assert all(e["actor_email"] == "platform@example.com" for e in audit)


def test_invitation_password_gate_encryption_delivery_and_revocation(client, platform, worker):
    """Trace encrypted invitation credentials through worker delivery, mandatory password replacement and revocation
    without public secret disclosure.
    """
    org = create_org(client, platform)
    with SessionLocal() as db:
        invite = db.scalar(select(MailMessage).where(MailMessage.template == "invitation"))
        password = json.loads(cipher().decrypt(invite.sensitive_payload.encode()))["initial_password"]
        assert password not in json.dumps(invite.payload)
        assert password not in invite.sensitive_payload
        assert invite.recipient == "owner@example.com"
    login = client.post("/api/v1/auth/login", json={"email": "owner@example.com", "password": password})
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert login.json()["user"]["must_change_password"]
    denied = client.get("/api/v1/documents", headers=headers)
    assert denied.status_code == 403 and denied.json()["detail"]["code"] == "password_change_required"
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
    assert (
        client.post(
            "/api/v1/internal/mail/claim", headers=platform, json={"smtp_ready": True, "detail": "ready"}
        ).status_code
        == 401
    )
    delivery = client.post(
        "/api/v1/internal/mail/claim", headers=worker, json={"smtp_ready": True, "detail": "ready"}
    ).json()["message"]
    assert delivery["payload"]["initial_password"] == password
    assert (
        client.post(
            f"/api/v1/internal/mail/{delivery['id']}/result",
            headers=worker,
            json={"claim_token": "wrong", "success": True},
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/v1/internal/mail/{delivery['id']}/result",
            headers=worker,
            json={"claim_token": delivery["claim_token"], "success": True, "message_id": "test-message"},
        ).status_code
        == 200
    )
    with SessionLocal() as db:
        assert db.get(MailMessage, delivery["id"]).sensitive_payload is None
    result = client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={"current_password": password, "new_password": "my-private-new-password"},
    )
    assert result.status_code == 204
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401
    updated = client.post(
        "/api/v1/auth/login", json={"email": "owner@example.com", "password": "my-private-new-password"}
    ).json()
    assert not updated["user"]["must_change_password"]
    assert (
        client.get("/api/v1/documents", headers={"Authorization": f"Bearer {updated['access_token']}"}).status_code
        == 200
    )
    messages = client.get("/api/v1/platform/mail/messages", headers=platform).text
    assert password not in messages and "sensitive_payload" not in messages
    assert (
        client.get("/api/v1/platform/organizations/" + org["id"], headers=platform).json()["administrators"][0]["email"]
        == "owner@example.com"
    )


def test_payments_refunds_idempotency_and_currency_reporting(client, platform):
    """Check append-only payments/refunds, replay/conflict rules, remaining refund balance and currency-specific
    reports.
    """
    org = create_org(client, platform)
    payload = {
        "org_id": org["id"],
        "amount_minor": 25000,
        "currency": "EUR",
        "occurred_at": datetime.now(UTC).isoformat(),
        "reference": "=FORMULA()",
        "idempotency_key": str(uuid4()),
    }
    response = client.post("/api/v1/platform/billing/payments", headers=platform, json=payload)
    assert response.status_code == 201, response.text
    payment_id = response.json()["id"]
    assert client.post("/api/v1/platform/billing/payments", headers=platform, json=payload).json()["id"] == payment_id
    assert (
        client.post(
            "/api/v1/platform/billing/payments", headers=platform, json={**payload, "amount_minor": 30000}
        ).status_code
        == 409
    )
    refund_payload = {"amount_minor": 5000, "note": "Partial refund", "idempotency_key": str(uuid4())}
    path = f"/api/v1/platform/billing/payments/{payment_id}/refund"
    refund = client.post(path, headers=platform, json=refund_payload)
    assert refund.status_code == 201, refund.text
    assert client.post(path, headers=platform, json=refund_payload).json()["id"] == refund.json()["id"]
    assert (
        client.post(
            path, headers=platform, json={**refund_payload, "amount_minor": 21000, "idempotency_key": str(uuid4())}
        ).status_code
        == 409
    )
    assert (
        client.post(
            "/api/v1/platform/billing/payments",
            headers=platform,
            json={**payload, "currency": "TND", "idempotency_key": str(uuid4())},
        ).status_code
        == 201
    )
    future = {
        **payload,
        "occurred_at": (datetime.now(UTC) + timedelta(days=2)).isoformat(),
        "idempotency_key": str(uuid4()),
    }
    assert client.post("/api/v1/platform/billing/payments", headers=platform, json=future).status_code == 422
    report = client.get("/api/v1/platform/business?currency=EUR", headers=platform)
    assert report.status_code == 200, report.text
    data = report.json()
    assert data["metrics"]["revenue_minor"]["value"] == 20000
    assert data["mrr_minor"] == 12000 and data["arr_minor"] == 144000
    assert sum(row["revenue_minor"] for row in data["series"]) == 20000
    assert (
        client.get("/api/v1/platform/business?currency=TND", headers=platform).json()["metrics"]["revenue_minor"][
            "value"
        ]
        == 25000
    )
    exported = client.get("/api/v1/platform/billing/export", headers=platform)
    assert exported.status_code == 200 and "'=FORMULA()" in exported.text
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(BillingEntry)) == 3


def test_business_time_windows_all_rows_and_channel_filter(client, platform):
    """Require dashboard aggregates to honor time/channel filters over all stored rows rather than only a display
    page.
    """
    _, account = register_org(client, "Active", "active@example.com")
    org_id = account["user"]["organization"]["id"]
    with SessionLocal() as db:
        for i in range(35):
            db.add(
                ConversationLog(
                    org_id=org_id,
                    channel="widget",
                    question="Question",
                    answer="Answer",
                    resolved=i < 20,
                    needs_human=i >= 20,
                    created_at=datetime.now(UTC) - timedelta(days=1),
                )
            )
        for _ in range(5):
            db.add(
                ConversationLog(
                    org_id=org_id,
                    channel="widget",
                    question="Old",
                    answer="Old",
                    created_at=datetime.now(UTC) - timedelta(days=40),
                )
            )
        db.add(ConversationLog(org_id=org_id, channel="admin", question="Playground", answer="Answer"))
        db.commit()
    data = client.get("/api/v1/platform/business?days=30", headers=platform).json()
    assert data["metrics"]["questions"]["value"] == 35
    assert data["metrics"]["questions"]["previous"] == 5
    assert data["metrics"]["questions"]["delta_percent"] == 600
    assert sum(day["questions"] for day in data["series"]) == 35
    assert data["metrics"]["resolved"]["value"] == 20
    assert (
        client.get("/api/v1/platform/business?channel=all", headers=platform).json()["metrics"]["questions"]["value"]
        == 36
    )


def test_mail_audience_confirmation_deduplication_and_automations(client, platform, worker):
    """Verify recipient preview/confirmation, campaign deduplication and automation controls before any worker sends
    mail.
    """
    _, account = register_org(client, "One", "one@example.com")
    org_id = account["user"]["organization"]["id"]
    campaign = {"all_organizations": True, "subject": "Service update", "message": "A useful service announcement."}
    preview = client.post("/api/v1/platform/mail/preview", headers=platform, json=campaign).json()
    assert preview["recipient_count"] == 1
    payload = {**campaign, "audience_token": preview["audience_token"], "idempotency_key": str(uuid4())}
    assert client.post("/api/v1/platform/mail/send", headers=platform, json=payload).json()["queued"] == 1
    assert client.post("/api/v1/platform/mail/send", headers=platform, json=payload).json()["queued"] == 0
    register_org(client, "Two", "two@example.com")
    assert client.post("/api/v1/platform/mail/send", headers=platform, json=payload).status_code == 409
    targeted = client.post(
        "/api/v1/platform/mail/preview",
        headers=platform,
        json={**campaign, "all_organizations": False, "org_id": org_id},
    ).json()
    assert targeted["recipient_count"] == 1 and targeted["sample"][0]["email"] == "one@example.com"
    assert (
        client.patch("/api/v1/platform/mail/automations/welcome", headers=platform, json={"enabled": False}).status_code
        == 200
    )
    register_org(client, "Three", "three@example.com")
    with SessionLocal() as db:
        assert not db.scalar(select(MailMessage).where(MailMessage.recipient == "three@example.com"))
        org = db.get(Organization, org_id)
        org.trial_ends_at = datetime.now(UTC) + timedelta(days=2)
        db.commit()
    for _ in range(2):
        assert (
            client.post(
                "/api/v1/internal/mail/claim", headers=worker, json={"smtp_ready": False, "detail": "not_configured"}
            ).json()["message"]
            is None
        )
    with SessionLocal() as db:
        assert (
            db.scalar(
                select(func.count()).select_from(MailMessage).where(MailMessage.template == "subscription_expiring")
            )
            == 1
        )
    assert client.get("/api/v1/platform/mail/status", headers=platform).json()["connected"]


def test_failed_delivery_retry_and_unknown_smtp_outcome(client, platform, worker):
    """Distinguish a retryable failed delivery from ambiguous SMTP acceptance so uncertainty cannot silently duplicate
    email.
    """
    create_org(client, platform)
    claim = client.post(
        "/api/v1/internal/mail/claim", headers=worker, json={"smtp_ready": True, "detail": "ready"}
    ).json()["message"]
    path = f"/api/v1/internal/mail/{claim['id']}/result"
    assert (
        client.post(
            path,
            headers=worker,
            json={"claim_token": claim["claim_token"], "success": False, "error_code": "authentication_failed"},
        ).json()["status"]
        == "queued"
    )
    with SessionLocal() as db:
        item = db.get(MailMessage, claim["id"])
        item.status, item.locked_at = "sending", datetime.now(UTC) - timedelta(minutes=10)
        db.commit()
    assert (
        client.post("/api/v1/internal/mail/claim", headers=worker, json={"smtp_ready": True, "detail": "ready"}).json()[
            "message"
        ]
        is None
    )
    with SessionLocal() as db:
        item = db.get(MailMessage, claim["id"])
        assert item.status == "failed" and item.error_code == "delivery_unknown"
    assert client.post(f"/api/v1/platform/mail/messages/{claim['id']}/retry", headers=platform).status_code == 200


def test_tenant_cannot_use_administration_and_job_recovery(client, platform):
    """Deny platform operations to tenants and verify authorized failed-ingestion recovery retains its ownership/state
    contract.
    """
    tenant, account = register_org(client, "One", "one@example.com")
    for path in ("business", "billing/payments", "billing/export", "mail/status", "mail/messages", "ingestion/failed"):
        assert client.get("/api/v1/platform/" + path, headers=tenant).status_code == 403
    with SessionLocal() as db:
        org_id = account["user"]["organization"]["id"]
        document = Document(org_id=org_id, title="Guide", source="guide.txt", source_type="file", status="failed")
        db.add(document)
        db.flush()
        job = IngestionJob(
            org_id=org_id,
            document_id=document.id,
            job_type="text",
            status="failed",
            attempts=3,
            raw_text="A document that can be retried.",
        )
        db.add(job)
        db.commit()
        job_id = job.id
    assert client.get("/api/v1/platform/ingestion/failed", headers=platform).json()[0]["id"] == job_id
    assert client.post(f"/api/v1/platform/ingestion/{job_id}/retry", headers=tenant).status_code == 403
    assert client.post(f"/api/v1/platform/ingestion/{job_id}/retry", headers=platform).json()["status"] == "pending"
    with SessionLocal() as db:
        assert db.get(IngestionJob, job_id).attempts == 0
        assert db.scalar(select(AuditEvent).where(AuditEvent.action == "ingestion.retried"))


def test_expired_invitations_are_renewable_and_old_credentials_fail(client, platform):
    """Renew an expired initial account and require the previous invitation credentials to lose access."""
    org = create_org(client, platform)
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "owner@example.com"))
        user_id = user.id
        user.temporary_password_expires_at = datetime.now(UTC) - timedelta(days=1)
        invitation = db.scalar(select(MailMessage).where(MailMessage.user_id == user.id))
        old = json.loads(cipher().decrypt(invitation.sensitive_payload.encode()))["initial_password"]
        db.commit()
    assert client.post("/api/v1/auth/login", json={"email": "owner@example.com", "password": old}).status_code == 403
    assert (
        client.post(
            f"/api/v1/platform/organizations/{org['id']}/administrators/{user_id}/invite", headers=platform
        ).status_code
        == 200
    )
    assert client.post("/api/v1/auth/login", json={"email": "owner@example.com", "password": old}).status_code == 401
    with SessionLocal() as db:
        canceled = db.scalar(select(MailMessage).where(MailMessage.status == "canceled"))
        assert canceled.sensitive_payload is None


@pytest.mark.parametrize("payment_count", [1, 24])
def test_ledger_query_count_is_constant_and_refunds_are_aggregated(client, payment_count):
    """Count actual SQL statements to prevent ledger N+1 queries while checking page-scoped refund totals."""
    _, account = register_org(client, "Ledger", "ledger@example.com")
    org_id = account["user"]["organization"]["id"]
    with SessionLocal() as db:
        payments = [
            BillingEntry(org_id=org_id, kind="payment", amount_minor=1000, currency="EUR", idempotency_key=str(uuid4()))
            for _ in range(payment_count)
        ]
        db.add_all(payments)
        db.flush()
        payment_id = payments[0].id
        db.add(
            BillingEntry(
                org_id=org_id,
                kind="refund",
                amount_minor=250,
                currency="EUR",
                refund_of_id=payment_id,
                idempotency_key=str(uuid4()),
            )
        )
        db.commit()

    statements = []

    def count_query(conn, cursor, statement, parameters, context, executemany):
        """Record SQL execution count only; statement contents and parameters are intentionally not retained."""
        statements.append(statement)

    with SessionLocal() as db:
        event.listen(db.bind, "before_cursor_execute", count_query)
        try:
            page = list_payments(db, page=1, org_id=org_id, currency="EUR", days=30)
        finally:
            event.remove(db.bind, "before_cursor_execute", count_query)
    assert len(statements) == 3
    assert page["total"] == payment_count + 1
    assert len(page["items"]) == payment_count + 1
    assert page["page_size"] == 25
    original = next(item for item in page["items"] if item["id"] == payment_id)
    assert original["refunded_minor"] == 250
    assert all(item["organization_name"] == "Ledger" for item in page["items"])


def test_retry_invitation_without_expiry_is_rejected(client, platform):
    """Reject renewal of an account with no valid initial-password deadline instead of treating it as a permanent
    invitation.
    """
    create_org(client, platform)
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "owner@example.com"))
        user.temporary_password_expires_at = None
        mail = db.scalar(select(MailMessage).where(MailMessage.user_id == user.id))
        mail.status = "failed"
        mail_id = mail.id
        db.commit()
    response = client.post(f"/api/v1/platform/mail/messages/{mail_id}/retry", headers=platform)
    assert response.status_code == 409, response.text
