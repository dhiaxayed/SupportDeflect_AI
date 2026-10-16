"""Exercise role separation, organization lifecycle and visitor-to-agent support workflows.

Synthetic tenants/platform users share the test API but must retain separate authority.
Public widget tests additionally check Origin, company binding, capabilities and usage limits."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.db import SessionLocal
from app.models import AuditEvent, ConversationLog, Organization, SupportCase, User
from app.security import create_access_token
from scripts.create_super_admin import create_super_admin
from tests.conftest import register_org


@pytest.fixture
def platform_headers():
    """Create a fixture platform actor outside all tenants and return its real signed API header."""
    with SessionLocal() as db:
        assert create_super_admin(db, "platform@example.com", "long-platform-password", "Operator")
        assert not create_super_admin(db, "platform@example.com", "different-password", "Operator")
        user = db.scalar(select(User).where(User.email == "platform@example.com"))
        return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def create_agent(client, headers, email="agent@example.com"):
    """Create and activate a synthetic support-agent account, returning the account/authorization data used by role
    tests.
    """
    response = client.post(
        "/api/v1/team/users",
        headers=headers,
        json={
            "email": email,
            "full_name": "Support Agent",
            "password": "secure-password",
            "role": "support_agent",
        },
    )
    assert response.status_code == 201, response.text
    login = client.post("/api/v1/auth/login", json={"email": email, "password": "secure-password"}).json()
    assert login["user"]["must_change_password"]
    assert (
        client.post(
            "/api/v1/auth/change-password",
            headers={"Authorization": f"Bearer {login['access_token']}"},
            json={"current_password": "secure-password", "new_password": "agent-updated-password"},
        ).status_code
        == 204
    )
    login = client.post("/api/v1/auth/login", json={"email": email, "password": "agent-updated-password"}).json()
    return response.json(), {"Authorization": f"Bearer {login['access_token']}"}


def escalate(client, payload):
    """Ask an unsupported visitor question on an approved Origin and return its persisted escalation/capability
    payload.
    """
    company = payload["user"]["organization"]["public_id"]
    response = client.post(
        f"/api/v1/widget/{company}/chat",
        headers={"Origin": "https://customer.example"},
        json={"visitor_id": "visitor_test", "question": "Undocumented legal question?"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["needs_human"]


def test_roles_team_and_isolation(client, platform_headers):
    """Exercise tenant/platform/agent permissions and prevent cross-organization account or knowledge access."""
    admin, tenant = register_org(client, "Alpha", "alpha@example.com")
    foreign, other = register_org(client, "Beta", "beta@example.com")
    agent, agent_headers = create_agent(client, admin)
    assert tenant["user"]["role"] == "tenant_admin"
    assert client.get("/api/v1/auth/me", headers=platform_headers).json()["organization"] is None
    for headers in (admin, agent_headers):
        for path in ("overview", "organizations", "audit-events", "health"):
            assert client.get(f"/api/v1/platform/{path}", headers=headers).status_code == 403
    for headers in (agent_headers, platform_headers):
        for path in ("documents", "analytics/summary", "settings/widget", "settings/subscription"):
            assert client.get(f"/api/v1/{path}", headers=headers).status_code == 403
        assert (
            client.post(
                "/api/v1/team/users",
                headers=headers,
                json={
                    "email": "forbidden@example.com",
                    "password": "secure-password",
                },
            ).status_code
            == 403
        )
    assert client.get("/api/v1/support-cases", headers=platform_headers).status_code == 403
    assert (
        client.post(
            "/api/v1/team/users",
            headers=admin,
            json={
                "email": "bad@example.com",
                "password": "secure-password",
                "role": "super_admin",
            },
        ).status_code
        == 422
    )
    assert (
        client.patch(f"/api/v1/team/users/{agent['id']}", headers=foreign, json={"is_active": False}).status_code == 404
    )
    assert len(client.get("/api/v1/team/users", headers=foreign).json()) == 1
    assert client.post(f"/api/v1/team/users/{tenant['user']['id']}/deactivate", headers=admin).status_code == 400
    assert client.post(f"/api/v1/team/users/{agent['id']}/deactivate", headers=admin).status_code == 200
    assert client.get("/api/v1/auth/me", headers=agent_headers).status_code == 401
    assert (
        client.post(
            "/api/v1/auth/login",
            json={
                "email": agent["email"],
                "password": "secure-password",
            },
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/v1/auth/login",
            json={
                "email": "alpha@example.com",
                "password": "incorrect",
            },
        ).status_code
        == 401
    )
    assert other["user"]["organization"]["id"] != tenant["user"]["organization"]["id"]


def test_platform_metadata_plan_suspension_audit(client, platform_headers):
    """Connect organization metadata/plan/suspension changes to tenant access and matching platform audit events."""
    admin, tenant = register_org(client, "Alpha", "alpha@example.com")
    org_id = tenant["user"]["organization"]["id"]
    overview = client.get("/api/v1/platform/overview", headers=platform_headers)
    assert overview.json()["organizations_total"] == 1
    listing = client.get(
        "/api/v1/platform/organizations?search=Alpha&plan=trial&status=trialing", headers=platform_headers
    ).json()
    assert listing["total"] == 1
    detail = client.get(f"/api/v1/platform/organizations/{org_id}", headers=platform_headers).json()
    assert detail["users_count"] == 1
    assert "documents" not in detail
    for status in ("suspended", "active"):
        response = client.patch(
            f"/api/v1/platform/organizations/{org_id}",
            headers=platform_headers,
            json={"subscription_plan": "pro", "subscription_status": status},
        )
        assert response.status_code == 200, response.text
        code = client.get("/api/v1/documents", headers=admin).status_code
        assert code == (403 if status == "suspended" else 200)
    assert client.get("/api/v1/settings/subscription", headers=admin).json()["questions_limit_30d"] == 25_000
    events = client.get("/api/v1/platform/audit-events", headers=platform_headers).json()
    assert sum(e["action"] == "organization.updated" for e in events) == 2
    assert (
        client.get("/api/v1/platform/health", headers=platform_headers).json()["checks"]["llm"]["status"] == "degraded"
    )


def test_support_case_workflow_and_unique_conversation(client):
    """Trace assignment, internal notes, resolution and visitor-visible replies while retaining one case per escalated
    conversation.
    """
    admin, tenant = register_org(client, "Alpha", "alpha@example.com")
    foreign, other = register_org(client, "Beta", "beta@example.com")
    agent, headers = create_agent(client, admin)
    foreign_agent, _ = create_agent(client, foreign, "other-agent@example.com")
    client.post("/api/v1/chat", headers=admin, json={"question": "Unknown question?"})
    assert client.get("/api/v1/support-cases", headers=admin).json() == []
    escalate(client, tenant)
    cases = client.get("/api/v1/support-cases?status=open", headers=headers).json()
    assert len(cases) == 1
    case = cases[0]
    path = f"/api/v1/support-cases/{case['id']}"
    assert case["visitor_id"] == "visitor_test"
    assert client.get(path, headers=foreign).status_code == 404
    for action, payload in (
        ("assign", {}),
        ("note", {"internal_note": "private"}),
        ("resolve", {"human_answer": "answer"}),
    ):
        assert client.patch(path + "/" + action, headers=foreign, json=payload).status_code == 404
    assert (
        client.patch(path + "/assign", headers=headers, json={"assigned_to_user_id": foreign_agent["id"]}).status_code
        == 400
    )
    response = client.patch(path + "/assign", headers=headers, json={})
    assert response.json()["assigned_to_user_id"] == agent["id"]
    assert response.json()["status"] == "in_review"
    assert client.patch(path + "/note", headers=headers, json={"internal_note": "Investigated"}).status_code == 200
    result = client.patch(path + "/resolve", headers=headers, json={"human_answer": "Contact our billing team."}).json()
    assert result["status"] == "resolved" and result["resolved_at"]
    assert result["internal_note"] == "Investigated"
    with SessionLocal() as db:
        assert (
            db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "support_case.resolved"))
            == 1
        )
        original = db.get(ConversationLog, case["conversation_id"])
        assert original.needs_human  # Human resolution must not inflate AI deflection metrics.
        db.add(SupportCase(org_id=case["org_id"], conversation_id=case["conversation_id"], reason="duplicate"))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()


@pytest.mark.parametrize(
    "origin,expected",
    [
        ("https://customer.example", 200),
        ("https://help.customer.example", 200),
        ("https://evilcustomer.example", 403),
        ("https://customer.example.evil.test", 403),
        ("null", 403),
        ("", 403),
    ],
)
def test_widget_origin_preflight(client, origin, expected):
    """Apply tenant Origin policy to actual browser-style CORS preflight requests, including denied and missing
    origins.
    """
    _, payload = register_org(client, "Customer", "customer@example.com")
    company = payload["user"]["organization"]["public_id"]
    headers = {"Origin": origin} if origin else {}
    path = f"/api/v1/widget/{company}/chat"
    preflight = client.options(
        path,
        headers={**headers, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"},
    )
    assert preflight.status_code == (204 if expected == 200 else 403)
    response = client.post(path, headers=headers, json={"visitor_id": "visitor_x", "question": "Unknown?"})
    assert response.status_code == expected
    settings = client.get(f"/api/v1/widget/settings/{company}", headers=headers)
    assert settings.status_code == expected
    if expected == 200:
        assert response.headers["access-control-allow-origin"] == origin
        assert "access-control-allow-credentials" not in response.headers
    else:
        assert "access-control-allow-origin" not in response.headers
    admin_preflight = client.options(
        "/api/v1/documents",
        headers={
            "Origin": "https://customer.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert "access-control-allow-origin" not in admin_preflight.headers


def test_widget_company_binding_and_rate_limit(client, monkeypatch):
    """Reject conflicting company identifiers and enforce visitor/IP request limits on the public chat boundary."""
    _, a = register_org(client, "Alpha", "alpha@example.com")
    _, b = register_org(client, "Beta", "beta@example.com")
    with SessionLocal() as db:
        org = db.get(Organization, b["user"]["organization"]["id"])
        org.allowed_domains = ["other.example"]
        db.commit()
    path = f"/api/v1/widget/{b['user']['organization']['public_id']}/chat"
    assert (
        client.post(
            path, headers={"Origin": "https://customer.example"}, json={"visitor_id": "visitor_x", "question": "Test?"}
        ).status_code
        == 403
    )
    from app.routers.widget import settings

    monkeypatch.setattr(settings, "widget_rate_limit_per_minute", 1)
    escalate(client, a)
    path = f"/api/v1/widget/{a['user']['organization']['public_id']}/chat"
    assert (
        client.post(
            path,
            headers={"Origin": "https://customer.example"},
            json={"visitor_id": "visitor_test", "question": "Again?"},
        ).status_code
        == 429
    )


def test_trial_expiration_and_password_change(client):
    """Combine expired-trial usage denial with password-version revocation and successful reauthentication."""
    headers, payload = register_org(client, "Alpha", "alpha@example.com")
    with SessionLocal() as db:
        org = db.get(Organization, payload["user"]["organization"]["id"])
        org.trial_ends_at = datetime.now(UTC) - timedelta(days=1)
        db.commit()
    assert client.post("/api/v1/chat", headers=headers, json={"question": "Question?"}).status_code == 402
    assert (
        client.post(
            "/api/v1/auth/change-password",
            headers=headers,
            json={"current_password": "secure-password", "new_password": "changed-password"},
        ).status_code
        == 204
    )
    assert (
        client.post(
            "/api/v1/auth/login",
            json={
                "email": "alpha@example.com",
                "password": "changed-password",
            },
        ).status_code
        == 200
    )
