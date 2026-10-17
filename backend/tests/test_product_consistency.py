"""Cross-module regressions for tenant state, quotas, cases and knowledge lifecycle.

API fixtures and real disposable SQL transactions exercise contract edge cases such
as omitted versus null fields, expired reservations and late worker completion."""

from datetime import UTC, datetime, timedelta

import pytest

from app.db import SessionLocal
from app.models import (
    ConversationLog,
    Document,
    IngestionJob,
    Organization,
    QuestionReservation,
    SupportCase,
    User,
    VectorChunk,
)


def tenant_id(headers):
    """Resolve a fixture authorization header to its owning organization ID for direct SQL assertions."""
    from app.security import decode_access_token

    with SessionLocal() as db:
        actor = db.get(User, decode_access_token(headers["Authorization"].split()[1])["sub"])
        return actor.org_id


def case_fixture(headers):
    """Persist a synthetic conversation and its support case, returning IDs for real API state-transition tests."""
    with SessionLocal() as db:
        conversation = ConversationLog(
            org_id=tenant_id(headers),
            channel="widget",
            visitor_id="fixture-visitor",
            question="Unsupported question",
            answer="Please contact support",
            resolved=False,
            needs_human=True,
        )
        db.add(conversation)
        db.flush()
        case = SupportCase(org_id=conversation.org_id, conversation_id=conversation.id)
        db.add(case)
        db.commit()
        return case.id


def pending_document(headers, *, job_type="text"):
    """Create a pending document/job owned by the fixture tenant and return the persisted pair for lifecycle races."""
    with SessionLocal() as db:
        document = Document(org_id=tenant_id(headers), title="Queued guide", source="guide.txt", source_type="file")
        db.add(document)
        db.flush()
        job = IngestionJob(
            org_id=document.org_id,
            document_id=document.id,
            job_type=job_type,
            raw_text="A useful support guide with adequate readable content.",
            payload={},
        )
        db.add(job)
        db.commit()
        return document.id, job.id


def test_persisted_api_timestamps_have_an_explicit_utc_offset(client, auth_headers):
    """Require persisted API timestamps to identify UTC explicitly rather than leaving browser timezone interpretation
    ambiguous.
    """
    created = client.get("/api/v1/auth/me", headers=auth_headers).json()["created_at"]
    assert datetime.fromisoformat(created.replace("Z", "+00:00")).utcoffset() == timedelta(0)


@pytest.mark.parametrize("question", ["  ", "\n\t", " x "])
def test_chat_validates_the_trimmed_question(client, auth_headers, question):
    """Validate normalized questions so whitespace cannot satisfy the minimum meaningful-input length."""
    response = client.post("/api/v1/chat", headers=auth_headers, json={"question": question})
    assert response.status_code == 422


def test_resolution_requires_a_readable_human_answer(client, auth_headers):
    """Prevent resolved cases with blank/whitespace human replies, preserving the visitor follow-up contract."""
    case_id = case_fixture(auth_headers)
    response = client.patch(
        f"/api/v1/support-cases/{case_id}/resolve", headers=auth_headers, json={"human_answer": " \n\t "}
    )
    assert response.status_code == 422
    assert client.get(f"/api/v1/support-cases/{case_id}", headers=auth_headers).json()["status"] == "open"


def test_an_unaccepted_agent_cannot_be_assigned_a_case(client, auth_headers):
    """Exclude users awaiting initial-password acceptance from active case assignment even when their account is
    enabled.
    """
    case_id = case_fixture(auth_headers)
    member = client.post(
        "/api/v1/team/users", headers=auth_headers, json={"email": "pending@example.com", "role": "support_agent"}
    ).json()
    response = client.patch(
        f"/api/v1/support-cases/{case_id}/assign", headers=auth_headers, json={"assigned_to_user_id": member["id"]}
    )
    assert response.status_code == 400


def test_explicit_null_unassigns_while_omission_assigns_to_self(client, auth_headers):
    """Preserve the PATCH distinction between explicit null (unassign) and omitted assignee (assign to the current
    support user).
    """
    case_id = case_fixture(auth_headers)
    path = f"/api/v1/support-cases/{case_id}/assign"
    assert client.patch(path, headers=auth_headers, json={}).json()["assigned_to_user_id"]
    assert (
        client.patch(path, headers=auth_headers, json={"assigned_to_user_id": None}).json()["assigned_to_user_id"]
        is None
    )


def test_clarifications_are_not_counted_as_human_escalations(client, auth_headers):
    """Keep clarification turns separate from human-support escalation counts and Inbox case creation."""
    with SessionLocal() as db:
        for human in (True, False):
            db.add(
                ConversationLog(
                    org_id=tenant_id(auth_headers),
                    channel="widget",
                    question="Which subject?",
                    outcome="escalated" if human else "clarification",
                    answer="More information needed",
                    resolved=False,
                    needs_human=human,
                )
            )
        db.commit()
    summary = client.get("/api/v1/analytics/summary", headers=auth_headers).json()
    assert summary["total_questions"] == 2
    assert summary["unresolved_questions"] == 1
    assert len(summary["unanswered_questions"]) == 1
    assert summary["frequent_unresolved"] == [{"question": "Which subject?", "count": 1}]


def test_paid_subscription_exposes_its_effective_expiration(client, auth_headers):
    """Expose the commercial period's effective expiry consistently to usage and protected chat consumers."""
    with SessionLocal() as db:
        org = db.get(Organization, tenant_id(auth_headers))
        org.subscription_plan = "pro"
        org.subscription_status = "active"
        org.subscription_ends_at = datetime.now(UTC) - timedelta(days=1)
        db.commit()
    response = client.get("/api/v1/settings/subscription", headers=auth_headers)
    assert response.status_code == 200
    assert response.json().get("subscription_ends_at")
    assert response.json().get("effective_status") == "expired"
    assert client.post("/api/v1/chat", headers=auth_headers, json={"question": "Hello"}).status_code == 402


def test_suspended_admin_can_read_billing_but_cannot_chat(client, auth_headers):
    """Retain renewal/usage visibility for a suspended tenant administrator while blocking workspace consumption."""
    with SessionLocal() as db:
        db.get(Organization, tenant_id(auth_headers)).subscription_status = "suspended"
        db.commit()
    assert client.get("/api/v1/settings/subscription", headers=auth_headers).status_code == 200
    assert client.post("/api/v1/chat", headers=auth_headers, json={"question": "Hello"}).status_code == 403


def test_deleted_document_cancels_queued_work_without_losing_deleted_state(client, auth_headers):
    """Cancel durable jobs and remove searchable chunks when a document is deleted, preserving terminal deletion
    metadata.
    """
    from app.services.ingestion_jobs import process_next_ingestion_job

    document_id, job_id = pending_document(auth_headers)
    assert client.delete(f"/api/v1/documents/{document_id}", headers=auth_headers).status_code == 204
    process_next_ingestion_job("fixture-worker")
    with SessionLocal() as db:
        assert db.get(Document, document_id).status == "deleted"
        job = db.get(IngestionJob, job_id)
        assert job.status == "cancelled" and job.raw_text is None


def test_late_indexing_error_does_not_resurrect_deleted_state(client, auth_headers):
    """Ensure delayed indexing failure cannot replace a concurrently deleted document's terminal state."""
    from app.services.ingestion import IngestionError, mark_document_failed

    document_id, _ = pending_document(auth_headers)
    client.delete(f"/api/v1/documents/{document_id}", headers=auth_headers)
    with SessionLocal() as db:
        document = mark_document_failed(db, db.get(Document, document_id), IngestionError("Late worker error"))
        assert document.status == "deleted" and document.is_active is False


def test_archived_organization_does_not_fetch_a_queued_source(client, auth_headers, monkeypatch):
    """Cancel archived-tenant work before fetching its source so archive restrictions apply to background processing
    too.
    """
    from app.services.ingestion_jobs import process_next_ingestion_job

    _, job_id = pending_document(auth_headers, job_type="url")
    calls = []
    monkeypatch.setattr(
        "app.services.ingestion_jobs.resolve_job_text", lambda *_: calls.append(True) or "Readable content"
    )
    with SessionLocal() as db:
        db.get(Organization, tenant_id(auth_headers)).archived_at = datetime.now(UTC)
        db.commit()
    process_next_ingestion_job("fixture-worker")
    assert calls == []
    with SessionLocal() as db:
        assert db.get(IngestionJob, job_id).status == "cancelled"


def test_document_usage_counts_one_document_per_answer(client, auth_headers):
    """Count document usage once per answer even when multiple cited chunks came from the same document."""
    with SessionLocal() as db:
        doc = Document(org_id=tenant_id(auth_headers), title="Guide", source="guide.txt", source_type="file")
        db.add(doc)
        db.flush()
        db.add(
            ConversationLog(
                org_id=doc.org_id,
                channel="widget",
                question="Guide summary?",
                outcome="answered",
                answer="Answer",
                resolved=True,
                needs_human=False,
                sources=[{"document_id": doc.id, "chunk_index": 0}, {"document_id": doc.id, "chunk_index": 1}],
            )
        )
        db.commit()
    summary = client.get("/api/v1/analytics/summary", headers=auth_headers).json()
    assert summary["top_documents"][0]["count"] == 1


def test_question_admission_counts_inflight_and_releases_failed_work(client, auth_headers, monkeypatch):
    """Include in-flight questions in quota admission and release their reservations when generation fails."""
    from dataclasses import replace

    from fastapi import HTTPException
    from sqlalchemy import func, select

    from app.services import subscriptions

    monkeypatch.setitem(subscriptions.PLANS, "trial", replace(subscriptions.PLANS["trial"], max_questions_per_month=1))
    with SessionLocal() as db:
        org = db.get(Organization, tenant_id(auth_headers))
        with pytest.raises(RuntimeError):
            with subscriptions.reserve_question_quota(db, org):
                with SessionLocal() as other:
                    with pytest.raises(HTTPException) as blocked:
                        with subscriptions.reserve_question_quota(other, other.get(Organization, org.id)):
                            pytest.fail("Second request should have been blocked")
                    assert blocked.value.status_code == 402
                raise RuntimeError("Generation failed before logging")
        assert db.scalar(select(func.count(QuestionReservation.id))) == 0
        with subscriptions.reserve_question_quota(db, org):
            assert db.scalar(select(func.count(QuestionReservation.id))) == 1


def test_successful_chat_atomically_consumes_its_reservation(client, auth_headers):
    """Commit a successful conversation and consume its quota slot together so usage is neither lost nor double-
    counted.
    """
    from sqlalchemy import func, select

    assert client.post("/api/v1/chat", headers=auth_headers, json={"question": "Hello"}).status_code == 200
    with SessionLocal() as db:
        assert db.scalar(select(func.count(QuestionReservation.id))) == 0
        assert db.scalar(select(func.count(ConversationLog.id))) == 1


def test_expired_question_reservation_does_not_block_new_work(client, auth_headers):
    """Ignore/clean expired crash-recovery slots so abandoned requests do not permanently consume quota."""
    from sqlalchemy import select

    from app.services.subscriptions import reserve_question_quota

    with SessionLocal() as db:
        org = db.get(Organization, tenant_id(auth_headers))
        db.add(QuestionReservation(org_id=org.id, expires_at=datetime.now(UTC) - timedelta(minutes=1)))
        db.commit()
        with reserve_question_quota(db, org) as reservation_id:
            assert list(db.scalars(select(QuestionReservation.id))) == [reservation_id]


def test_legacy_trial_without_deadline_is_not_unlimited(client, auth_headers):
    """Derive the bounded trial deadline from legacy creation time when an explicit trial expiry is absent."""
    with SessionLocal() as db:
        org = db.get(Organization, tenant_id(auth_headers))
        org.created_at = datetime.now(UTC) - timedelta(days=15)
        org.trial_ends_at = None
        db.commit()
    result = client.get("/api/v1/settings/subscription", headers=auth_headers).json()
    assert result["effective_status"] == "expired" and result["is_active"] is False
    assert result["trial_ends_at"]


def test_vector_writes_share_the_callers_transaction(client, auth_headers):
    """Roll back relational and vector writes together, proving the vector store honors the caller-owned transaction."""
    from sqlalchemy import func, select

    from app.services.vector_store import DatabaseVectorStore

    document_id, _ = pending_document(auth_headers)
    with SessionLocal() as db:
        document = db.get(Document, document_id)
        DatabaseVectorStore().upsert_chunks(
            org_id=document.org_id,
            document_id=document.id,
            title=document.title,
            source=document.source,
            chunks=["A readable support guide."],
            embeddings=[[0.0] * 384],
            db=db,
        )
        assert db.scalar(select(func.count(VectorChunk.id))) == 1
        db.rollback()
        assert db.scalar(select(func.count(VectorChunk.id))) == 0


def test_obsolete_worker_cannot_finish_or_overwrite_its_successor(client, auth_headers):
    """Reject a former worker's completion and error updates after another lease owns the same job."""
    from app.services.ingestion_jobs import claim_next_job, mark_job_finished, process_claimed_job

    document_id, job_id = pending_document(auth_headers)
    first = claim_next_job("old-worker")
    with SessionLocal() as db:
        db.get(IngestionJob, job_id).locked_at = datetime.now(UTC) - timedelta(minutes=16)
        db.commit()
    successor = claim_next_job("new-worker")
    assert successor.attempts == first.attempts + 1
    process_claimed_job(job_id, expected_attempt=first.attempts, expected_locked_at=first.locked_at)
    with SessionLocal() as db:
        mark_job_finished(
            db, db.get(IngestionJob, job_id), status="failed", expected_attempt=first.attempts,
            expected_locked_at=first.locked_at,
        )
        assert db.get(IngestionJob, job_id).locked_by == "new-worker"
    process_claimed_job(job_id, expected_attempt=successor.attempts, expected_locked_at=successor.locked_at)
    with SessionLocal() as db:
        assert db.get(Document, document_id).status == "indexed"
        assert db.get(IngestionJob, job_id).status == "completed"


def test_deletion_during_embedding_cannot_republish_chunks(client, auth_headers, monkeypatch):
    """Delete the document during controlled inference and require the final indexing commit to leave it
    unsearchable.
    """
    from app.services.embeddings import get_embedding_service
    from app.services.ingestion_jobs import process_next_ingestion_job
    from app.services.vector_store import get_vector_store

    document_id, job_id = pending_document(auth_headers)
    original = get_embedding_service().embed_texts

    def delete_while_embedding(chunks):
        """Perform the competing deletion before returning fixture vectors, exposing the post-inference lifecycle
        check.
        """
        assert client.delete(f"/api/v1/documents/{document_id}", headers=auth_headers).status_code == 204
        return original(chunks)

    monkeypatch.setattr(get_embedding_service(), "embed_texts", delete_while_embedding)
    process_next_ingestion_job("slow-worker")
    with SessionLocal() as db:
        assert db.get(Document, document_id).status == "deleted"
        assert db.get(IngestionJob, job_id).status == "cancelled"
    assert not get_vector_store().items


@pytest.mark.parametrize(
    "schema,payload",
    [
        ("OrganizationCreate", {"name": "  ", "admin_name": "Admin", "admin_email": "a@example.com"}),
        ("PeriodAdjustment", {"days": 1, "reason": "   "}),
        ("RefundCreate", {"amount_minor": 1, "note": "   ", "idempotency_key": "00000000-0000-0000-0000-000000000001"}),
        ("MailCampaign", {"subject": "Valid subject", "message": " " * 20}),
        ("MailCampaign", {"subject": "Valid subject\n", "message": "A valid message"}),
    ],
)
def test_admin_commands_reject_empty_business_text(schema, payload):
    """Reject blank business reasons/names/answers at schema validation instead of persisting semantically empty
    commands.
    """
    from pydantic import ValidationError

    from app import admin_schemas

    with pytest.raises(ValidationError):
        getattr(admin_schemas, schema).model_validate(payload)
