"""Protect public source metadata, legacy snapshots, logs and validation errors from access URLs."""

import logging

import pytest

from app.core.logging import RedactingFilter
from app.core.source_urls import public_source_url, redact_source_urls
from app.db import SessionLocal
from app.models import ConversationLog, Document, SupportCase
from app.services.vector_store import get_vector_store

PRIVATE_URL = "https://docs.example/guide?%61cCeSs%5FToKeN=fixture-private-secret&X-Amz-Signature=signed-secret#secret"
PUBLIC_URL = "https://docs.example/guide"


@pytest.mark.parametrize("query", [
    "TOKEN=fixture-secret", "%74oken=fixture-secret", "Api%255FKey=fixture-secret",
    "X-Amz-Signature=fixture-secret", "opaque=fixture-secret", "page=1&sig=fixture-secret",
])
def test_access_values_never_survive_public_metadata(query):
    """Query stripping does not depend on parameter spelling, encoding or a fallible secret-name denylist."""
    value = f"HTTPS://name:password@docs.example/guide?{query}#private"
    assert public_source_url(value) == PUBLIC_URL
    assert redact_source_urls(f"Guide {value}") == f"Guide {PUBLIC_URL}"
    assert public_source_url("guide.txt") == "guide.txt"


def test_private_fetch_url_and_safe_legacy_responses(client, auth_headers, monkeypatch):
    """Fetch with the complete signed URL; sanitize document metadata and old vector/case snapshots at output."""
    fetched = []
    monkeypatch.setattr("app.routers.documents.validate_public_http_url", lambda _: "93.184.216.34")

    async def fetch(url):
        """Record the exact fetch URL while providing a synthetic policy to real indexing/RAG code."""
        fetched.append(url)
        return "Shipping policy. Shipping delivery takes three working days.", None

    monkeypatch.setattr("app.routers.documents.extract_text_from_url", fetch)
    imported = client.post("/api/v1/documents/url", headers=auth_headers, json={"url": PRIVATE_URL})
    assert imported.status_code == 201, imported.text
    assert fetched == [PRIVATE_URL]
    assert imported.json()["source"] == PUBLIC_URL
    document_id = imported.json()["id"]
    with SessionLocal() as db:
        document = db.get(Document, document_id)
        assert document.source == PRIVATE_URL
        document.organization.allowed_domains = ["customer.example"]
        company_id = document.organization.public_id
        document.title = PRIVATE_URL  # A pre-fix default title in an existing database.
        document.error_message = f"Legacy fetch failed for {PRIVATE_URL}"
        log = ConversationLog(
            org_id=document.org_id, channel="widget", question="Shipping policy?", answer="Contact support",
            sources=[{"source": PRIVATE_URL, "title": PRIVATE_URL}],
        )
        db.add(log)
        db.flush()
        support_case = SupportCase(org_id=document.org_id, conversation_id=log.id)
        db.add(support_case)
        db.commit()
        case_id = support_case.id
    for item in get_vector_store().items:
        item["metadata"].update(source=PRIVATE_URL, title=PRIVATE_URL)
    listed = client.get("/api/v1/documents", headers=auth_headers)
    answered = client.post("/api/v1/chat", headers=auth_headers, json={"question": "What is the shipping policy?"})
    widget = client.post(f"/api/v1/widget/{company_id}/chat", headers={"Origin": "https://customer.example"},
                         json={"visitor_id": "visitor", "question": "What is the shipping policy?"})
    case = client.get(f"/api/v1/support-cases/{case_id}", headers=auth_headers)
    for response in (listed, answered, widget, case):
        assert response.status_code == 200, response.text
        assert "fixture-private-secret" not in response.text
        assert "signed-secret" not in response.text
        assert PUBLIC_URL in response.text
    assert answered.json()["sources"]
    assert widget.json()["sources"]
    assert case.json()["sources"] == [{"source": PUBLIC_URL, "title": PUBLIC_URL}]


def test_validation_never_echoes_password_or_url_values(client, auth_headers):
    """Pydantic failures retain useful locations/messages while excluding the original private inputs."""
    invalid_url = PRIVATE_URL + "x" * 1100
    response = client.post("/api/v1/documents/url", headers=auth_headers, json={"url": invalid_url})
    assert response.status_code == 422
    assert "fixture-private-secret" not in response.text
    password = "fixture-private-password" * 10
    response = client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": password})
    assert response.status_code == 422
    assert password not in response.text
    assert all("input" not in error and "ctx" not in error for error in response.json()["detail"])


@pytest.mark.parametrize("name,message,args", [
    ("httpx", "HTTP Request: GET %s", (PRIVATE_URL,)),
    ("uvicorn.access", '%s - "%s %s HTTP/%s" %d',
     ("127.0.0.1", "GET", "/guide?%74oken=fixture-private-secret", "1.1", 200)),
])
def test_encoded_and_opaque_access_urls_are_safe_in_logs(name, message, args):
    """Sanitize actual HTTP-client/server log record formats, including encoded parameter names."""
    record = logging.LogRecord(name, logging.INFO, __file__, 1, message, args, None)
    RedactingFilter().filter(record)
    assert "fixture-private-secret" not in record.getMessage()
    assert "signed-secret" not in record.getMessage()
