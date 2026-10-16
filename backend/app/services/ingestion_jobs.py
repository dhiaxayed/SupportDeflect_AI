"""Durable ingestion admission, atomic worker claims and fenced completion/retry state.

Enqueue helpers commit document admission with durable work; worker helpers own
their sessions. Attempt plus UTC lock timestamp fences old workers after retries,
while document-before-job locking keeps lifecycle mutations consistent.
"""

from __future__ import annotations

import asyncio
import logging
import socket
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import SessionLocal
from app.models import Document, IngestionJob, Organization
from app.services.ingestion import (
    IngestionError,
    IngestionService,
    extract_text_from_url,
    ingestion_error_message,
    ingestion_lease_matches,
    lock_document_for_write,
)

logger = logging.getLogger(__name__)
settings = get_settings()


def enqueue_text_ingestion(db: Session, *, org: Organization, document: Document, raw_text: str) -> IngestionJob:
    """Commit the pending document and its durable extracted-text job, then return the job.

    The caller supplies authorized org/document ownership and parsed text. This
    helper owns the session commit so a successful upload cannot lose its queued
    payload between the document insert and worker admission.
    """
    document.status = "pending"
    job = IngestionJob(
        org_id=org.id,
        document_id=document.id,
        job_type="text",
        status="pending",
        payload={"source": document.source},
        raw_text=raw_text,
    )
    db.add(document)
    db.add(job)
    db.commit()
    db.refresh(document)
    db.refresh(job)
    return job


def enqueue_url_ingestion(
    db: Session, *, org: Organization, document: Document, url: str, use_extracted_title: bool = True
) -> IngestionJob:
    """Commit a pending document and URL job with its automatic-title preference.

    The route must validate/authorize the source before admission; the worker
    revalidates it on fetch. No download occurs here. Document and job share this
    commit, preserving custom titles across asynchronous execution.
    """
    document.status = "pending"
    job = IngestionJob(
        org_id=org.id,
        document_id=document.id,
        job_type="url",
        status="pending",
        payload={"url": url, "use_extracted_title": use_extracted_title},
    )
    db.add(document)
    db.add(job)
    db.commit()
    db.refresh(document)
    db.refresh(job)
    return job


def process_next_ingestion_job(worker_id: str | None = None) -> bool:
    """Claim and process at most one job, returning False only when none is claimable.

    worker_id defaults to the host name. True means work was claimed, not that
    indexing succeeded: processing may retry, fail or cancel. Worker helpers own
    their sessions; claim/database failures outside handled processing propagate.
    """
    worker_id = worker_id or socket.gethostname()
    job = claim_next_job(worker_id)
    if job is None:
        return False
    process_claimed_job(job.id, expected_attempt=job.attempts, expected_locked_at=job.locked_at)
    return True


def claim_next_job(worker_id: str) -> IngestionJob | None:
    """Recover expired leases and return an exclusively claimed pending job or None.

    The helper owns its sessions, increments attempts and commits worker/time
    identity before returning a refreshed detached row. PostgreSQL skips locked rows;
    a conditional update also prevents duplicate SQLite claims. Contention losers
    retry selection rather than assuming the initial read granted ownership.
    """
    stale_cutoff = datetime.now(UTC) - timedelta(minutes=15)
    recover_stale_jobs(stale_cutoff)
    with SessionLocal() as db:
        while True:
            job = db.scalar(
                select(IngestionJob)
                .where(
                    IngestionJob.status == "pending",
                    IngestionJob.attempts < settings.ingestion_job_max_attempts,
                )
                .order_by(IngestionJob.created_at, IngestionJob.id)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
            if job is None:
                db.commit()
                return None
            # SQLite does not implement FOR UPDATE/SKIP LOCKED. Conditional update
            # is the claim authority on both databases; a loser tries another row.
            claimed = db.execute(
                update(IngestionJob)
                .where(
                    IngestionJob.id == job.id,
                    IngestionJob.status == "pending",
                    IngestionJob.attempts == job.attempts,
                )
                .values(
                    status="processing",
                    locked_by=worker_id,
                    locked_at=datetime.now(UTC),
                    attempts=IngestionJob.attempts + 1,
                )
                .execution_options(synchronize_session=False)
            )
            if claimed.rowcount != 1:
                db.rollback()
                continue
            db.commit()
            db.refresh(job)
            return job


def recover_stale_jobs(cutoff: datetime) -> None:
    """Recheck processing leases older than cutoff and commit each eligible recovery.

    Lock document before job, reserving the SQLite writer before the reread.
    Deleted documents cancel and scrub payloads; active jobs requeue below the
    attempt limit or fail after exhaustion. A refreshed lease is never overwritten.
    """
    with SessionLocal() as db:
        candidates = list(
            db.execute(
                select(IngestionJob.id, IngestionJob.document_id, IngestionJob.org_id).where(
                    IngestionJob.status == "processing",
                    IngestionJob.locked_at < cutoff,
                )
            )
        )
    # Lock document before job, as in deletion/completion. Recheck after waiting:
    # another worker may already have completed or renewed the observed lease.
    for job_id, document_id, org_id in candidates:
        with SessionLocal() as db:
            document = lock_document_for_write(db, document_id=document_id, org_id=org_id)
            job = db.scalar(select(IngestionJob).where(IngestionJob.id == job_id).with_for_update())
            if not job or job.status != "processing" or not job.locked_at or job.locked_at >= cutoff:
                continue
            if not document or not document.is_active:
                job.status, job.raw_text, job.error_message = "cancelled", None, None
                job.completed_at = datetime.now(UTC)
            else:
                job.status = "pending" if job.attempts < settings.ingestion_job_max_attempts else "failed"
                document.status = job.status
                if job.status == "failed":
                    job.error_message = "Worker lease expired after maximum attempts"
                    document.error_message = job.error_message
            job.locked_by, job.locked_at = None, None
            db.commit()


def process_claimed_job(job_id: str, *, expected_attempt: int, expected_locked_at: datetime) -> None:
    """Process only the job generation matching the supplied attempt and UTC lock time.

    Own the session, cancel ineligible/deleted/archived work, then release lifecycle
    locks before URL download or embedding. Successful ingestion commits completion.
    Handled errors roll back and recheck ownership before requeue/failure; obsolete
    workers cannot replace their successor's state. Database recovery failures propagate.
    """
    with SessionLocal() as db:
        job = db.get(IngestionJob, job_id)
        if job is None or not ingestion_lease_matches(
            job, expected_attempt=expected_attempt, expected_locked_at=expected_locked_at
        ):
            return
        document = lock_document_for_write(db, document_id=job.document_id, org_id=job.org_id)
        org = db.get(Organization, job.org_id)
        db.refresh(job, with_for_update=True)
        if not ingestion_lease_matches(job, expected_attempt=expected_attempt, expected_locked_at=expected_locked_at):
            db.commit()
            return
        if document is None or org is None or not document.is_active or org.archived_at:
            mark_job_finished(
                db, job, status="cancelled", expected_attempt=expected_attempt, expected_locked_at=expected_locked_at
            )
            return

        try:
            from app.services.subscriptions import ensure_subscription_active

            ensure_subscription_active(org)
            document.status = "processing"
            db.commit()
            raw_text = resolve_job_text(job, document)
            result = IngestionService().ingest_text(
                db=db,
                org=org,
                document=document,
                raw_text=raw_text,
                job=job,
                expected_attempt=expected_attempt,
                expected_locked_at=expected_locked_at,
                document_title=document.title,
            )
            if result.status != "indexed":
                raise IngestionError(result.error_message or "Document indexing failed")
        except Exception as exc:
            db.rollback()
            document = lock_document_for_write(db, document_id=document.id, org_id=document.org_id)
            db.refresh(job, with_for_update=True)
            if not document.is_active or not ingestion_lease_matches(
                job, expected_attempt=expected_attempt, expected_locked_at=expected_locked_at
            ):
                db.commit()
                return
            logger.error("Ingestion job failed: job=%s error_type=%s", job_id, type(exc).__name__)
            job.error_message = ingestion_error_message(exc)
            document.error_message = job.error_message
            if job.attempts >= settings.ingestion_job_max_attempts:
                job.status = "failed"
                document.status = "failed"
                document.error_message = job.error_message
                db.add(document)
            else:
                job.status = "pending"
                document.status = "pending"
            job.locked_by = None
            job.locked_at = None
            db.add(job)
            db.commit()


def resolve_job_text(job: IngestionJob, document: Document) -> str:
    """Return stored text or synchronously fetch the queued URL for the worker.

    URL work runs its async fetcher in a worker-owned event loop and may set an
    uncommitted extracted title; custom/legacy titles are preserved. Missing text
    or unknown job types raise ValueError; fetch errors propagate for worker retry.
    This helper neither commits nor runs safely inside an already running event loop.
    """
    if job.job_type == "text":
        if not job.raw_text:
            raise ValueError("Text ingestion job is missing raw_text")
        return job.raw_text
    if job.job_type == "url":
        url = str(job.payload.get("url") or document.source)
        text, extracted_title = asyncio.run(extract_text_from_url(url))
        # Legacy jobs have no title flag. Their URL-valued title identifies the
        # default; preserve any custom title selected before this flag existed.
        use_extracted_title = job.payload.get("use_extracted_title", document.title == url[:255])
        if extracted_title and use_extracted_title:
            document.title = extracted_title[:255]
        return text
    raise ValueError(f"Unsupported ingestion job type: {job.job_type}")


def mark_job_finished(
    db: Session, job: IngestionJob, *, status: str, expected_attempt: int, expected_locked_at: datetime
) -> None:
    """Commit terminal job state only while the supplied lease still matches.

    Acquire document before job, including SQLite write reservation. A stale
    caller exits without changing state; completion clears errors, cancellation
    also scrubs stored text, and every accepted transition clears the active lease.
    """
    lock_document_for_write(db, document_id=job.document_id, org_id=job.org_id)
    db.refresh(job, with_for_update=True)
    if not ingestion_lease_matches(job, expected_attempt=expected_attempt, expected_locked_at=expected_locked_at):
        db.commit()
        return
    job.status = status
    job.locked_by = None
    job.locked_at = None
    job.completed_at = datetime.now(UTC)
    if status == "completed":
        job.error_message = None
    elif status == "cancelled":
        job.raw_text = None
        job.error_message = None
    db.add(job)
    db.commit()
