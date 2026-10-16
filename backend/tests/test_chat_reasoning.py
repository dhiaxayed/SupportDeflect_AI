"""Protect the distinction between greetings, knowledge questions and provider outages.

Explicit test doubles observe whether generation/retrieval should occur. API responses
and persisted cases are checked together so an outage cannot become a false business escalation."""

from types import SimpleNamespace

import pytest

from app.db import SessionLocal
from app.models import SupportCase
from app.services import rag
from app.services.llm import LLMProviderError
from app.services.vector_store import RetrievedChunk
from tests.conftest import register_org


@pytest.mark.parametrize("question", ["helo", "Hello!!!", "bonjour", "Salut!", "Merci beaucoup", "thank you"])
def test_social_messages_use_llm_without_knowledge_or_human_case(client, monkeypatch, question):
    """Send exact greeting/thanks messages and require conversational generation without retrieval, sources or a
    support case.
    """
    headers, payload = register_org(client, "Greeting tenant", "greeting@example.com")
    calls = []

    def generate(**kwargs):
        """Return the controlled conversational answer while recording the prompt passed to the explicit LLM double."""
        calls.append(kwargs)
        return "Hello! How can I help you?"

    monkeypatch.setattr(rag, "get_llm_client", lambda: SimpleNamespace(generate=generate))

    def unexpected_retrieval():
        """Fail immediately if a pure greeting incorrectly enters the knowledge retrieval path."""
        pytest.fail("A pure greeting must not require company documentation")

    monkeypatch.setattr(rag, "get_embedding_service", unexpected_retrieval)
    company = payload["user"]["organization"]["public_id"]
    response = client.post(
        f"/api/v1/widget/{company}/chat",
        headers={"Origin": "https://customer.example"},
        json={"visitor_id": "visitor_greeting", "question": question},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["reason"] == "greeting" and body["status"] == "resolved"
    assert body["needs_human"] is False and body["sources"] == []
    assert body["support_case_id"] is None and body["confidence_score"] == 0
    assert len(calls) == 1 and calls[0]["user_prompt"] == question
    assert "Do not claim any company facts" in calls[0]["system_prompt"]
    with SessionLocal() as db:
        assert db.query(SupportCase).count() == 0


@pytest.mark.parametrize("question", ["Hello, what is your refund policy?", "Bonjour paiement urgent", "thanks refund"])
def test_greeting_prefix_never_bypasses_grounding(client, auth_headers, monkeypatch, question):
    """Require factual questions beginning with a greeting to retain normal document grounding rather than taking the
    social shortcut.
    """
    monkeypatch.setattr(rag, "get_vector_store", lambda: SimpleNamespace(search=lambda **kw: []))

    def unexpected_llm():
        """Detect an unsupported factual question reaching generation instead of the expected knowledge fallback."""
        pytest.fail("Unsupported factual questions must not be answered without evidence")

    monkeypatch.setattr(rag, "get_llm_client", unexpected_llm)
    response = client.post("/api/v1/chat", headers=auth_headers, json={"question": question})
    assert response.json()["reason"] == "insufficient_knowledge"
    assert response.json()["needs_human"] is True


@pytest.mark.parametrize("question", ["hello", "What is the delivery time?"])
def test_groq_failure_is_not_reported_as_missing_documentation(client, auth_headers, monkeypatch, question):
    """Require provider failures to return the explicit unavailable reason instead of creating a fictional missing-
    knowledge case.
    """
    chunk = RetrievedChunk(text="Delivery takes three days.", score=0.9, metadata={})
    monkeypatch.setattr(rag, "get_vector_store", lambda: SimpleNamespace(search=lambda **kw: [chunk]))

    def fail(**kwargs):
        """Inject the provider failure at generation so the API's sanitized outage contract can be observed."""
        raise LLMProviderError("private upstream details", code="rate_limit")

    monkeypatch.setattr(rag, "get_llm_client", lambda: SimpleNamespace(generate=fail))
    response = client.post("/api/v1/chat", headers=auth_headers, json={"question": question})
    body = response.json()
    assert body["reason"] == "llm_unavailable" and body["error_code"] == "rate_limit"
    assert body["needs_human"] is True and body["sources"] == []
    assert "Groq rate limit" in body["answer"]
    assert "private upstream details" not in response.text


def test_retrieval_failure_is_distinct_from_absent_knowledge(client, auth_headers, monkeypatch):
    """Keep a retrieval infrastructure failure distinguishable from a valid search that finds no documentation."""
    def fail():
        """Raise a controlled retrieval exception before answer generation; its private details must stay out of the
        response.
        """
        raise RuntimeError("private storage location")

    monkeypatch.setattr(rag, "get_embedding_service", fail)
    body = client.post("/api/v1/chat", headers=auth_headers, json={"question": "Comment installer?"}).json()
    assert body["reason"] == "retrieval_unavailable"
    assert "temporairement indisponible" in body["answer"]
    assert "private storage" not in body["answer"]
