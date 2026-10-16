"""Cover extraction/chunking and safe error persistence for inline and queued imports.

Provider/network failures are injected deliberately; public document/job records must
retain actionable states without leaking the injected private exception contents."""

from sqlalchemy import select

from app.core.config import get_settings
from app.db import SessionLocal
from app.models import Document, IngestionJob
from app.services.ingestion import IngestionError, chunk_text, clean_text
from app.services.ingestion_jobs import process_next_ingestion_job


def test_clean_and_chunk_text():
    """Check normalized text and overlapping bounded chunks so ingestion retains content without a non-advancing split
    loop.
    """
    raw = "Title\n\n" + "API keys can be regenerated from Settings. " * 80
    cleaned = clean_text(raw)
    chunks = chunk_text(cleaned, max_chars=300, overlap=40)
    assert "API keys" in cleaned
    assert len(chunks) >= 2
    assert all(len(chunk) <= 360 for chunk in chunks)


def test_unexpected_provider_errors_are_not_exposed(client, auth_headers, monkeypatch, caplog):
    """Inject a private provider exception and require safe public document errors plus diagnostic logging without its
    value.
    """
    from app.services import ingestion

    secret = "private-provider-credential-and-document-data"

    def broken_provider():
        """Fail the embedding provider deliberately so the upload path exercises unexpected-error sanitization."""
        raise RuntimeError(secret)

    monkeypatch.setattr(ingestion, "get_embedding_service", broken_provider)
    response = client.post(
        "/api/v1/documents/upload",
        headers=auth_headers,
        files={"file": ("guide.txt", b"Useful documentation with enough readable content.", "text/plain")},
    )
    assert response.status_code == 201
    assert response.json()["status"] == "failed"
    assert secret not in response.text
    assert "Retry" in response.json()["error_message"]
    assert secret not in caplog.text
    with SessionLocal() as db:
        document = db.get(Document, response.json()["id"])
        assert document.error_message == response.json()["error_message"]


def test_inline_url_failure_is_persisted_and_visible(client, auth_headers, monkeypatch):
    """Persist an inline URL-fetch failure as an actionable document state rather than losing the failed import
    record.
    """
    from app.routers import documents

    async def unavailable(url):
        """Reject the synthetic URL fetch with a controlled error while avoiding any external HTTP request."""
        raise IngestionError("Source website returned HTTP 503")

    monkeypatch.setattr(documents, "validate_public_http_url", lambda url: "8.8.8.8")
    monkeypatch.setattr(documents, "extract_text_from_url", unavailable)
    response = client.post(
        "/api/v1/documents/url",
        headers=auth_headers,
        json={"url": "https://docs.example/guide"},
    )
    assert response.status_code == 201
    assert response.json()["status"] == "failed"
    assert response.json()["error_message"] == "Source website returned HTTP 503"
    listed = client.get("/api/v1/documents", headers=auth_headers).json()
    assert listed[0]["status"] == "failed"


def test_queued_retry_clears_old_failure_and_does_not_leak_errors(client, auth_headers, monkeypatch):
    """Fail then retry durable ingestion, requiring safe failure text and clearing obsolete job errors after success."""
    from app.services import ingestion

    monkeypatch.setattr(get_settings(), "ingestion_mode", "queued")
    response = client.post(
        "/api/v1/documents/upload",
        headers=auth_headers,
        files={"file": ("guide.txt", b"Useful documentation with enough readable content.", "text/plain")},
    )
    document_id = response.json()["id"]
    with monkeypatch.context() as failure:

        def unavailable():
            """Fail the first controlled provider call so the same persisted job can later demonstrate successful
            recovery.
            """
            raise RuntimeError("private-provider-data")

        failure.setattr(ingestion, "get_embedding_service", unavailable)
        assert process_next_ingestion_job("regression-worker")
    with SessionLocal() as db:
        job = db.scalar(select(IngestionJob).where(IngestionJob.document_id == document_id))
        assert job.status == "pending"
        assert "private-provider-data" not in job.error_message
    assert process_next_ingestion_job("regression-worker")
    with SessionLocal() as db:
        job = db.scalar(select(IngestionJob).where(IngestionJob.document_id == document_id))
        assert job.status == "completed" and job.error_message is None
        assert db.get(Document, document_id).status == "indexed"
