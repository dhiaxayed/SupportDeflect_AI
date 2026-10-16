"""Validate configuration, startup readiness and deployment contracts without a live VM.

Tests use isolated API data, parsed Compose/CI definitions and mocked model warmup.
They prove configuration and failure behavior, not successful container deployment."""

from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError
from sqlalchemy import select, text

from app.core.config import Settings
from app.db import SessionLocal, required_schema_revision
from app.models import AuditEvent, Document, User
from app.schemas import WidgetSettingsUpdate
from scripts.create_super_admin import create_super_admin


def production_settings(**overrides):
    """Construct a fully explicit production configuration with caller overrides so each rejected option is tested
    independently.
    """
    values = dict(
        environment="production",
        debug=False,
        docs_enabled=False,
        secret_key="test-only-" + "a" * 40,
        database_url="postgresql+psycopg://test:test@postgres/test",
        init_database_on_startup=False,
        llm_provider="groq",
        groq_api_key="fixture-not-a-real-key",
        groq_model="configured-test-model",
        embedding_provider="sentence-transformers",
        allow_fake_embeddings_fallback=False,
        vector_provider="database",
        rate_limit_provider="database",
        cors_origins=[],
        enforce_trusted_hosts=True,
        trusted_hosts=["app.example.com", "localhost"],
    )
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_production_configuration_and_list_parsing():
    """Reject unsafe provider/database/secret/host settings and accept the supported CSV/JSON list forms."""
    assert production_settings().llm_provider == "groq"
    assert production_settings(cors_origins="[]").cors_origins == []
    assert production_settings(trusted_hosts="app.example.com,localhost").trusted_hosts == [
        "app.example.com",
        "localhost",
    ]
    for invalid in (
        {"debug": True},
        {"secret_key": "short"},
        {"secret_key": "replace-with-at-least-32-random-characters"},
        {"database_url": "sqlite:///test.db"},
        {"llm_provider": "mock"},
        {"llm_provider": "groq", "groq_api_key": None},
        {"embedding_provider": "fake"},
        {"allow_fake_embeddings_fallback": True},
        {"vector_provider": "memory"},
        {"rate_limit_provider": "memory"},
        {"cors_origins": ["*"]},
        {"enforce_trusted_hosts": False},
        {"trusted_hosts": ["*"]},
        {"init_database_on_startup": True},
        {"chunk_overlap": 900},
        {"retrieval_top_k": 0},
        {"embedding_dimension": 768},
        {"min_confidence_score": 2},
        {"ingestion_mode": "unknown"},
    ):
        with pytest.raises(ValidationError):
            production_settings(**invalid)


def test_password_byte_limit(client):
    """Enforce BCrypt's UTF-8 byte ceiling at registration/login, including multibyte passwords that pass a character-
    only check.
    """
    for password in ("x" * 73, "\u00e9" * 37):
        response = client.post(
            "/api/v1/auth/register",
            json={
                "organization_name": "Limits",
                "admin_email": "limits@example.com",
                "password": password,
            },
        )
        assert response.status_code == 422
    assert (
        client.post(
            "/api/v1/auth/login",
            json={
                "email": "limits@example.com",
                "password": "x" * 73,
            },
        ).status_code
        == 422
    )


def test_widget_hostname_validation():
    """Accept normalized hostnames while rejecting credentials, ports, paths, wildcard hosts and malformed widget
    allowlists.
    """
    base = dict(brand_name="Acme", primary_color="#123456", greeting_message="Hello")
    assert WidgetSettingsUpdate(
        **base,
        allowed_domains=[
            "HTTPS://Customer.Example/",
            "customer.example.",
            "localhost",
            "127.0.0.1",
        ],
    ).allowed_domains == ["127.0.0.1", "customer.example", "localhost"]
    for domain in (
        "*",
        "*.example.com",
        "https://user:pass@example.com",
        "example.com:8000",
        "example.com/path",
        "example.com?x=1",
        "-invalid.example",
        "example.com#fragment",
        "javascript://example.com",
    ):
        with pytest.raises(ValidationError):
            WidgetSettingsUpdate(**base, allowed_domains=[domain])


def test_bootstrap_is_idempotent_and_never_promotes_tenant(client, auth_headers):
    """Keep CLI super-admin bootstrap repeat-safe and prevent accidental promotion or reset of an existing account."""
    with SessionLocal() as db:
        assert create_super_admin(db, "operator@example.com", "long-test-password", "Operator")
        assert not create_super_admin(db, "operator@example.com", "changed-test-password", "Changed")
        operator = db.scalar(select(User).where(User.email == "operator@example.com"))
        assert operator.org_id is None and operator.full_name == "Operator"
        assert db.scalar(select(AuditEvent).where(AuditEvent.action == "super_admin.created"))
        with pytest.raises(ValueError, match="promotion"):
            create_super_admin(db, "admin@example.com", "long-test-password", "Admin")
        with pytest.raises(ValueError, match="12 characters"):
            create_super_admin(db, "new@example.com", "short", "New")


def test_readiness_requires_current_migration(client):
    """Return unhealthy database readiness until the persisted Alembic revision matches the application's required
    schema.
    """
    assert client.get("/healthz").status_code == 200
    assert client.get("/healthz/db").status_code == 503
    with SessionLocal() as db:
        db.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"))
        db.execute(text("INSERT INTO alembic_version VALUES ('0006')"))
        db.commit()
    try:
        assert client.get("/healthz/db").status_code == 503
        with SessionLocal() as db:
            db.execute(text("UPDATE alembic_version SET version_num=:head"), {"head": required_schema_revision()})
            db.commit()
        assert client.get("/healthz/db").status_code == 200
    finally:
        with SessionLocal() as db:
            db.execute(text("DROP TABLE alembic_version"))
            db.commit()


def test_document_validation_and_quota(client, auth_headers, monkeypatch):
    """Reject unsupported/invalid files without retaining a document and honor the configured plan's admission limit."""
    from dataclasses import replace

    from app.services import subscriptions

    assert (
        client.post(
            "/api/v1/documents/upload",
            headers=auth_headers,
            files={"file": ("bad.exe", b"content", "application/octet-stream")},
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/v1/documents/upload",
            headers=auth_headers,
            files={"file": ("bad.pdf", b"not a pdf", "application/pdf")},
        ).status_code
        == 400
    )
    with SessionLocal() as db:
        assert db.scalar(select(Document)) is None
    monkeypatch.setitem(subscriptions.PLANS, "trial", replace(subscriptions.PLANS["trial"], max_documents=0))
    response = client.post(
        "/api/v1/documents/upload",
        headers=auth_headers,
        files={"file": ("guide.txt", b"Documented support answer for a trial tenant.", "text/plain")},
    )
    assert response.status_code == 402
    assert response.json()["detail"]["code"] == "quota_or_subscription_required"


def test_compose_security_contract_and_ci_no_deploy():
    """Inspect actual Compose/CI definitions for sole ingress, network/storage ownership, migration order and non-
    deploying acceptance steps.
    """
    root = Path(__file__).resolve().parents[2]
    compose = yaml.safe_load((root / "docker-compose.yml").read_text())
    services = compose["services"]
    assert set(services) == {
        "traefik",
        "postgres",
        "migrate",
        "backend",
        "worker",
        "frontend",
        "mailpit",
        "mailer",
    }
    assert "profiles" not in services["mailer"]
    assert services["mailer"]["networks"] == ["data_net"]
    assert {name for name, value in services.items() if value.get("ports")} == {"traefik"}
    assert services["traefik"]["ports"] == ["80:80"]
    assert set(services["postgres"]["networks"]) == {"data_net"}
    assert set(services["mailpit"]["networks"]) == {"edge_net", "data_net"}
    assert set(services["worker"]["networks"]) == {"data_net"}
    assert set(services["backend"]["networks"]) == {"edge_net", "data_net"}
    assert set(compose["volumes"]) == {"postgres_data", "widget_assets", "mail_data", "hf_cache"}
    assert services["backend"]["depends_on"]["migrate"]["condition"] == "service_completed_successfully"
    assert not any("docker.sock" in volume for volume in services["traefik"]["volumes"])
    assert "--providers.file.directory=/etc/traefik/dynamic" in services["traefik"]["command"]
    workflow = yaml.safe_load((root / ".github/workflows/ci.yml").read_text())
    assert set(workflow["jobs"]) == {"backend", "postgres-integration", "frontend", "containers", "browser", "mailer"}
    assert all("deploy" not in job for job in workflow["jobs"])
    # This job starts with an empty cache volume and later recreates it after restore.
    # Embedding startup must be able to download the configured model in both runs.
    assert workflow["jobs"]["containers"].get("env", {}).get("HF_HUB_OFFLINE") not in {"1", 1}
    container_steps = workflow["jobs"]["containers"]["steps"]
    commands = "\n".join(step.get("run", "") for step in container_steps)
    assert "verify_stack.py --exercise" in commands
    assert "--restart --allow-interruption" in commands
    assert "restore_stack.sh" in commands and "--confirm-replace" in commands
    evidence = next(step for step in container_steps if step.get("uses", "").startswith("actions/upload-artifact@"))
    assert "stack-state" not in evidence["with"]["path"]
    assert "after-restore-state" not in evidence["with"]["path"]
    assert "*" not in evidence["with"]["path"]


def test_api_warms_local_embeddings_before_serving(monkeypatch):
    """Require embedding warmup during lifespan entry so first-request latency cannot hide an uninitialized model."""
    import asyncio
    from types import SimpleNamespace

    from app import main

    calls = []
    monkeypatch.setattr(
        main, "get_embedding_service", lambda: SimpleNamespace(embed_query=lambda text: calls.append(text))
    )

    async def start():
        """Enter the real lifespan context and assert that its controlled warmup completed before serving."""
        async with main.lifespan(main.app):
            assert calls == ["warmup"]

    asyncio.run(start())


def test_api_does_not_claim_ready_when_embedding_startup_fails(monkeypatch):
    """Keep the application unavailable if its embedding startup fails instead of advertising a healthy unusable API."""
    import asyncio
    from types import SimpleNamespace

    from app import main

    def fail(_text):
        """Simulate model-loading failure at the warmup boundary without downloading a real model."""
        raise RuntimeError("Unavailable local embedding model")

    monkeypatch.setattr(main, "get_embedding_service", lambda: SimpleNamespace(embed_query=fail))

    async def start():
        """Enter failing lifespan and reject any execution that reaches the serving context."""
        async with main.lifespan(main.app):
            pytest.fail("API must not serve before the local embedding model is ready")

    with pytest.raises(RuntimeError, match="Unavailable local embedding model"):
        asyncio.run(start())
