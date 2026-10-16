"""Tenant-filtered chunk persistence and hybrid retrieval for the local knowledge base.

PostgreSQL uses pgvector; native SQLite stores JSON vectors and ranks locally.
Caller-supplied sessions keep index writes atomic with document state; test-only
memory storage offers the same interface without database transaction guarantees.
"""

from __future__ import annotations

import json
import logging
import math
from abc import ABC, abstractmethod
from contextlib import nullcontext
from dataclasses import dataclass
from threading import Lock
from typing import Any

from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import SessionLocal, has_pgvector_schema, is_postgres
from app.models import Document, VectorChunk
from app.services.embeddings import embedding_identity

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class RetrievedChunk:
    """Retrieved text, diagnostic similarity and source/tenant metadata carried into RAG."""

    text: str
    score: float
    metadata: dict[str, Any]


class BaseVectorStore(ABC):
    """Tenant-scoped interface for replacing, retrieving and deleting document chunks."""

    @abstractmethod
    def upsert_chunks(
        self,
        *,
        org_id: str,
        document_id: str,
        title: str,
        source: str,
        chunks: list[str],
        embeddings: list[list[float]],
        db: Session | None = None,
    ) -> None:
        """Replace one tenant document's ordered text/vector pairs and associated source metadata.

        Aligned chunks/embeddings and verified ownership are caller responsibilities.
        Persistent implementations may join a supplied session transaction; the base
        method raises NotImplementedError rather than choosing persistence implicitly.
        """
        raise NotImplementedError

    @abstractmethod
    def search(
        self, *, org_id: str, query_embedding: list[float], top_k: int, query_text: str = ""
    ) -> list[RetrievedChunk]:
        """Return tenant-filtered ranked chunks for a query vector and optional lexical text.

        query_text may enable hybrid ranking/context expansion beyond the base top_k
        selection. Implementations define persistence errors; the abstract method raises
        NotImplementedError and does not certify factual answer support.
        """
        raise NotImplementedError

    @abstractmethod
    def delete_by_document(self, *, org_id: str, document_id: str, db: Session | None = None) -> None:
        """Remove only the supplied tenant/document index, optionally inside a caller transaction.

        This interface deletes vector chunks, not the business document row. The base
        method raises NotImplementedError; lifecycle state remains the caller's concern.
        """
        raise NotImplementedError


class InMemoryVectorStore(BaseVectorStore):
    """Explicit test-only index with tenant filters and no database rollback semantics."""

    def __init__(self) -> None:
        """Start an empty process-local chunk collection; fixtures reset it between tests."""
        self.items: list[dict[str, Any]] = []

    def upsert_chunks(
        self,
        *,
        org_id: str,
        document_id: str,
        title: str,
        source: str,
        chunks: list[str],
        embeddings: list[list[float]],
        db: Session | None = None,
    ) -> None:
        """Replace the document's in-memory chunks with aligned text/vector/source records.

        Strict pairing raises ValueError for mismatched lengths. db is accepted for
        interface compatibility but ignored; mutations cannot roll back with SQL and
        are therefore reserved for isolated tests.
        """
        self.delete_by_document(org_id=org_id, document_id=document_id)
        for index, (chunk, embedding) in enumerate(zip(chunks, embeddings, strict=True)):
            self.items.append(
                {
                    "id": f"{org_id}:{document_id}:{index}",
                    "embedding": embedding,
                    "text": chunk,
                    "metadata": {
                        "org_id": org_id,
                        "document_id": document_id,
                        "title": title,
                        "source": source,
                        "chunk_index": index,
                    },
                }
            )

    def search(
        self, *, org_id: str, query_embedding: list[float], top_k: int, query_text: str = ""
    ) -> list[RetrievedChunk]:
        """Rank this tenant's memory chunks by cosine, optionally fusing lexical context.

        Dense-only queries return at most top_k. Hybrid queries may append document
        headers/neighbors to preserve subject context. No database/embedding calls occur
        here and no active-document state is checked outside this test collection.
        """
        candidates: list[RetrievedChunk] = []
        for item in self.items:
            if item["metadata"].get("org_id") != org_id:
                continue
            score = cosine_similarity(query_embedding, item["embedding"])
            candidates.append(RetrievedChunk(text=item["text"], score=score, metadata=item["metadata"]))
        dense = sorted(candidates, key=lambda chunk: chunk.score, reverse=True)
        if not query_text:
            return dense[:top_k]
        from app.services.retrieval import hybrid_rank

        selected = hybrid_rank(dense[: top_k * 3], candidates, query_text, top_k)
        return expand_memory_context(selected, candidates)

    def delete_by_document(self, *, org_id: str, document_id: str, db: Session | None = None) -> None:
        """Remove memory records matching both tenant and document, leaving others unchanged.

        A missing document is a no-op. The optional session has no effect, so the
        removal is immediate and not part of an SQL transaction.
        """
        self.items = [
            item
            for item in self.items
            if not (item["metadata"].get("org_id") == org_id and item["metadata"].get("document_id") == document_id)
        ]


class DatabaseVectorStore(BaseVectorStore):
    """Persistent vector store backed by the relational database.

    PostgreSQL stores both application data and RAG chunks. On PostgreSQL,
    pgvector is used for indexed cosine retrieval; SQLite keeps a JSON fallback
    for local development and tests.
    """

    def __init__(self) -> None:
        """Detect pgvector schema availability for the configured database.

        PostgreSQL without its vector column raises RuntimeError and requires migration;
        SQLite explicitly uses JSON-vector retrieval rather than an in-memory fallback.
        """
        self.pgvector_available = is_postgres() and has_pgvector_schema()
        if is_postgres() and not self.pgvector_available:
            raise RuntimeError("pgvector schema is missing; run alembic upgrade head")

    def upsert_chunks(
        self,
        *,
        org_id: str,
        document_id: str,
        title: str,
        source: str,
        chunks: list[str],
        embeddings: list[list[float]],
        db: Session | None = None,
    ) -> None:
        """Replace and flush tenant/document chunks tagged with the current embedding identity.

        Text/vector lists must align; strict pairing failures and database errors
        propagate. A supplied session keeps deletion, insertion and pgvector sync in the
        caller's transaction without commit; otherwise this method owns a session/commit.
        Caller authorization, quota and document state checks must precede publication.
        """
        # A caller-owned transaction keeps chunk writes and document state atomic.
        owns_session = db is None
        with SessionLocal() if owns_session else nullcontext(db) as session:
            session.query(VectorChunk).filter(
                VectorChunk.org_id == org_id,
                VectorChunk.document_id == document_id,
            ).delete(synchronize_session=False)
            for index, (chunk, embedding) in enumerate(zip(chunks, embeddings, strict=True)):
                session.add(
                    VectorChunk(
                        org_id=org_id,
                        document_id=document_id,
                        title=title,
                        source=source,
                        chunk_index=index,
                        text=chunk,
                        embedding=embedding,
                        embedding_model=embedding_identity(),
                    )
                )
            session.flush()
            self._sync_pgvector_column(session, org_id=org_id, document_id=document_id)
            if owns_session:
                session.commit()

    def search(
        self, *, org_id: str, query_embedding: list[float], top_k: int, query_text: str = ""
    ) -> list[RetrievedChunk]:
        """Retrieve active indexed tenant chunks, then fuse lexical/dense ranks and neighboring context.

        Dense matches require the current embedding identity. PostgreSQL bounds lexical
        candidates and uses pgvector; SQLite evaluates persisted rows locally. Hybrid
        results can exceed top_k by adding headers/adjacent chunks. Sessions are owned
        locally; read/model/schema errors propagate instead of disabling vector writes.
        """
        from app.services.retrieval import hybrid_rank, lexical_tokens

        active = (
            VectorChunk.org_id == org_id,
            Document.org_id == org_id,
            Document.is_active.is_(True),
            Document.status == "indexed",
        )
        dense: list[RetrievedChunk] = []
        if self.pgvector_available:
            dense = self._search_pgvector(org_id=org_id, query_embedding=query_embedding, top_k=top_k * 3)
        with SessionLocal() as db:
            statement = select(VectorChunk).join(Document).where(*active)
            if self.pgvector_available:
                terms = lexical_tokens(query_text)[:16]
                if terms:
                    statement = statement.where(
                        or_(*(func.lower(VectorChunk.text).contains(term, autoescape=True) for term in terms))
                    )
                else:
                    statement = statement.where(VectorChunk.chunk_index == 0)
                statement = statement.order_by(VectorChunk.document_id, VectorChunk.chunk_index).limit(
                    settings.retrieval_candidate_limit
                )
            rows = list(db.scalars(statement))
            candidates = [row_to_chunk(row, query_embedding) for row in rows]
            if not self.pgvector_available:
                dense = sorted(
                    [row_to_chunk(row, query_embedding) for row in rows if row.embedding_model == embedding_identity()],
                    key=lambda chunk: chunk.score,
                    reverse=True,
                )[: top_k * 3]
            if not query_text:
                return dense[:top_k]
            selected = hybrid_rank(dense, candidates, query_text, top_k)
            if not selected:
                return []
            # Headers carry the subject's identity; adjacent chunks preserve split sentences/sections.
            ranges = [
                and_(
                    VectorChunk.document_id == item.metadata["document_id"],
                    or_(
                        VectorChunk.chunk_index == 0,
                        VectorChunk.chunk_index.between(
                            item.metadata["chunk_index"] - 1, item.metadata["chunk_index"] + 1
                        ),
                    ),
                )
                for item in selected
            ]
            neighbors = list(
                db.scalars(
                    select(VectorChunk)
                    .join(Document)
                    .where(*active, or_(*ranges))
                    .order_by(VectorChunk.document_id, VectorChunk.chunk_index)
                    .limit(top_k * 4)
                )
            )
            seen = {(item.metadata["document_id"], item.metadata["chunk_index"]) for item in selected}
            return selected + [
                row_to_chunk(row, query_embedding)
                for row in neighbors
                if (row.document_id, row.chunk_index) not in seen
            ]

    def delete_by_document(self, *, org_id: str, document_id: str, db: Session | None = None) -> None:
        """Delete chunk rows scoped by both tenant and document IDs.

        A caller session retains transaction ownership; without one this method opens
        and commits its own session. The business document/job lifecycle is untouched
        and SQL errors propagate rather than dropping to memory storage.
        """
        owns_session = db is None
        with SessionLocal() if owns_session else nullcontext(db) as session:
            session.query(VectorChunk).filter(
                VectorChunk.org_id == org_id,
                VectorChunk.document_id == document_id,
            ).delete(synchronize_session=False)
            if owns_session:
                session.commit()

    def _sync_pgvector_column(self, db: Any, *, org_id: str, document_id: str) -> None:
        """Copy the scoped JSON embedding values into the PostgreSQL vector column.

        No-op for SQLite. Execute inside the supplied transaction without committing;
        conversion/schema errors must abort indexing rather than leave partially valid
        PostgreSQL dense data.
        """
        if not self.pgvector_available:
            return
        db.execute(
            text(
                "UPDATE vector_chunks "
                "SET embedding_vector = embedding::text::vector "
                "WHERE org_id = :org_id AND document_id = :document_id"
            ),
            {"org_id": org_id, "document_id": document_id},
        )

    def _search_pgvector(self, *, org_id: str, query_embedding: list[float], top_k: int) -> list[RetrievedChunk]:
        """Run tenant/model/active-document-filtered pgvector cosine retrieval.

        Bind the serialized query vector instead of interpolating SQL, enable local
        HNSW iterative scanning for filtered candidates and return bounded scores.
        Own the read session; schema/query failures propagate to RAG outage handling.
        """
        query_vector = json.dumps(query_embedding)
        statement = text(
            """
            SELECT
                text AS chunk_text,
                org_id,
                document_id,
                title,
                source,
                chunk_index,
                1 - (embedding_vector <=> CAST(:query_vector AS vector)) AS score
            FROM vector_chunks
            WHERE org_id = :org_id AND embedding_model = :embedding_model AND embedding_vector IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM documents d WHERE d.id = vector_chunks.document_id
                  AND d.org_id = :org_id AND d.is_active = true AND d.status = 'indexed'
              )
            ORDER BY embedding_vector <=> CAST(:query_vector AS vector)
            LIMIT :top_k
            """
        )
        with SessionLocal() as db:
            # Tenant filters are applied after HNSW candidates: continue scanning for this tenant.
            db.execute(text("SET LOCAL hnsw.iterative_scan = strict_order"))
            rows = db.execute(
                statement,
                {
                    "org_id": org_id,
                    "query_vector": query_vector,
                    "top_k": top_k,
                    "embedding_model": embedding_identity(),
                },
            ).mappings()
            return [
                RetrievedChunk(
                    text=str(row["chunk_text"]),
                    score=max(0.0, min(1.0, float(row["score"] or 0.0))),
                    metadata={
                        "org_id": row["org_id"],
                        "document_id": row["document_id"],
                        "title": row["title"],
                        "source": row["source"],
                        "chunk_index": row["chunk_index"],
                    },
                )
                for row in rows
            ]


def row_to_chunk(row: VectorChunk, query_embedding: list[float]) -> RetrievedChunk:
    """Map one persisted row to retrieval metadata and its compatible cosine score.

    A different embedding identity produces score zero, allowing lexical context
    without comparing incompatible vector spaces. The caller must already enforce
    tenant/active-document scope; no rows are written.
    """
    return RetrievedChunk(
        text=row.text,
        score=cosine_similarity(query_embedding, row.embedding) if row.embedding_model == embedding_identity() else 0,
        metadata={
            "org_id": row.org_id,
            "document_id": row.document_id,
            "title": row.title,
            "source": row.source,
            "chunk_index": row.chunk_index,
        },
    )


def expand_memory_context(selected: list[RetrievedChunk], candidates: list[RetrievedChunk]) -> list[RetrievedChunk]:
    """Append unique same-document headers/neighbors to the selected test-memory chunks.

    Candidates must already be tenant-filtered. Keep the selected order, bound
    additional context to three entries per selection and leave input lists unchanged.
    """
    from app.services.retrieval import key

    seen = {key(item) for item in selected}
    related = [
        item
        for item in candidates
        if key(item) not in seen
        and any(
            item.metadata["document_id"] == chosen.metadata["document_id"]
            and (
                item.metadata["chunk_index"] == 0
                or abs(item.metadata["chunk_index"] - chosen.metadata["chunk_index"]) <= 1
            )
            for chosen in selected
        )
    ]
    return selected + related[: len(selected) * 3]


def cosine_similarity(left: list[float], right: list[float]) -> float:
    """Return a cosine score clamped to [0, 1], or zero for empty/zero-norm vectors.

    Mismatched inputs use their shared prefix for the dot product; schema validation
    belongs to ingestion. This diagnostic similarity is not a support probability.
    """
    if not left or not right:
        return 0.0
    dot = sum(a * b for a, b in zip(left, right, strict=False))
    norm_left = math.sqrt(sum(a * a for a in left))
    norm_right = math.sqrt(sum(b * b for b in right))
    if not norm_left or not norm_right:
        return 0.0
    return max(0.0, min(1.0, dot / (norm_left * norm_right)))


_vector_store: BaseVectorStore | None = None
_lock = Lock()


def get_vector_store() -> BaseVectorStore:
    """Lazily create/cache one configured index implementation under a process lock.

    Settings restrict memory storage to tests. Unsupported providers raise ValueError
    and missing PostgreSQL vector schema raises rather than silently falling back;
    subsequent calls reuse the same instance until an explicit test reset/restart.
    """
    global _vector_store
    if _vector_store is not None:
        return _vector_store
    with _lock:
        if _vector_store is not None:
            return _vector_store
        provider = settings.vector_provider.lower()
        if provider == "memory":
            logger.info("Using in-memory vector store")
            _vector_store = InMemoryVectorStore()
            return _vector_store
        if provider in {"database", "postgres", "postgresql"}:
            logger.info("Using database-backed vector store")
            _vector_store = DatabaseVectorStore()
            return _vector_store
        raise ValueError("VECTOR_PROVIDER must be database (or memory for isolated tests)")
