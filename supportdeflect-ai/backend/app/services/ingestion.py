from __future__ import annotations

import logging
import re
import socket
from datetime import datetime, timezone
from io import BytesIO
from ipaddress import ip_address
from pathlib import Path
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from pypdf import PdfReader
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Document, Organization
from app.services.embeddings import get_embedding_service
from app.services.vector_store import get_vector_store

logger = logging.getLogger(__name__)
settings = get_settings()

TEXT_EXTENSIONS = {".txt", ".md", ".markdown"}
PDF_EXTENSIONS = {".pdf"}


class IngestionError(ValueError):
    pass


class IngestionService:
    def ingest_text(self, db: Session, org: Organization, document: Document, raw_text: str) -> Document:
        try:
            text = clean_text(raw_text)
            if len(text) < 20:
                raise IngestionError("Document does not contain enough readable text")
            chunks = chunk_text(text, max_chars=settings.chunk_size, overlap=settings.chunk_overlap)
            if not chunks:
                raise IngestionError("No indexable chunks generated from document")
            embeddings = get_embedding_service().embed_texts(chunks)
            get_vector_store().upsert_chunks(
                org_id=org.id,
                document_id=document.id,
                title=document.title,
                source=document.source,
                chunks=chunks,
                embeddings=embeddings,
            )
            document.status = "indexed"
            document.chunk_count = len(chunks)
            document.error_message = None
            document.indexed_at = datetime.now(timezone.utc)
            db.add(document)
            db.commit()
            db.refresh(document)
            return document
        except Exception as exc:
            logger.exception("Failed to ingest document %s", document.id)
            document.status = "failed"
            document.error_message = str(exc)[:1000]
            document.chunk_count = 0
            db.add(document)
            db.commit()
            db.refresh(document)
            return document


async def extract_text_from_url(url: str) -> tuple[str, str | None]:
    validate_public_http_url(url)
    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds, follow_redirects=True) as client:
        response = await client.get(
            url,
            headers={
                "User-Agent": "SupportDeflectAI/1.0 (+https://supportdeflect.ai)",
                "Accept": "text/html, text/plain;q=0.9, */*;q=0.5",
            },
        )
        response.raise_for_status()
    content_type = response.headers.get("content-type", "")
    if "text/plain" in content_type or url.lower().endswith((".txt", ".md", ".markdown")):
        return response.text, None
    soup = BeautifulSoup(response.text, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "header", "footer", "nav", "form"]):
        tag.decompose()
    title = soup.title.string.strip() if soup.title and soup.title.string else None
    main = soup.find("main") or soup.find("article") or soup.body or soup
    text = main.get_text("\n", strip=True)
    return text, title


def validate_public_http_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise IngestionError("Only public HTTP(S) URLs can be indexed")

    hostname = parsed.hostname.lower()
    if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".local"):
        raise IngestionError("Local or private URLs cannot be indexed")

    try:
        resolved_addresses = {info[4][0] for info in socket.getaddrinfo(hostname, None)}
    except socket.gaierror as exc:
        raise IngestionError("Could not resolve URL hostname") from exc

    for address in resolved_addresses:
        ip = ip_address(address)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved:
            raise IngestionError("Local or private URLs cannot be indexed")


def extract_text_from_file(filename: str, content: bytes, mime_type: str | None) -> str:
    extension = Path(filename).suffix.lower()
    if extension in PDF_EXTENSIONS or mime_type == "application/pdf":
        return extract_pdf_text(content)
    if extension in TEXT_EXTENSIONS or (mime_type or "").startswith("text/") or mime_type == "application/octet-stream":
        return decode_text(content)
    raise IngestionError(f"Unsupported file type: {mime_type or extension}")


def extract_pdf_text(content: bytes) -> str:
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
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise IngestionError("Could not decode text file")


def clean_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[\t\r\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    lines = [re.sub(r" {2,}", " ", line).strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    return "\n".join(lines).strip()


def chunk_text(text: str, max_chars: int = 900, overlap: int = 150) -> list[str]:
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
    raw = re.split(r"\n\s*\n|(?<=\.)\s+(?=[A-Z0-9])", text)
    return [part.strip() for part in raw if part.strip()]


def split_long_paragraph(paragraph: str, max_chars: int, overlap: int) -> list[str]:
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
