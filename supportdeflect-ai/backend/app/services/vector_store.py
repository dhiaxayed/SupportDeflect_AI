from __future__ import annotations

import json
import logging
import math
from abc import ABC, abstractmethod
from dataclasses import dataclass
from threading import Lock
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import get_settings
from app.db import SessionLocal, ensure_pgvector_schema, is_postgres
from app.models import VectorChunk

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class RetrievedChunk:
    text: str
    score: float
    metadata: dict[str, Any]


class BaseVectorStore(ABC):
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
    ) -> None:
        raise NotImplementedError

    @abstractmethod
    def search(self, *, org_id: str, query_embedding: list[float], top_k: int) -> list[RetrievedChunk]:
        raise NotImplementedError

    @abstractmethod
    def delete_by_document(self, *, org_id: str, document_id: str) -> None:
        raise NotImplementedError


class ChromaVectorStore(BaseVectorStore):
    def __init__(self) -> None:
        import chromadb

        self.client = chromadb.PersistentClient(path=settings.chroma_persist_directory)
        self.collection = self.client.get_or_create_collection(
            name=settings.vector_collection_name,
            metadata={"hnsw:space": "cosine"},
        )

    def upsert_chunks(
        self,
        *,
        org_id: str,
        document_id: str,
        title: str,
        source: str,
        chunks: list[str],
        embeddings: list[list[float]],
    ) -> None:
        if not chunks:
            return
        ids = [f"{org_id}:{document_id}:{index}" for index, _ in enumerate(chunks)]
        metadatas = [
            {
                "org_id": org_id,
                "document_id": document_id,
                "title": title,
                "source": source,
                "chunk_index": index,
            }
            for index, _ in enumerate(chunks)
        ]
        self.collection.upsert(ids=ids, documents=chunks, embeddings=embeddings, metadatas=metadatas)

    def search(self, *, org_id: str, query_embedding: list[float], top_k: int) -> list[RetrievedChunk]:
        result = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k,
            where={"org_id": org_id},
            include=["documents", "metadatas", "distances"],
        )
        documents = result.get("documents", [[]])[0] or []
        metadatas = result.get("metadatas", [[]])[0] or []
        distances = result.get("distances", [[]])[0] or []
        chunks: list[RetrievedChunk] = []
        for document_text, metadata, distance in zip(documents, metadatas, distances, strict=False):
            # With cosine space, distance is 0 for identical vectors and approaches 2.
            score = max(0.0, min(1.0, 1.0 - float(distance)))
            chunks.append(RetrievedChunk(text=document_text, score=score, metadata=dict(metadata or {})))
        return chunks

    def delete_by_document(self, *, org_id: str, document_id: str) -> None:
        try:
            self.collection.delete(where={"$and": [{"org_id": org_id}, {"document_id": document_id}]})
        except Exception:
            logger.exception("Chroma delete with compound filter failed, falling back to id lookup")
            existing = self.collection.get(where={"document_id": document_id}, include=[])
            ids = existing.get("ids", [])
            safe_ids = [item for item in ids if item.startswith(f"{org_id}:{document_id}:")]
            if safe_ids:
                self.collection.delete(ids=safe_ids)


class InMemoryVectorStore(BaseVectorStore):
    def __init__(self) -> None:
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
    ) -> None:
        self.delete_by_document(org_id=org_id, document_id=document_id)
        for index, (chunk, embedding) in enumerate(zip(chunks, embeddings, strict=False)):
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

    def search(self, *, org_id: str, query_embedding: list[float], top_k: int) -> list[RetrievedChunk]:
        candidates: list[RetrievedChunk] = []
        for item in self.items:
            if item["metadata"].get("org_id") != org_id:
                continue
            score = cosine_similarity(query_embedding, item["embedding"])
            candidates.append(RetrievedChunk(text=item["text"], score=score, metadata=item["metadata"]))
        return sorted(candidates, key=lambda chunk: chunk.score, reverse=True)[:top_k]

    def delete_by_document(self, *, org_id: str, document_id: str) -> None:
        self.items = [
            item
            for item in self.items
            if not (item["metadata"].get("org_id") == org_id and item["metadata"].get("document_id") == document_id)
        ]


class DatabaseVectorStore(BaseVectorStore):
    """Persistent vector store backed by the relational database.

    This keeps the free deployment simple: Neon/Postgres stores both app data
    and RAG chunks, avoiding a separate paid vector database. On Postgres/Neon,
    pgvector is used for indexed cosine retrieval; SQLite keeps a JSON fallback
    for local development and tests.
    """

    def __init__(self) -> None:
        self.pgvector_available = is_postgres() and ensure_pgvector_schema()

    def upsert_chunks(
        self,
        *,
        org_id: str,
        document_id: str,
        title: str,
        source: str,
        chunks: list[str],
        embeddings: list[list[float]],
    ) -> None:
        with SessionLocal() as db:
            db.query(VectorChunk).filter(
                VectorChunk.org_id == org_id,
                VectorChunk.document_id == document_id,
            ).delete(synchronize_session=False)
            for index, (chunk, embedding) in enumerate(zip(chunks, embeddings, strict=False)):
                db.add(
                    VectorChunk(
                        org_id=org_id,
                        document_id=document_id,
                        title=title,
                        source=source,
                        chunk_index=index,
                        text=chunk,
                        embedding=embedding,
                    )
                )
            db.flush()
            self._sync_pgvector_column(db, org_id=org_id, document_id=document_id)
            db.commit()

    def search(self, *, org_id: str, query_embedding: list[float], top_k: int) -> list[RetrievedChunk]:
        if self.pgvector_available:
            try:
                return self._search_pgvector(org_id=org_id, query_embedding=query_embedding, top_k=top_k)
            except SQLAlchemyError as exc:
                logger.warning("pgvector search failed; falling back to JSON scan: %s", exc)
                self.pgvector_available = False

        with SessionLocal() as db:
            rows = list(db.scalars(select(VectorChunk).where(VectorChunk.org_id == org_id)))
        candidates = [
            RetrievedChunk(
                text=row.text,
                score=cosine_similarity(query_embedding, row.embedding),
                metadata={
                    "org_id": row.org_id,
                    "document_id": row.document_id,
                    "title": row.title,
                    "source": row.source,
                    "chunk_index": row.chunk_index,
                },
            )
            for row in rows
        ]
        return sorted(candidates, key=lambda chunk: chunk.score, reverse=True)[:top_k]

    def delete_by_document(self, *, org_id: str, document_id: str) -> None:
        with SessionLocal() as db:
            db.query(VectorChunk).filter(
                VectorChunk.org_id == org_id,
                VectorChunk.document_id == document_id,
            ).delete(synchronize_session=False)
            db.commit()

    def _sync_pgvector_column(self, db: Any, *, org_id: str, document_id: str) -> None:
        if not self.pgvector_available:
            return
        try:
            db.execute(
                text(
                    "UPDATE vector_chunks "
                    "SET embedding_vector = embedding::text::vector "
                    "WHERE org_id = :org_id AND document_id = :document_id"
                ),
                {"org_id": org_id, "document_id": document_id},
            )
        except SQLAlchemyError as exc:
            logger.warning("Could not sync pgvector column; falling back to JSON scan: %s", exc)
            self.pgvector_available = False

    def _search_pgvector(self, *, org_id: str, query_embedding: list[float], top_k: int) -> list[RetrievedChunk]:
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
            WHERE org_id = :org_id AND embedding_vector IS NOT NULL
            ORDER BY embedding_vector <=> CAST(:query_vector AS vector)
            LIMIT :top_k
            """
        )
        with SessionLocal() as db:
            rows = db.execute(
                statement,
                {"org_id": org_id, "query_vector": query_vector, "top_k": top_k},
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


def cosine_similarity(left: list[float], right: list[float]) -> float:
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
        try:
            logger.info("Using Chroma vector store at %s", settings.chroma_persist_directory)
            _vector_store = ChromaVectorStore()
        except Exception as exc:  # pragma: no cover - depends on local chroma availability
            logger.warning("Could not initialize Chroma, falling back to in-memory vector store: %s", exc)
            _vector_store = InMemoryVectorStore()
        return _vector_store
