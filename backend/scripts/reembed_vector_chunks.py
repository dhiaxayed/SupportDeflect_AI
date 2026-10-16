"""Legacy batch vector refresh utility: migrate then recompute all stored chunk vectors and synchronize
PostgreSQL's native column. Prefer reindex_vectors.py for current embedding-identity-aware maintenance; run from
backend with a backup.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alembic import command
from alembic.config import Config
from app.db import SessionLocal
from app.models import VectorChunk
from app.services.embeddings import get_embedding_service
from app.services.vector_store import DatabaseVectorStore

BATCH_SIZE = 32


def main() -> None:
    """Upgrade schema and replace stored JSON vectors in batches of 32, validating count/dimension and committing
    each batch with native-column sync. Errors preserve committed earlier batches; this legacy path does not
    stamp embedding_model identity.
    """
    command.upgrade(Config("alembic.ini"), "head")
    embedding_service = get_embedding_service()
    vector_store = DatabaseVectorStore()

    with SessionLocal() as db:
        chunks = list(db.query(VectorChunk).order_by(VectorChunk.created_at, VectorChunk.chunk_index))
        total = len(chunks)
        for start in range(0, total, BATCH_SIZE):
            batch = chunks[start : start + BATCH_SIZE]
            embeddings = embedding_service.embed_texts([chunk.text for chunk in batch])
            for chunk, embedding in zip(batch, embeddings, strict=True):
                if len(embedding) != 384:
                    raise ValueError("Embedding model must match the persisted 384-dimensional schema")
                chunk.embedding = embedding
            db.flush()
            for org_id, document_id in {(chunk.org_id, chunk.document_id) for chunk in batch}:
                vector_store._sync_pgvector_column(db, org_id=org_id, document_id=document_id)
            db.commit()
            print(f"Re-embedded {min(start + BATCH_SIZE, total)}/{total} chunks")

    print("Vector chunks re-embedded.")


if __name__ == "__main__":
    main()
