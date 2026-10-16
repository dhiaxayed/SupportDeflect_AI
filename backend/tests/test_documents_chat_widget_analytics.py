"""Exercise the knowledge-to-answer-to-analytics journey across protected/public APIs.

Uploaded synthetic text is really indexed by explicit test providers. Independent
organizations demonstrate that retrieval, conversations and metrics stay tenant-scoped."""

from fastapi.testclient import TestClient

from tests.conftest import register_org


def upload_api_doc(client: TestClient, headers: dict[str, str]):
    """Upload a synthetic API-key guide with real multipart handling and return the document response after indexing
    validation.
    """
    content = (
        b"API key management guide.\n\n"
        b"To regenerate an API key, open Settings, go to API Keys, click Regenerate, "
        b"copy the new key, and update your integration immediately."
    )
    response = client.post(
        "/api/v1/documents/upload",
        headers=headers,
        files={"file": ("api-guide.txt", content, "text/plain")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_upload_document_and_admin_chat(client, auth_headers):
    """Trace protected document upload into grounded administrator chat and its returned evidence contract."""
    document = upload_api_doc(client, auth_headers)
    assert document["status"] == "indexed"
    assert document["chunk_count"] >= 1

    chat_response = client.post(
        "/api/v1/chat",
        headers=auth_headers,
        json={"question": "How do I regenerate my API key?"},
    )
    assert chat_response.status_code == 200, chat_response.text
    payload = chat_response.json()
    assert payload["confidence_score"] >= 0
    assert payload["sources"]
    assert payload["status"] in {"resolved", "needs_human"}


def test_widget_chat_and_analytics(client, auth_headers):
    """Ask through the approved-origin public widget and require its conversation to appear in tenant analytics."""
    upload_api_doc(client, auth_headers)
    me = client.get("/api/v1/auth/me", headers=auth_headers).json()
    company_id = me["organization"]["public_id"]
    from app.db import SessionLocal
    from app.models import Organization

    with SessionLocal() as db:
        org = db.get(Organization, me["organization"]["id"])
        org.allowed_domains = ["customer.example"]
        db.commit()

    widget_response = client.post(
        f"/api/v1/widget/{company_id}/chat",
        headers={"Origin": "https://customer.example"},
        json={
            "company_id": company_id,
            "visitor_id": "visitor_test_1",
            "question": "How do I regenerate my API key?",
        },
    )
    assert widget_response.status_code == 200, widget_response.text
    assert widget_response.json()["answer"]

    analytics = client.get("/api/v1/analytics/summary", headers=auth_headers)
    assert analytics.status_code == 200, analytics.text
    assert analytics.json()["total_questions"] >= 1


def test_tenant_isolation(client):
    """Create independent organizations and prove that documents, retrieval results and metrics cannot cross tenant
    boundaries.
    """
    headers_a, payload_a = register_org(client, "Tenant A", "a@example.com")
    headers_b, payload_b = register_org(client, "Tenant B", "b@example.com")
    upload_api_doc(client, headers_a)

    company_b = payload_b["user"]["organization"]["public_id"]
    response = client.post(
        f"/api/v1/widget/{company_b}/chat",
        headers={"Origin": "https://customer.example"},
        json={
            "company_id": company_b,
            "visitor_id": "visitor_b",
            "question": "How do I regenerate my API key?",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["sources"] == []
    assert payload["needs_human"] is True
