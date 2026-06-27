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


class BaseEmbeddingService(ABC):
    @abstractmethod
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError

    def embed_query(self, text: str) -> list[float]:
        return self.embed_texts([text])[0]


class FakeEmbeddingService(BaseEmbeddingService):
    """Deterministic local embeddings for tests and offline demos.

    This is not a semantic model, but it gives stable vectors based on token
    overlap and keeps the full RAG pipeline runnable without external downloads.
    """

    def __init__(self, dimension: int = 384) -> None:
        self.dimension = dimension

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return [self._embed(text) for text in texts]

    def _embed(self, text: str) -> list[float]:
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
    def __init__(self, model_name: str) -> None:
        from sentence_transformers import SentenceTransformer

        self.model = SentenceTransformer(model_name)

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        embeddings = self.model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        return [embedding.astype(float).tolist() for embedding in embeddings]


_embedding_service: BaseEmbeddingService | None = None
_lock = Lock()


def get_embedding_service() -> BaseEmbeddingService:
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
