"""Re-embed persisted text locally after an embedding model change, without uploading files again."""

import argparse
import sys
from pathlib import Path

from sqlalchemy import select, text, update

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.db import SessionLocal, is_postgres  # noqa: E402
from app.models import Document, VectorChunk  # noqa: E402
from app.services.embeddings import embedding_identity, get_embedding_service  # noqa: E402


def reindex(*, org_id: str | None = None, batch_size: int = 32) -> int:
    """Re-embed active indexed passages whose model identity is stale, optionally restricted to org_id, in bounded
    batches. Compare text/identity before update, sync pgvector and commit each batch; return updated count or
    raise on shape/concurrent changes.
    """
    if not 1 <= batch_size <= 128:
        raise ValueError("Batch size must be between 1 and 128")
    identity = embedding_identity()
    updated = 0
    while True:
        with SessionLocal() as db:
            query = (
                select(VectorChunk)
                .join(Document)
                .where(
                    VectorChunk.embedding_model != identity,
                    Document.org_id == VectorChunk.org_id,
                    Document.is_active.is_(True),
                    Document.status == "indexed",
                )
            )
            if org_id:
                query = query.where(VectorChunk.org_id == org_id)
            rows = list(db.scalars(query.order_by(VectorChunk.id).limit(batch_size)))
            if not rows:
                return updated
            vectors = get_embedding_service().embed_texts([row.text for row in rows])
            if len(vectors) != len(rows) or any(
                len(vector) != get_settings().embedding_dimension for vector in vectors
            ):
                raise RuntimeError("Embedding model returned an incompatible vector shape")
            for row, vector in zip(rows, vectors, strict=True):
                # Do not overwrite a concurrent ingestion's replacement text/vector.
                result = db.execute(
                    update(VectorChunk)
                    .where(
                        VectorChunk.id == row.id,
                        VectorChunk.text == row.text,
                        VectorChunk.embedding_model == row.embedding_model,
                    )
                    .values(embedding=vector, embedding_model=identity)
                )
                if result.rowcount != 1:
                    raise RuntimeError("Knowledge changed while reindexing. Retry the command.")
                if is_postgres():
                    db.execute(
                        text("UPDATE vector_chunks SET embedding_vector = embedding::text::vector WHERE id = :id"),
                        {"id": row.id},
                    )
            db.commit()
            updated += len(rows)
            print(f"REINDEXED_CHUNKS={updated}", flush=True)


def main():
    """Require explicit --all or --organization-id selection, invoke identity-aware reindexing and print its count.
    Uses the configured database/model and assumes the current schema already exists.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--all", action="store_true")
    selection.add_argument("--organization-id")
    args = parser.parse_args()
    print(f"REINDEX_COMPLETE CHUNKS={reindex(org_id=args.organization_id)}")


if __name__ == "__main__":
    main()
