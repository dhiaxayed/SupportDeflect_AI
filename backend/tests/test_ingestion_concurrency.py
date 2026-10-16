"""Exercise native SQLite races and ASGI scheduling with real sessions and API requests."""

import io
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from threading import Barrier, Event, get_ident, local

import httpx
import pytest
from fastapi import HTTPException
from PIL import Image
from sqlalchemy import event, func, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import SessionLocal
from app.main import app
from app.models import ConversationLog, Document, IngestionJob, Organization
from app.services import ingestion_jobs, subscriptions


@pytest.fixture
def organization_id():
    """Persist one synthetic organization and return its ID so competing sessions share only the intended tenant."""
    with SessionLocal() as db:
        org = Organization(
            public_id="company_concurrency_fixture",
            name="Concurrency fixture",
            widget_brand_name="Concurrency fixture",
            widget_greeting="Hello",
        )
        db.add(org)
        db.commit()
        return org.id


def create_pending_jobs(org_id, count=1):
    """Create a requested number of real pending document/text-job pairs and return their identifiers for worker
    races.
    """
    with SessionLocal() as db:
        ids = []
        for _ in range(count):
            document = Document(org_id=org_id, title="Guide", source="guide.txt", source_type="file")
            db.add(document)
            db.flush()
            job = IngestionJob(
                org_id=org_id,
                document_id=document.id,
                job_type="text",
                raw_text="A useful support guide with enough readable documentation.",
            )
            db.add(job)
            db.flush()
            ids.append((document.id, job.id))
        db.commit()
        return ids


def test_native_workers_cannot_claim_the_same_pending_job(organization_id, monkeypatch):
    """Synchronize native workers and require distinct winning job claims rather than duplicate processing of one
    row.
    """
    create_pending_jobs(organization_id, count=2)
    ready = Barrier(2)
    state = local()
    original = Session.scalar

    def synchronized_read(db, statement, *args, **kwargs):
        """Pause after the real pending-job selection to reproduce SQLite's ignored FOR UPDATE without faking query
        results.
        """
        result = original(db, statement, *args, **kwargs)
        # Force both real connections to observe the same pending row before either writes.
        if isinstance(result, IngestionJob) and result.status == "pending" and not getattr(state, "ready", False):
            state.ready = True
            ready.wait(timeout=10)
        return result

    monkeypatch.setattr(Session, "scalar", synchronized_read)
    with ThreadPoolExecutor(max_workers=2) as pool:
        claims = list(pool.map(ingestion_jobs.claim_next_job, ["native-a", "native-b"]))
    assert all(claim is not None for claim in claims)
    assert len({claim.id for claim in claims}) == 2
    with SessionLocal() as db:
        assert list(db.scalars(select(IngestionJob.attempts))) == [1, 1]


@pytest.mark.parametrize("title", [None, "My selected knowledge title"])
@pytest.mark.parametrize("legacy", [False, True])
def test_queued_url_indexing_respects_the_requested_title(client, auth_headers, monkeypatch, title, legacy):
    """Verify extracted/default, explicit and legacy-custom URL titles survive the worker's locked refresh and
    indexing commit.
    """
    from app.routers import documents

    monkeypatch.setattr(get_settings(), "ingestion_mode", "queued")
    monkeypatch.setattr(documents, "validate_public_http_url", lambda _: "8.8.8.8")

    async def download(_):
        """Return controlled source text/title for the synthetic URL; the worker still executes its actual persistence
        flow.
        """
        return "A useful support guide with enough readable documentation.", "Website page title"

    monkeypatch.setattr(ingestion_jobs, "extract_text_from_url", download)
    payload = {"url": "https://docs.example/guide"}
    if title is not None:
        payload["title"] = title
    response = client.post("/api/v1/documents/url", headers=auth_headers, json=payload)
    assert response.status_code == 201
    if legacy:
        with SessionLocal() as db:
            job = db.scalar(select(IngestionJob).where(IngestionJob.document_id == response.json()["id"]))
            job.payload = {"url": payload["url"]}
            db.commit()
    assert ingestion_jobs.process_next_ingestion_job("title-worker")
    with SessionLocal() as db:
        document = db.get(Document, response.json()["id"])
        assert document.status == "indexed"
        assert document.title == (title or "Website page title")


@pytest.mark.parametrize("operation", ["upload", "url", "logo"])
async def test_blocking_import_and_logo_work_runs_outside_the_asgi_loop(
    auth_headers, monkeypatch, tmp_path, operation
):
    """Issue real ASGI requests while observing the executing thread, proving import/logo work does not block the
    event loop.
    """
    from app.routers import documents, settings

    event_loop_thread = get_ident()
    execution_threads = []
    if operation == "upload":
        original = documents.extract_text_from_file

        def extract(*args):
            """Record the extraction thread and return valid fixture content without expensive parsing or remote
            fetching.
            """
            execution_threads.append(get_ident())
            return original(*args)

        monkeypatch.setattr(documents, "extract_text_from_file", extract)
        request = dict(files={"file": ("guide.txt", b"Readable fixture documentation for support.", "text/plain")})
        path = "/api/v1/documents/upload"
    elif operation == "url":
        monkeypatch.setattr(get_settings(), "ingestion_mode", "queued")

        def validate(_):
            """Record URL-validation scheduling while preserving the fixture's controlled public-source path."""
            execution_threads.append(get_ident())
            return "8.8.8.8"

        monkeypatch.setattr(documents, "validate_public_http_url", validate)
        request = dict(json={"url": "https://docs.example/guide"})
        path = "/api/v1/documents/url"
    else:
        monkeypatch.setattr(get_settings(), "widget_assets_directory", str(tmp_path))
        original = settings.store_logo

        def store(*args):
            """Observe logo-processing scheduling and return a synthetic asset path without writing a real user
            asset.
            """
            execution_threads.append(get_ident())
            return original(*args)

        monkeypatch.setattr(settings, "store_logo", store)
        image = io.BytesIO()
        Image.new("RGBA", (8, 8), "blue").save(image, format="PNG")
        request = dict(files={"file": ("logo.png", image.getvalue(), "image/png")})
        path = "/api/v1/settings/widget/logo"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.post(path, headers=auth_headers, **request)
    assert response.status_code == 201, response.text
    assert execution_threads and event_loop_thread not in execution_threads


@pytest.mark.parametrize("operation", ["documents", "questions"])
def test_native_quota_admission_serializes_concurrent_requests(organization_id, monkeypatch, operation):
    """Race real document/question admission against one remaining slot and require exactly one accepted write."""
    limit = "max_documents" if operation == "documents" else "max_questions_per_month"
    monkeypatch.setitem(subscriptions.PLANS, "trial", replace(subscriptions.PLANS["trial"], **{limit: 1}))
    name = "enforce_document_quota" if operation == "documents" else "enforce_question_quota"
    original = getattr(subscriptions, name)

    def slow_validation(*args, **kwargs):
        """Delay the real subscription validation so unreserved read/check/write requests would overlap reproducibly."""
        original(*args, **kwargs)
        # A slow read-check-write boundary must not let two requests consume the final slot.
        time.sleep(0.1)

    monkeypatch.setattr(subscriptions, name, slow_validation)
    ready = Barrier(2)

    def submit(_):
        """Attempt one fixture admission in its own session and commit only successful document/question state."""
        with SessionLocal() as db:
            org = db.get(Organization, organization_id)
            ready.wait(timeout=10)
            try:
                if operation == "documents":
                    subscriptions.enforce_document_quota(db, org, upload_size=50)
                    db.add(Document(org_id=org.id, title="Guide", source="guide.txt", source_type="file"))
                    db.commit()
                else:
                    with subscriptions.reserve_question_quota(db, org):
                        db.add(
                            ConversationLog(org_id=org.id, channel="admin", question="Hello", answer="Hello")
                        )
                        db.commit()
                return True
            except HTTPException as error:
                assert error.status_code == 402
                return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        allowed = list(pool.map(submit, range(2)))
    assert allowed.count(True) == 1
    with SessionLocal() as db:
        model = Document if operation == "documents" else ConversationLog
        assert db.scalar(select(func.count(model.id)).where(model.org_id == organization_id)) == 1


def restart_attempt(job_id):
    """Model the failed-job retry API's reset, which may reuse an earlier attempt number."""
    with SessionLocal() as db:
        job = db.get(IngestionJob, job_id)
        job.status, job.attempts = "pending", 0
        job.locked_at, job.locked_by = None, None
        db.get(Document, job.document_id).status = "pending"
        db.commit()
    return ingestion_jobs.claim_next_job("successor")


@pytest.mark.parametrize("during_embedding", [False, True])
def test_manual_retry_does_not_accept_a_former_lease_with_the_same_attempt(
    organization_id, monkeypatch, during_embedding
):
    """Reject obsolete workers both before work and after inference even when manual retry reuses their attempt
    number.
    """
    from app.services.embeddings import get_embedding_service

    document_id, job_id = create_pending_jobs(organization_id)[0]
    first = ingestion_jobs.claim_next_job("former")
    successor = []
    if during_embedding:
        service = get_embedding_service()
        original = service.embed_texts

        def retry_during_inference(chunks):
            """Replace the persisted lease during embedding, then return fixture vectors to test the final fenced
            commit.
            """
            successor.append(restart_attempt(job_id))
            return original(chunks)

        monkeypatch.setattr(service, "embed_texts", retry_during_inference)
    else:
        successor.append(restart_attempt(job_id))
    ingestion_jobs.process_claimed_job(job_id, expected_attempt=first.attempts, expected_locked_at=first.locked_at)
    assert successor[0].attempts == first.attempts
    with SessionLocal() as db:
        job = db.get(IngestionJob, job_id)
        assert job.status == "processing" and job.locked_at == successor[0].locked_at
        assert db.get(Document, document_id).status == "pending"


def test_native_stale_recovery_cannot_overwrite_a_fresh_claim(organization_id, monkeypatch):
    """Run stale recovery beside a fresh claim and require the successor lease to retain sole processing authority."""
    _, job_id = create_pending_jobs(organization_id)[0]
    ingestion_jobs.claim_next_job("expired")
    cutoff = datetime.now(UTC) - timedelta(minutes=15)
    with SessionLocal() as db:
        db.get(IngestionJob, job_id).locked_at = cutoff - timedelta(minutes=1)
        db.commit()
    ready = Barrier(2)
    state = local()
    original = Session.scalar

    def slow_stale_read(db, statement, *args, **kwargs):
        """Delay an unreserved stale-job observation to expose a potential read/check/write overwrite."""
        result = original(db, statement, *args, **kwargs)
        if isinstance(result, IngestionJob) and result.status == "processing" and result.locked_at < cutoff:
            time.sleep(state.delay)
        return result

    monkeypatch.setattr(Session, "scalar", slow_stale_read)

    def recover_and_claim(delay):
        """Start one recovery/claim contender after its scheduling delay and return the actual worker claim."""
        state.delay = delay
        ready.wait(timeout=10)
        ingestion_jobs.recover_stale_jobs(cutoff)
        return ingestion_jobs.claim_next_job(f"recovery-{delay}")

    with ThreadPoolExecutor(max_workers=2) as pool:
        claims = list(pool.map(recover_and_claim, [0.2, 0.02]))
    successful = [claim for claim in claims if claim is not None]
    assert len(successful) == 1
    with SessionLocal() as db:
        job = db.get(IngestionJob, job_id)
        assert job.status == "processing" and job.locked_at == successful[0].locked_at
        assert job.attempts == 2


def test_native_terminal_update_cannot_cancel_a_successor_lease(organization_id, monkeypatch):
    """Prevent a delayed terminal cancellation from changing the processing state of a newer worker lease."""
    _, job_id = create_pending_jobs(organization_id)[0]
    first = ingestion_jobs.claim_next_job("former")
    observed = Event()
    state = local()
    original = Session.refresh

    def slow_refresh(db, instance, *args, **kwargs):
        """Pause the real unfenced refresh boundary so a successor lease can be installed before the former completion
        writes.
        """
        result = original(db, instance, *args, **kwargs)
        if isinstance(instance, IngestionJob) and getattr(state, "terminal_update", False):
            state.terminal_update = False
            observed.set()
            time.sleep(0.2)
        return result

    monkeypatch.setattr(Session, "refresh", slow_refresh)

    def finish_former():
        """Attempt cancellation using the former lease's identifiers in a separate database session."""
        state.terminal_update = True
        with SessionLocal() as db:
            ingestion_jobs.mark_job_finished(
                db, db.get(IngestionJob, job_id), status="cancelled", expected_attempt=first.attempts,
                expected_locked_at=first.locked_at,
            )

    with ThreadPoolExecutor(max_workers=1) as pool:
        completion = pool.submit(finish_former)
        assert observed.wait(timeout=10)
        successor = restart_attempt(job_id)
        completion.result(timeout=10)
    with SessionLocal() as db:
        job = db.get(IngestionJob, job_id)
        assert job.status == "processing" and job.locked_at == successor.locked_at


def test_organization_quota_lock_permits_postgres_foreign_key_readers(organization_id):
    """Compile the actual ORM lock request and require NO KEY UPDATE, preserving quota exclusion without blocking FK
    readers.
    """
    statements = []

    def capture_refresh(execution):
        """Capture the actual refresh execution's SQL statement without replacing the helper's requested lock
        options.
        """
        if execution.is_select:
            statements.append(str(execution.statement.compile(dialect=postgresql.dialect())))

    # Observe the real helper's ORM statement. This verifies emitted lock semantics,
    # not PostgreSQL runtime concurrency, which belongs in its integration environment.
    event.listen(Session, "do_orm_execute", capture_refresh)
    try:
        with SessionLocal() as db:
            org = db.get(Organization, organization_id)
            subscriptions.lock_organization_for_write(db, org)
            db.rollback()
    finally:
        event.remove(Session, "do_orm_execute", capture_refresh)
    assert any("FOR NO KEY UPDATE" in statement for statement in statements)
