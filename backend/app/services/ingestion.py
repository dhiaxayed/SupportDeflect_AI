"""Bounded source extraction and tenant-serialized, lease-fenced knowledge indexing.

Routes/workers supply tenant-owned documents and control whether work is inline
or durable. Parsing and inference precede the short, quota-checked index commit;
URL extraction separately enforces public-network and download-size boundaries.
"""

from __future__ import annotations

import logging
import re
import socket
from datetime import UTC, datetime
from io import BytesIO
from ipaddress import ip_address
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from fastapi import HTTPException
from pypdf import PdfReader
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.datetime import as_utc
from app.models import Document, IngestionJob, Organization
from app.services.embeddings import get_embedding_service
from app.services.subscriptions import ensure_subscription_active, get_plan, lock_organization_for_write
from app.services.vector_store import get_vector_store

logger = logging.getLogger(__name__)
settings = get_settings()

TEXT_EXTENSIONS = {".txt", ".md", ".markdown"}
PDF_EXTENSIONS = {".pdf"}
REDIRECT_STATUSES = {301, 302, 303, 307, 308}


class IngestionError(ValueError):
    """Deliberate ingestion validation failure whose message may be shown to a tenant."""

    pass


class IngestionLeaseLost(Exception):
    """An obsolete worker must not commit output or change its successor's job state."""


def ingestion_lease_matches(
    job: IngestionJob, *, expected_attempt: int | None, expected_locked_at: datetime | None
) -> bool:
    """Return whether a processing job still belongs to the supplied attempt and timestamp.

    Normalize timestamps to UTC before comparison. Both claim values are required
    because a manual retry can reuse an attempt number; this check alone acquires
    no lock and must be repeated inside the lifecycle write transaction.
    """
    # Manual retry resets attempts. The persisted UTC lease timestamp also fences
    # an older generation when its attempt number is reused. Both databases retain
    # microseconds; callers must pass the timestamp read from the successful claim.
    return (
        job.status == "processing"
        and job.attempts == expected_attempt
        and expected_locked_at is not None
        and as_utc(job.locked_at) == as_utc(expected_locked_at)
    )


def lock_document_for_write(db: Session, *, document_id: str, org_id: str) -> Document | None:
    """Lock document before job and reload state for a short lifecycle transaction.

    SQLite needs a write reservation before the read because FOR UPDATE is ignored.
    Keep downloads and inference outside this transaction; PostgreSQL locks only
    the tenant-owned document row rather than the whole database.

    Return the reloaded owned document or None. The caller owns commit/rollback
    and must preserve this document-before-job lock order for subsequent writes.
    """
    owned = (Document.id == document_id, Document.org_id == org_id)
    if db.get_bind().dialect.name == "sqlite":
        db.execute(update(Document).where(*owned).values(id=Document.id).execution_options(synchronize_session=False))
    return db.scalar(
        select(Document).where(*owned).with_for_update().execution_options(populate_existing=True)
    )


def ingestion_error_message(error: Exception) -> str:
    """Return a bounded tenant-safe failure message without exposing arbitrary exceptions.

    Only deliberate IngestionError text is reused; subscription denial becomes a
    generic indexing restriction and provider/database details remain private.
    """
    # Only deliberate validation messages may cross the API boundary. Provider and
    # database exceptions can contain document contents, credentials or local paths.
    if isinstance(error, IngestionError):
        return str(error)[:1000]
    if isinstance(error, HTTPException) and error.status_code == 402:
        return "The organization subscription does not allow indexing."
    return "Document indexing failed. Retry the operation or contact your administrator."


def mark_document_failed(db: Session, document: Document, error: Exception) -> Document:
    """Roll back incomplete inline indexing and commit a sanitized document failure.

    Reload the tenant document under its lifecycle lock; a concurrent soft deletion
    keeps its terminal state. Return the refreshed document, assuming its row still
    exists. This helper owns rollback/commit and is not the queued worker retry path.
    """
    db.rollback()
    document = lock_document_for_write(db, document_id=document.id, org_id=document.org_id)
    if not document.is_active:
        # A late worker error must not overwrite a concurrent deletion's terminal state.
        db.commit()
        return document
    logger.error("Document indexing failed: document=%s error_type=%s", document.id, type(error).__name__)
    document.status = "failed"
    document.error_message = ingestion_error_message(error)
    document.chunk_count = 0
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


class IngestionService:
    """Index parsed tenant text while keeping quota, vector and document state coherent."""

    def ingest_text(
        self,
        db: Session,
        org: Organization,
        document: Document,
        raw_text: str,
        *,
        job: IngestionJob | None = None,
        expected_attempt: int | None = None,
        expected_locked_at: datetime | None = None,
        document_title: str | None = None,
    ) -> Document:
        """Clean, chunk and locally embed text, then atomically publish a document index.

        The supplied org/document must belong together; queued calls also supply their
        claim attempt and UTC timestamp. Expensive inference precedes tenant/document/job
        locking, subscription/quota checks and title publication. Success commits vectors,
        document state and optional job completion together. Lost leases roll back and
        return current document state; other queued failures propagate for worker retry,
        while inline failures are sanitized and committed as document failures.
        Atomic vector rollback requires the persistent store; the explicit test-memory
        implementation does not participate in SQL transactions.
        """
        try:
            text = clean_text(raw_text)
            if len(text) < 20:
                raise IngestionError("Document does not contain enough readable text")
            chunks = chunk_text(text, max_chars=settings.chunk_size, overlap=settings.chunk_overlap)
            if not chunks:
                raise IngestionError("No indexable chunks generated from document")
            embeddings = get_embedding_service().embed_texts(chunks)
            if len(embeddings) != len(chunks) or any(len(v) != settings.embedding_dimension for v in embeddings):
                raise IngestionError("Embedding output does not match the configured vector schema")
            # Expensive inference runs before the short, tenant-serialized write transaction.
            lock_organization_for_write(db, org)
            ensure_subscription_active(org)
            db.refresh(document, with_for_update=True)
            if not document.is_active:
                raise IngestionError("Document was deleted while indexing")
            if job is not None:
                db.refresh(job, with_for_update=True)
                if not ingestion_lease_matches(
                    job, expected_attempt=expected_attempt, expected_locked_at=expected_locked_at
                ):
                    raise IngestionLeaseLost()
            if document_title is not None:
                # Refresh above intentionally discards pre-inference ORM changes. Apply
                # the downloaded title only after confirming the current worker lease.
                document.title = document_title[:255]
            existing = (
                db.scalar(
                    select(func.coalesce(func.sum(Document.chunk_count), 0)).where(
                        Document.org_id == org.id, Document.id != document.id, Document.is_active.is_(True)
                    )
                )
                or 0
            )
            if existing + len(chunks) > get_plan(org).max_chunks:
                raise IngestionError("Knowledge base chunk quota exceeded")
            get_vector_store().upsert_chunks(
                org_id=org.id,
                document_id=document.id,
                title=document.title,
                source=document.source,
                chunks=chunks,
                embeddings=embeddings,
                db=db,
            )
            document.status = "indexed"
            document.chunk_count = len(chunks)
            document.error_message = None
            document.indexed_at = datetime.now(UTC)
            if job is not None:
                job.status = "completed"
                job.locked_by, job.locked_at, job.error_message = None, None, None
                job.completed_at = datetime.now(UTC)
            db.add(document)
            db.commit()
            db.refresh(document)
            return document
        except IngestionLeaseLost:
            db.rollback()
            db.refresh(document)
            return document
        except Exception as exc:
            if job is not None:
                # The worker owns retries and validates its lease before changing document state.
                db.rollback()
                raise
            return mark_document_failed(db, document, exc)


async def extract_text_from_url(
    url: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> tuple[str, str | None]:
    """Fetch a bounded public URL and return readable text plus an optional HTML title.

    An injected AsyncClient remains caller-owned; otherwise a short-lived client
    disables environment proxies and automatic redirects. Public-address validation
    and redirect limits are enforced by the fetcher. HTTP/network failures become
    actionable IngestionError messages; no document or database state is changed.
    """
    try:
        if client is None:
            async with httpx.AsyncClient(
                timeout=settings.request_timeout_seconds, follow_redirects=False, trust_env=False
            ) as owned_client:
                response, final_url = await fetch_with_validated_redirects(url, owned_client)
        else:
            response, final_url = await fetch_with_validated_redirects(url, client)
    except httpx.HTTPStatusError as exc:
        raise IngestionError(f"Source website returned HTTP {exc.response.status_code}") from exc
    except httpx.RequestError as exc:
        raise IngestionError("Could not download the source website. Check the URL and try again.") from exc
    content_type = response.headers.get("content-type", "")
    if "text/plain" in content_type or final_url.lower().endswith((".txt", ".md", ".markdown")):
        return response.text, None
    soup = BeautifulSoup(response.text, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "header", "footer", "nav", "form"]):
        tag.decompose()
    title = soup.title.string.strip() if soup.title and soup.title.string else None
    main = soup.find("main") or soup.find("article") or soup.body or soup
    text = main.get_text("\n", strip=True)
    return text, title


async def fetch_with_validated_redirects(
    url: str,
    client: httpx.AsyncClient,
) -> tuple[httpx.Response, str]:
    """Download through explicitly validated redirects and return response plus final URL.

    Pin each validated public IP while retaining Host/TLS SNI to prevent DNS
    rebinding. Reject redirect loops, excess hops, compression and oversized bodies.
    The supplied client is not closed here; HTTP/client failures may propagate to
    the extraction adapter, and every streamed response context is closed.
    """
    current_url = url
    visited: set[str] = set()
    headers = {
        "User-Agent": "SupportDeflectAI/1.0 (+https://supportdeflect.ai)",
        "Accept": "text/html, text/plain;q=0.9, */*;q=0.5",
    }
    for redirect_count in range(settings.url_max_redirects + 1):
        address = validate_public_http_url(current_url)
        if current_url in visited:
            raise IngestionError("URL redirect loop detected")
        visited.add(current_url)
        original = httpx.URL(current_url)
        # Pin the validated address, preserving TLS hostname verification and Host.
        # A second DNS lookup at connect time would allow a rebinding SSRF attack.
        async with client.stream(
            "GET",
            original.copy_with(host=address),
            headers={**headers, "Host": original.netloc.decode(), "Accept-Encoding": "identity"},
            extensions={"sni_hostname": original.host},
            follow_redirects=False,
        ) as incoming:
            body = bytearray()
            if incoming.status_code not in REDIRECT_STATUSES:
                incoming.raise_for_status()
                if incoming.headers.get("content-encoding", "identity") != "identity":
                    raise IngestionError("Compressed URL responses are not supported")
                async for chunk in incoming.aiter_bytes():
                    if len(body) + len(chunk) > settings.url_max_bytes:
                        raise IngestionError("URL document exceeds the download size limit")
                    body.extend(chunk)
            response = httpx.Response(
                incoming.status_code, headers=incoming.headers, content=bytes(body), request=incoming.request
            )
        if response.status_code not in REDIRECT_STATUSES:
            response.raise_for_status()
            return response, current_url
        if redirect_count >= settings.url_max_redirects:
            raise IngestionError("URL exceeded the redirect limit")
        location = response.headers.get("location")
        if not location:
            raise IngestionError("URL redirect is missing a Location header")
        current_url = urljoin(current_url, location)
    raise IngestionError("URL exceeded the redirect limit")


def validate_public_http_url(url: str) -> str:
    """Resolve an HTTP(S) URL and return one validated public connection address.

    Reject embedded credentials, local hostnames and any nonpublic/multicast/reserved
    DNS answer with IngestionError. All answers must pass, even when only one IP is
    selected. This performs blocking DNS resolution and must run outside the ASGI loop.
    """
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise IngestionError("Only public HTTP(S) URLs can be indexed")

    hostname = parsed.hostname.lower().rstrip(".")
    if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith((".localhost", ".local")):
        raise IngestionError("Local or private URLs cannot be indexed")

    try:
        resolved_addresses = {info[4][0] for info in socket.getaddrinfo(hostname, None)}
    except socket.gaierror as exc:
        raise IngestionError("Could not resolve URL hostname") from exc

    if not resolved_addresses:
        raise IngestionError("Could not resolve URL hostname")
    for address in resolved_addresses:
        ip = ip_address(address)
        if not ip.is_global or ip.is_multicast or ip.is_reserved:
            raise IngestionError("Local or private URLs cannot be indexed")
    return sorted(resolved_addresses, key=lambda address: (":" in address, address))[0]


def extract_text_from_file(filename: str, content: bytes, mime_type: str | None) -> str:
    """Select PDF extraction or text decoding from the uploaded name/MIME and bytes.

    The HTTP adapter must already enforce byte and upload-type limits. This parser
    returns text without persistence; unsupported types and PDF parse failures raise
    IngestionError, and an empty extraction is rejected later during indexing.
    """
    extension = Path(filename).suffix.lower()
    if extension in PDF_EXTENSIONS or mime_type == "application/pdf":
        return extract_pdf_text(content)
    if extension in TEXT_EXTENSIONS or (mime_type or "").startswith("text/") or mime_type == "application/octet-stream":
        return decode_text(content)
    raise IngestionError(f"Unsupported file type: {mime_type or extension}")


def extract_pdf_text(content: bytes) -> str:
    """Extract available PDF page text with page markers, without OCR or persistence.

    Image-only pages may contribute no text. Parser failures become IngestionError
    without leaking parser internals; upload limits do not constitute a PDF sandbox.
    """
    try:
        reader = PdfReader(BytesIO(content))
        pages: list[str] = []
        for page_index, page in enumerate(reader.pages):
            extracted = page.extract_text() or ""
            if extracted:
                pages.append(f"\n\n[Page {page_index + 1}]\n{extracted}")
        return "\n".join(pages)
    except Exception as exc:
        raise IngestionError("Could not read PDF text") from exc


def decode_text(content: bytes) -> str:
    """Decode uploaded bytes using UTF-8, then UTF-16, then a Latin-1 compatibility fallback.

    Return text for later cleanup rather than guessing semantic document validity.
    Encoding failures advance to the next decoder; no file or database state is written.
    """
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise IngestionError("Could not decode text file")


def clean_text(text: str) -> str:
    """Normalize control characters, repeated spaces and blank lines before chunking.

    Return a new string retaining readable line boundaries; this is whitespace
    cleanup, not HTML sanitization, language detection or prompt-injection filtering.
    """
    text = text.replace("\x00", " ")
    text = re.sub(r"[\t\r\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    lines = [re.sub(r" {2,}", " ", line).strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    return "\n".join(lines).strip()


def chunk_text(text: str, max_chars: int = 900, overlap: int = 150) -> list[str]:
    """Pack readable paragraphs into overlapping retrieval chunks and discard tiny fragments.

    max_chars guides packing and long-paragraph windows; an overlap prefix can
    make packed chunks exceed that target. Callers must ensure max_chars is positive
    and 0 <= overlap < max_chars so long-paragraph splitting always advances.
    """
    paragraphs = split_into_paragraphs(text)
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        if len(paragraph) > max_chars:
            if current:
                chunks.append(current.strip())
                current = ""
            chunks.extend(split_long_paragraph(paragraph, max_chars=max_chars, overlap=overlap))
            continue
        if len(current) + len(paragraph) + 2 <= max_chars:
            current = f"{current}\n\n{paragraph}" if current else paragraph
        else:
            if current:
                chunks.append(current.strip())
            prefix = current[-overlap:].strip() if current and overlap > 0 else ""
            current = f"{prefix}\n\n{paragraph}" if prefix else paragraph
    if current.strip():
        chunks.append(current.strip())
    return [chunk for chunk in chunks if len(chunk.strip()) >= 20]


def split_into_paragraphs(text: str) -> list[str]:
    """Return nonempty text units split at blank lines or selected sentence boundaries.

    The heuristic favors sentence starts with uppercase letters/digits; it is
    not a language-complete sentence parser and performs no I/O.
    """
    raw = re.split(r"\n\s*\n|(?<=\.)\s+(?=[A-Z0-9])", text)
    return [part.strip() for part in raw if part.strip()]


def split_long_paragraph(paragraph: str, max_chars: int, overlap: int) -> list[str]:
    """Return overlapping character windows for one oversized paragraph.

    Require max_chars > 0 and 0 <= overlap < max_chars; otherwise the cursor
    may not advance. Character cuts trade perfect sentence boundaries for bounded
    embedding inputs, and the input string is not changed.
    """
    chunks: list[str] = []
    start = 0
    while start < len(paragraph):
        end = min(len(paragraph), start + max_chars)
        chunk = paragraph[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(paragraph):
            break
        start = max(0, end - overlap)
    return chunks
