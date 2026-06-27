from __future__ import annotations

import asyncio
import logging
import socket
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import SessionLocal
from app.models import Document, IngestionJob, Organization
from app.services.ingestion import IngestionService, extract_text_from_url

logger = logging.getLogger(__name__)
settings = get_settings()


def enqueue_text_ingestion(db: Session, *, org: Organization, document: Document, raw_text: str) -> IngestionJob:
    document.status = "processing"
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


def enqueue_url_ingestion(db: Session, *, org: Organization, document: Document, url: str) -> IngestionJob:
    document.status = "processing"
    job = IngestionJob(
        org_id=org.id,
        document_id=document.id,
        job_type="url",
        status="pending",
        payload={"url": url},
    )
    db.add(document)
    db.add(job)
    db.commit()
    db.refresh(document)
    db.refresh(job)
    return job


def process_next_ingestion_job(worker_id: str | None = None) -> bool:
    worker_id = worker_id or socket.gethostname()
    job = claim_next_job(worker_id)
    if job is None:
        return False
    process_claimed_job(job.id)
    return True


def claim_next_job(worker_id: str) -> IngestionJob | None:
    stale_cutoff = datetime.now(UTC) - timedelta(minutes=15)
    with SessionLocal() as db:
        stale_jobs = db.scalars(
            select(IngestionJob).where(
                IngestionJob.status == "processing",
                IngestionJob.locked_at < stale_cutoff,
                IngestionJob.attempts < settings.ingestion_job_max_attempts,
            )
        )
        for stale_job in stale_jobs:
            stale_job.status = "pending"
            stale_job.locked_by = None
            stale_job.locked_at = None

        job = db.scalar(
            select(IngestionJob)
            .where(
                IngestionJob.status == "pending",
                IngestionJob.attempts < settings.ingestion_job_max_attempts,
            )
            .order_by(IngestionJob.created_at)
            .with_for_update(skip_locked=True)
        )
        if job is None:
            db.commit()
            return None
        job.status = "processing"
        job.locked_by = worker_id
        job.locked_at = datetime.now(UTC)
        job.attempts += 1
        db.add(job)
        db.commit()
        db.refresh(job)
        return job


def process_claimed_job(job_id: str) -> None:
    with SessionLocal() as db:
        job = db.get(IngestionJob, job_id)
        if job is None:
            return
        document = db.get(Document, job.document_id)
        org = db.get(Organization, job.org_id)
        if document is None or org is None or not document.is_active:
            mark_job_finished(db, job, status="cancelled")
            return

        try:
            raw_text = resolve_job_text(job, document)
            IngestionService().ingest_text(db=db, org=org, document=document, raw_text=raw_text)
            mark_job_finished(db, job, status="completed")
        except Exception as exc:
            logger.exception("Failed to process ingestion job %s", job.id)
            job.error_message = str(exc)[:1000]
            if job.attempts >= settings.ingestion_job_max_attempts:
                job.status = "failed"
                document.status = "failed"
                document.error_message = job.error_message
                db.add(document)
            else:
                job.status = "pending"
            job.locked_by = None
            job.locked_at = None
            db.add(job)
            db.commit()


def resolve_job_text(job: IngestionJob, document: Document) -> str:
    if job.job_type == "text":
        if not job.raw_text:
            raise ValueError("Text ingestion job is missing raw_text")
        return job.raw_text
    if job.job_type == "url":
        url = str(job.payload.get("url") or document.source)
        text, extracted_title = asyncio.run(extract_text_from_url(url))
        if extracted_title:
            document.title = extracted_title[:255]
        return text
    raise ValueError(f"Unsupported ingestion job type: {job.job_type}")


def mark_job_finished(db: Session, job: IngestionJob, *, status: str) -> None:
    job.status = status
    job.locked_by = None
    job.locked_at = None
    job.completed_at = datetime.now(UTC)
    db.add(job)
    db.commit()
