"""Run separately with TEST_POSTGRES_URL pointing at a disposable *_test database."""

import os
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url

from alembic import command
from alembic.config import Config


def test_migrate_vectors_cosine_and_tenant_filtering(monkeypatch):
    """Upgrade a configured disposable PostgreSQL DB, verify pgvector/HNSW and tenant-scoped cosine results, then
    exercise distinct concurrent claims.
    """
    url = os.environ.get("TEST_POSTGRES_URL")
    if not url:
        pytest.skip("TEST_POSTGRES_URL is not configured")
    assert make_url(url).database.endswith("_test"), "Use a disposable database with a _test suffix"
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    monkeypatch.setenv("EMBEDDING_PROVIDER", "fake")
    from app.core.config import get_settings

    get_settings.cache_clear()
    from app.db import SessionLocal, engine
    from app.models import Document, Organization, VectorChunk
    from app.services.vector_store import DatabaseVectorStore

    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "head")
    ids = []
    try:
        with SessionLocal() as db:
            assert db.scalar(text("SELECT extname FROM pg_extension WHERE extname='vector'")) == "vector"
            assert "vector(384)" == db.scalar(
                text(
                    "SELECT format_type(atttypid, atttypmod) FROM pg_attribute "
                    "WHERE attrelid='vector_chunks'::regclass AND attname='embedding_vector'"
                )
            )
            assert db.scalar(
                text("SELECT indexname FROM pg_indexes " "WHERE indexname='ix_vector_chunks_embedding_vector'")
            )
            for name in ("a", "b"):
                from uuid import uuid4

                org = Organization(
                    public_id="test_" + uuid4().hex,
                    name=name,
                    widget_brand_name=name,
                    widget_greeting="Hello",
                    allowed_domains=[],
                )
                db.add(org)
                db.flush()
                doc = Document(org_id=org.id, title="Guide", source="guide.txt", source_type="file", status="indexed")
                db.add(doc)
                db.flush()
                ids.append((org.id, doc.id))
            db.commit()
        store = DatabaseVectorStore()
        vector = [1.0] + [0.0] * 383
        for org_id, doc_id in ids:
            store.upsert_chunks(
                org_id=org_id,
                document_id=doc_id,
                title="Guide",
                source="guide.txt",
                chunks=[f"Private document for {org_id}"],
                embeddings=[vector],
            )
        result = store.search(org_id=ids[0][0], query_embedding=vector, top_k=5)
        assert len(result) == 1
        assert result[0].metadata["org_id"] == ids[0][0]
        assert result[0].score == pytest.approx(1.0)
        with SessionLocal() as db:
            assert db.query(VectorChunk).filter(VectorChunk.org_id.in_([i[0] for i in ids])).count() == 2
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier

        from app.models import IngestionJob
        from app.services.ingestion_jobs import claim_next_job

        with SessionLocal() as db:
            for _ in range(2):
                db.add(
                    IngestionJob(
                        org_id=ids[0][0],
                        document_id=ids[0][1],
                        job_type="text",
                        raw_text="A queued fixture",
                        payload={},
                        status="pending",
                    )
                )
            db.commit()
        ready = Barrier(2)

        def claim(worker):
            """Synchronize one real PostgreSQL worker claim with its contender and return the actual claimed job."""
            ready.wait(timeout=10)
            return claim_next_job(worker)

        with ThreadPoolExecutor(max_workers=2) as pool:
            claims = list(pool.map(claim, ["integration-worker-a", "integration-worker-b"]))
        assert all(job is not None for job in claims)
        assert len({job.id for job in claims}) == 2
    finally:
        with SessionLocal() as db:
            for org_id, _ in ids:
                db.execute(text("DELETE FROM organizations WHERE id=:id"), {"id": org_id})
            db.commit()
        engine.dispose()
