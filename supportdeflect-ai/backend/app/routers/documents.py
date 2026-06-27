from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import get_db
from app.deps import get_current_org
from app.models import Document, Organization
from app.schemas import DocumentOut, DocumentUrlRequest
from app.services.ingestion import IngestionService, extract_text_from_file, validate_public_http_url
from app.services.ingestion_jobs import enqueue_text_ingestion, enqueue_url_ingestion
from app.services.subscriptions import enforce_document_quota
from app.services.vector_store import get_vector_store

router = APIRouter(prefix="/documents", tags=["documents"])
settings = get_settings()

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".markdown"}


@router.get("", response_model=list[DocumentOut])
def list_documents(
    db: Session = Depends(get_db),
    org: Organization = Depends(get_current_org),
) -> list[Document]:
    return list(
        db.scalars(
            select(Document)
            .where(Document.org_id == org.id, Document.is_active.is_(True))
            .order_by(desc(Document.created_at))
        )
    )


@router.post("/upload", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    org: Organization = Depends(get_current_org),
) -> Document:
    content = await file.read(settings.max_upload_bytes + 1)
    validate_upload(file, content)
    enforce_document_quota(db, org, upload_size=len(content))
    document = Document(
        org_id=org.id,
        title=file.filename or "Uploaded document",
        source_type="file",
        source=file.filename or "uploaded-file",
        mime_type=file.content_type,
        status="pending",
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    text = extract_text_from_file(file.filename or "document.txt", content, file.content_type)
    if settings.ingestion_mode.lower() == "inline":
        return IngestionService().ingest_text(db=db, org=org, document=document, raw_text=text)
    enqueue_text_ingestion(db, org=org, document=document, raw_text=text)
    db.refresh(document)
    return document


@router.post("/url", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def index_url(
    payload: DocumentUrlRequest,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_current_org),
) -> Document:
    url = str(payload.url)
    validate_public_http_url(url)
    enforce_document_quota(db, org, upload_size=0)
    document = Document(
        org_id=org.id,
        title=payload.title or url,
        source_type="url",
        source=url,
        mime_type="text/html",
        status="pending",
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    if settings.ingestion_mode.lower() == "inline":
        from app.services.ingestion import extract_text_from_url

        text, extracted_title = await extract_text_from_url(url)
        if not payload.title and extracted_title:
            document.title = extracted_title[:255]
            db.add(document)
            db.commit()
            db.refresh(document)
        return IngestionService().ingest_text(db=db, org=org, document=document, raw_text=text)
    enqueue_url_ingestion(db, org=org, document=document, url=url)
    db.refresh(document)
    return document


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: str,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_current_org),
) -> None:
    document = db.scalar(
        select(Document).where(Document.id == document_id, Document.org_id == org.id, Document.is_active.is_(True))
    )
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    get_vector_store().delete_by_document(org_id=org.id, document_id=document.id)
    document.status = "deleted"
    document.is_active = False
    db.add(document)
    db.commit()
    return None


def validate_upload(file: UploadFile, content: bytes) -> None:
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
