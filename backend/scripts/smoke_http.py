"""HTTP smoke test for an isolated local v2_smoke.db, with a running worker."""

import argparse
import secrets
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.db import SessionLocal
from scripts.create_super_admin import create_super_admin


def main():
    """Require loopback, explicit fixture-creation acknowledgement and the exact v2_smoke SQLite database, then
    exercise real local HTTP role/knowledge/widget/case/admin flows. Creates persistent synthetic fixtures and
    needs a running worker; it is not real Groq/pgvector proof.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://127.0.0.1:5173/api/v1")
    parser.add_argument("--allow-create-test-data", action="store_true", required=True)
    args = parser.parse_args()
    config = get_settings()
    if (
        urlsplit(args.api).hostname not in {"localhost", "127.0.0.1"}
        or config.environment not in {"test", "local"}
        or config.database_url != "sqlite:///./v2_smoke.db"
    ):
        raise SystemExit("Smoke test requires loopback, local/test mode and sqlite:///./v2_smoke.db")
    suffix = secrets.token_hex(5)
    password = secrets.token_urlsafe(24)
    with httpx.Client(base_url=args.api.rstrip("/") + "/", timeout=30) as client:

        def request(method, path, code=200, **kwargs):
            """Send a request through this isolated smoke client, assert the expected HTTP code and decode an
            optional JSON body. Assertion diagnostics are fixture-only; never point this helper at production
            responses.
            """
            response = client.request(method, path, **kwargs)
            assert response.status_code == code, f"{method} {path}: {response.status_code} {response.text}"
            return response.json() if response.content else None

        def register(name):
            """Register a uniquely suffixed synthetic tenant administrator using this run's fixture password and
            return its response plus bearer headers for subsequent smoke requests.
            """
            result = request(
                "POST",
                "auth/register",
                code=201,
                json={
                    "organization_name": f"Smoke {name} {suffix}",
                    "admin_email": f"{name}-{suffix}@example.com",
                    "password": password,
                },
            )
            return result, {"Authorization": f"Bearer {result['access_token']}"}

        tenant, admin = register("alpha")
        _, foreign = register("beta")
        org = tenant["user"]["organization"]
        request(
            "PUT",
            "settings/widget",
            headers=admin,
            json={
                "brand_name": "Smoke",
                "primary_color": "#23634f",
                "greeting_message": "Hello",
                "allowed_domains": ["customer.example"],
                "strict_mode": True,
            },
        )
        agent = request(
            "POST",
            "team/users",
            code=201,
            headers=admin,
            json={
                "email": f"agent-{suffix}@example.com",
                "password": password,
                "role": "support_agent",
            },
        )
        login = request("POST", "auth/login", json={"email": agent["email"], "password": password})
        agent_headers = {"Authorization": f"Bearer {login['access_token']}"}
        agent_password = secrets.token_urlsafe(24)
        request(
            "POST",
            "auth/change-password",
            code=204,
            headers=agent_headers,
            json={"current_password": password, "new_password": agent_password},
        )
        login = request("POST", "auth/login", json={"email": agent["email"], "password": agent_password})
        agent_headers = {"Authorization": f"Bearer {login['access_token']}"}
        request("GET", "documents", code=403, headers=agent_headers)
        doc = request(
            "POST",
            "documents/upload",
            code=201,
            headers=admin,
            files={"file": ("guide.txt", b"Workspace exports remain available for thirty days.", "text/plain")},
        )
        for _ in range(30):
            rows = request("GET", "documents", headers=admin)
            doc = next(row for row in rows if row["id"] == doc["id"])
            if doc["status"] in {"indexed", "failed"}:
                break
            time.sleep(1)
        assert doc["status"] == "indexed", doc
        assert request("GET", "documents", headers=foreign) == []
        chat = request(
            "POST", "chat", headers=admin, json={"question": "Workspace exports remain available for thirty days?"}
        )
        assert chat["sources"] and chat["status"] == "resolved"
        assert request("GET", "support-cases", headers=admin) == []
        widget_path = f"widget/{org['public_id']}/chat"
        response = client.options(
            widget_path,
            headers={
                "Origin": "https://customer.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert response.is_success and response.headers["access-control-allow-origin"] == "https://customer.example"
        request(
            "POST",
            widget_path,
            code=403,
            headers={"Origin": "https://forbidden.example"},
            json={"visitor_id": "smoke-visitor", "question": "Question?"},
        )
        escalated = request(
            "POST",
            widget_path,
            headers={"Origin": "https://customer.example"},
            json={"visitor_id": "smoke-visitor", "question": "Urgent legal issue?"},
        )
        assert escalated["needs_human"]
        cases = request("GET", "support-cases", headers=agent_headers)
        assert len(cases) == 1
        case_id = cases[0]["id"]
        request("GET", f"support-cases/{case_id}", code=404, headers=foreign)
        request("PATCH", f"support-cases/{case_id}/assign", headers=agent_headers, json={})
        request("PATCH", f"support-cases/{case_id}/note", headers=agent_headers, json={"internal_note": "Reviewed"})
        request(
            "PATCH",
            f"support-cases/{case_id}/resolve",
            headers=agent_headers,
            json={"human_answer": "Handled through the support process."},
        )
        request("PATCH", f"support-cases/{case_id}/status", headers=agent_headers, json={"status": "closed"})
        email = f"platform-{suffix}@example.com"
        with SessionLocal() as db:
            create_super_admin(db, email, password, "Smoke Operator")
        login = request("POST", "auth/login", json={"email": email, "password": password})
        platform = {"Authorization": f"Bearer {login['access_token']}"}
        assert login["user"]["organization"] is None
        request("GET", "documents", code=403, headers=platform)
        request("GET", "platform/overview", code=403, headers=admin)
        request(
            "PATCH",
            f"platform/organizations/{org['id']}",
            headers=platform,
            json={"subscription_plan": "pro", "subscription_status": "active"},
        )
        assert request("GET", "settings/subscription", headers=admin)["plan"] == "pro"
        request(
            "PATCH", f"platform/organizations/{org['id']}", headers=platform, json={"subscription_status": "suspended"}
        )
        request("GET", "documents", code=403, headers=admin)
        request(
            "PATCH", f"platform/organizations/{org['id']}", headers=platform, json={"subscription_status": "active"}
        )
        assert request("GET", "platform/audit-events", headers=platform)
        assert request("GET", "analytics/summary", headers=admin)["total_questions"] == 2
    print(
        "HTTP smoke passed: auth, roles, team, queued worker, vectors, chat, "
        "widget CORS, cases, plans, audit, isolation."
    )
    print("Legacy smoke fixture only. Use frontend Playwright tests; this does not validate Groq or pgvector.")


if __name__ == "__main__":
    main()
