"""Tenant knowledge imports and deletion; blocking parsing/inference runs in API worker threads."""

import asyncio
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import desc, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import get_db
from app.deps import get_tenant_admin_org
from app.models import Document, IngestionJob, Organization
from app.schemas import DocumentOut, DocumentUrlRequest
from app.services.ingestion import (
    IngestionError,
    IngestionService,
    extract_text_from_file,
    extract_text_from_url,
    mark_document_failed,
    validate_public_http_url,
)
from app.services.ingestion_jobs import enqueue_text_ingestion, enqueue_url_ingestion
from app.services.subscriptions import enforce_document_quota, get_plan
from app.services.vector_store import get_vector_store

router = APIRouter(prefix="/documents", tags=["documents"])
settings = get_settings()

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".markdown"}


@router.get("", response_model=list[DocumentOut])
def list_documents(
    db: Session = Depends(get_db),
    org: Organization = Depends(get_tenant_admin_org),
) -> list[Document]:
    """Read active document metadata belonging to the authenticated administrator's organization, newest first;
    deleted rows and other tenants' knowledge remain excluded.
    """
    return list(
        db.scalars(
            select(Document)
            .where(Document.org_id == org.id, Document.is_active.is_(True))
            .order_by(desc(Document.created_at))
        )
    )


@router.post("/upload", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
def upload_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    org: Organization = Depends(get_tenant_admin_org),
) -> Document:
    # FastAPI dispatches synchronous routes to its worker pool. PDF parsing, SQLAlchemy
    # and native embedding inference must not stall the ASGI event loop for other visitors.
    """Bound/read and validate the uploaded file, extract text off the event loop, then reserve tenant document
    quota. Persist its metadata with a queued text job or commit before inline indexing; parsing/quota failures
    produce bounded HTTP errors.
    """
    content = file.file.read(min(settings.max_upload_bytes, get_plan(org).max_upload_bytes) + 1)
    validate_upload(file, content)
    try:
        text = extract_text_from_file(file.filename or "document.txt", content, file.content_type)
    except IngestionError as exc:
        raise HTTPException(400, str(exc)) from exc
    # Parse before reserving quota so a slow PDF cannot hold the tenant's write lock.
    enforce_document_quota(db, org, upload_size=len(content))
    document = Document(
        org_id=org.id,
        title=(file.filename or "Uploaded document")[:255],
        source_type="file",
        source=file.filename or "uploaded-file",
        mime_type=file.content_type,
        status="pending",
    )
    db.add(document)
    db.flush()

    if settings.ingestion_mode.lower() == "inline":
        db.commit()
        db.refresh(document)
        return IngestionService().ingest_text(db=db, org=org, document=document, raw_text=text)
    enqueue_text_ingestion(db, org=org, document=document, raw_text=text)
    db.refresh(document)
    return document


@router.post("/url", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
def index_url(
    payload: DocumentUrlRequest,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_tenant_admin_org),
) -> Document:
    """Validate payload's public URL and tenant document quota, then create URL knowledge with optional custom
    title. Queue atomically or fetch/index inline after commit; inline fetch errors persist a sanitized failed
    document rather than losing its identity.
    """
    url = str(payload.url)
    try:
        validate_public_http_url(url)
    except IngestionError as exc:
        raise HTTPException(400, str(exc)) from exc
    enforce_document_quota(db, org, upload_size=0)
    document = Document(
        org_id=org.id,
        title=payload.title or url[:255],
        source_type="url",
        source=url,
        mime_type="text/html",
        status="pending",
    )
    db.add(document)
    db.flush()

    if settings.ingestion_mode.lower() == "inline":
        db.commit()
        db.refresh(document)
        try:
            text, extracted_title = asyncio.run(extract_text_from_url(url))
        except Exception as exc:
            return mark_document_failed(db, document, exc)
        if not payload.title and extracted_title:
            document.title = extracted_title[:255]
            db.add(document)
            db.commit()
            db.refresh(document)
        return IngestionService().ingest_text(db=db, org=org, document=document, raw_text=text)
    enqueue_url_ingestion(db, org=org, document=document, url=url, use_extracted_title=not bool(payload.title))
    db.refresh(document)
    return document


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: str,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_tenant_admin_org),
) -> None:
    """Select an active tenant document or raise 404, delete vectors and cancel/scrub jobs in one committed delete.

    PostgreSQL honors the requested row lock; SQLite serializes the subsequent writes instead.
    Return no body; persisted document identity remains while retrieval eligibility is removed.
    """
    document = db.scalar(
        select(Document)
        .where(Document.id == document_id, Document.org_id == org.id, Document.is_active.is_(True))
        .with_for_update()
    )
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    get_vector_store().delete_by_document(org_id=org.id, document_id=document.id, db=db)
    db.execute(
        update(IngestionJob)
        .where(IngestionJob.document_id == document.id, IngestionJob.org_id == org.id)
        .values(
            status="cancelled",
            raw_text=None,
            locked_at=None,
            locked_by=None,
            completed_at=datetime.now(UTC),
            error_message=None,
        )
    )
    document.status = "deleted"
    document.is_active = False
    document.chunk_count = 0
    document.indexed_at = None
    document.error_message = None
    db.add(document)
    db.commit()
    return None


def validate_upload(file: UploadFile, content: bytes) -> None:
    """Check content length, filename extension and accepted MIME policy without writing or parsing the document.
    Raise 413 for size or 400 for unsupported file types; plan quota is enforced separately.
    """
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Maximum size is {settings.max_upload_bytes} bytes.",
        )
    extension = Path(file.filename or "").suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF, TXT and Markdown files are allowed",
        )
    content_type = file.content_type or "application/octet-stream"
    if content_type not in settings.allowed_upload_mime_types and not content_type.startswith("text/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported MIME type")
