"""Check Alembic upgrade compatibility and durable worker success/failure transitions.

Migrations run against temporary SQLite files, including a legacy-shaped dataset.
Queued jobs use explicit test providers; these checks do not execute PostgreSQL pgvector."""

from pathlib import Path

from sqlalchemy import create_engine, inspect, select

from alembic import command
from alembic.config import Config
from app.db import SessionLocal, required_schema_revision
from app.models import Document, IngestionJob, Organization
from app.services.ingestion_jobs import enqueue_text_ingestion, process_next_ingestion_job
from tests.conftest import register_org


def test_migrations_empty_and_legacy_data(tmp_path):
    """Upgrade empty and legacy-shaped temporary databases while preserving existing rows and reaching the current
    revision.
    """
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    url = f"sqlite:///{tmp_path / 'migration.db'}"
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, "0001")
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.exec_driver_sql("""INSERT INTO organizations VALUES
            ('org', 'company_org', 'Org', 'Org', '#2563eb', 'Hi', NULL, 1, '[]',
            'trial', 'active', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)""")
        conn.exec_driver_sql("""INSERT INTO users VALUES
            ('user', 'org', 'user@example.com', 'User', 'hash', 'admin', 1, CURRENT_TIMESTAMP)""")
        conn.exec_driver_sql("""INSERT INTO conversation_logs
            (id, org_id, channel, question, answer, confidence_score, resolved, needs_human,
             sources, latency_ms, created_at)
            VALUES ('legacy', 'org', 'widget', 'Hello', 'Hi', 0, 1, 0, '[]', 0, CURRENT_TIMESTAMP)""")
    command.upgrade(config, "head")
    command.upgrade(config, "head")
    with engine.connect() as conn:
        assert conn.exec_driver_sql("SELECT role FROM users").scalar() == "tenant_admin"
        assert {"support_cases", "audit_events", "alembic_version", "question_reservations"} <= set(
            inspect(conn).get_table_names()
        )
        assert conn.exec_driver_sql("SELECT version_num FROM alembic_version").scalar() == required_schema_revision()
        assert "embedding_model" in {column["name"] for column in inspect(conn).get_columns("vector_chunks")}
        assert conn.exec_driver_sql("SELECT outcome FROM conversation_logs WHERE id='legacy'").scalar() is None
        assert "ix_rate_limit_created" in {index["name"] for index in inspect(conn).get_indexes("rate_limit_events")}
        assert {"billing_entries", "mail_messages", "mail_automations", "mail_worker_state"} <= set(
            inspect(conn).get_table_names()
        )
    engine.dispose()


def test_queued_ingestion_success_and_failure(client):
    """Exercise actual durable job claims through indexed success and bounded failed attempts using test-only
    providers.
    """
    _, payload = register_org(client, "Queue", "queue@example.com")
    with SessionLocal() as db:
        org = db.get(Organization, payload["user"]["organization"]["id"])
        good = Document(org_id=org.id, title="Guide", source="guide.txt", source_type="file")
        bad = Document(org_id=org.id, title="Empty", source="empty.txt", source_type="file")
        db.add_all([good, bad])
        db.commit()
        enqueue_text_ingestion(db, org=org, document=good, raw_text="A useful support guide with adequate content.")
        enqueue_text_ingestion(db, org=org, document=bad, raw_text="short")
        good_id, bad_id = good.id, bad.id
    for _ in range(4):
        assert process_next_ingestion_job("test-worker")
    with SessionLocal() as db:
        assert db.get(Document, good_id).status == "indexed"
        assert db.get(Document, bad_id).status == "failed"
        jobs = list(db.scalars(select(IngestionJob)))
        assert {job.status for job in jobs} == {"completed", "failed"}
    assert not process_next_ingestion_job("test-worker")
