"""Shared local text embedding providers used by ingestion and retrieval.

The production model runs on this host; only explicit test settings permit fake
vectors. Persisted identity prevents comparing embeddings from different models.
"""

from __future__ import annotations

import hashlib
import logging
import math
import re
from abc import ABC, abstractmethod
from threading import Lock

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def embedding_identity() -> str:
    """Return provider/model/dimension identity used to tag persisted vectors.

    Retrieval uses exact identity equality to exclude incompatible dense vectors;
    a model change therefore requires reindexing, not a similarity-threshold tweak.
    """
    return f"{settings.embedding_provider}:{settings.embedding_model_name}:{settings.embedding_dimension}"


class BaseEmbeddingService(ABC):
    """Embedding contract shared by local ingestion batches and retrieval queries."""

    @abstractmethod
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embed input texts in their original order, one numeric vector per text.

        Implementations define model loading/inference failures; the base method raises
        NotImplementedError and neither persists data nor contacts a remote embedding API.
        """
        raise NotImplementedError

    def embed_query(self, text: str) -> list[float]:
        """Embed a single retrieval query using the same space as document chunks.

        Return the first vector from embed_texts; provider errors propagate and
        implementations must return one vector for a nonempty one-item batch.
        """
        return self.embed_texts([text])[0]


class FakeEmbeddingService(BaseEmbeddingService):
    """Deterministic embeddings exclusively for isolated automated tests.

    This is not a semantic model, but it gives stable vectors based on token
    overlap and keeps the full RAG pipeline runnable without external downloads.
    """

    def __init__(self, dimension: int = 384) -> None:
        """Set the output dimension for deterministic test vectors; no model is loaded."""
        self.dimension = dimension

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Return deterministic token-overlap vectors in input order without external I/O.

        An empty batch returns an empty list. These vectors exercise plumbing and
        repeatability only; they are not evidence of semantic retrieval quality.
        """
        return [self._embed(text) for text in texts]

    def _embed(self, text: str) -> list[float]:
        """Hash ASCII word counts into a normalized fixed-length test vector.

        Tokenless input returns zeros. Hash collisions are intentional test behavior;
        the result is independent of process hash randomization and trained models.
        """
        vector = [0.0] * self.dimension
        tokens = re.findall(r"[a-zA-Z0-9_]+", text.lower())
        if not tokens:
            return vector
        for token in tokens:
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            index = int.from_bytes(digest[:4], "big") % self.dimension
            vector[index] += 1.0
        norm = math.sqrt(sum(value * value for value in vector)) or 1.0
        return [value / norm for value in vector]


class SentenceTransformerEmbeddingService(BaseEmbeddingService):
    """Host-local SentenceTransformer inference using the configured vector schema."""

    def __init__(self, model_name: str) -> None:
        """Load the named local/cached model and validate its embedding dimension.

        Initial model download may use the model registry unless offline mode is set.
        Loading failures propagate; a schema dimension mismatch raises ValueError
        instead of silently storing vectors incompatible with pgvector.
        """
        from sentence_transformers import SentenceTransformer

        self.model = SentenceTransformer(model_name)
        if self.model.get_embedding_dimension() != settings.embedding_dimension:
            raise ValueError("Embedding model dimension does not match the database vector schema")

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Run normalized local inference and return plain float lists in input order.

        An empty batch avoids model execution. Model/inference failures propagate to
        ingestion or retrieval handling; this method performs no database writes.
        """
        if not texts:
            return []
        embeddings = self.model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        return [embedding.astype(float).tolist() for embedding in embeddings]


_embedding_service: BaseEmbeddingService | None = None
_lock = Lock()


def get_embedding_service() -> BaseEmbeddingService:
    """Lazily initialize and cache one process-wide embedding provider under a lock.

    Configuration validation restricts fake/fallback providers to explicit tests.
    Real model load failures propagate unless that test-only fallback is enabled;
    subsequent calls reuse the initialized instance without reloading the model.
    """
    global _embedding_service
    if _embedding_service is not None:
        return _embedding_service
    with _lock:
        if _embedding_service is not None:
            return _embedding_service
        provider = settings.embedding_provider.lower()
        if provider == "fake":
            logger.info("Using fake deterministic embedding provider")
            _embedding_service = FakeEmbeddingService(settings.embedding_dimension)
            return _embedding_service
        try:
            logger.info("Loading embedding model %s", settings.embedding_model_name)
            _embedding_service = SentenceTransformerEmbeddingService(settings.embedding_model_name)
        except Exception as exc:  # pragma: no cover - depends on local model availability
            if not settings.allow_fake_embeddings_fallback:
                raise
            logger.warning("Could not load sentence-transformers model, falling back to fake embeddings: %s", exc)
            _embedding_service = FakeEmbeddingService(settings.embedding_dimension)
        return _embedding_service
