import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import SessionLocal, ensure_pgvector_schema
from app.models import VectorChunk
from app.services.embeddings import get_embedding_service
from app.services.vector_store import DatabaseVectorStore

BATCH_SIZE = 32


def main() -> None:
    ensure_pgvector_schema()
    embedding_service = get_embedding_service()
    vector_store = DatabaseVectorStore()

    with SessionLocal() as db:
        chunks = list(db.query(VectorChunk).order_by(VectorChunk.created_at, VectorChunk.chunk_index))
        total = len(chunks)
        for start in range(0, total, BATCH_SIZE):
            batch = chunks[start : start + BATCH_SIZE]
            embeddings = embedding_service.embed_texts([chunk.text for chunk in batch])
            for chunk, embedding in zip(batch, embeddings, strict=False):
                chunk.embedding = embedding
            db.flush()
            for chunk in batch:
                vector_store._sync_pgvector_column(db, org_id=chunk.org_id, document_id=chunk.document_id)
            db.commit()
            print(f"Re-embedded {min(start + BATCH_SIZE, total)}/{total} chunks")

    print("Vector chunks re-embedded.")


if __name__ == "__main__":
    main()
