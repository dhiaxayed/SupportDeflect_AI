"""Shared disposable API/database fixtures for backend tests.

Environment overrides are established before importing the application, so database
resets and explicit fake AI/in-memory providers cannot affect the normal tenant DB.
Each test receives fresh tables and reset provider state; helpers return real API JWTs."""

import os
import tempfile
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

TEST_DIR = tempfile.mkdtemp(prefix="supportdeflect-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DIR}/test.db"
os.environ["SECRET_KEY"] = "test-only-secret-key-with-at-least-32-bytes"
os.environ["EMBEDDING_PROVIDER"] = "fake"
os.environ["VECTOR_PROVIDER"] = "memory"
os.environ["LLM_PROVIDER"] = "mock"
os.environ["RATE_LIMIT_PROVIDER"] = "memory"
os.environ["INGESTION_MODE"] = "inline"
os.environ["INIT_DATABASE_ON_STARTUP"] = "false"
os.environ["ENVIRONMENT"] = "test"
os.environ["CORS_ORIGINS"] = '["http://localhost:5173","http://testserver"]'
os.environ["TRUSTED_HOSTS"] = '["testserver","localhost","127.0.0.1"]'

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def reset_database() -> Generator[None, None, None]:
    """Recreate fixture tables and reset memory providers before each test; yield once without touching the normal
    database.
    """
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    # Reset the in-memory vector store between tests.
    import app.services.vector_store as vector_store_module

    vector_store_module._vector_store = None
    import app.services.rate_limiter as limiter

    limiter.rate_limiter._events.clear()
    yield


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    """Yield a real FastAPI test client with startup/shutdown lifespan around the current disposable schema."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth_headers(client: TestClient) -> dict[str, str]:
    """Register the synthetic Acme tenant administrator and return its Bearer authorization header for API tests."""
    response = client.post(
        "/api/v1/auth/register",
        json={
            "organization_name": "Acme SaaS",
            "admin_email": "admin@example.com",
            "password": "secure-password",
            "admin_full_name": "Admin User",
        },
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def register_org(client: TestClient, name: str, email: str) -> tuple[dict[str, str], dict]:
    """Create a named fixture tenant, approve customer.example for widget calls, and return authorization headers plus
    the account payload.
    """
    response = client.post(
        "/api/v1/auth/register",
        json={
            "organization_name": name,
            "admin_email": email,
            "password": "secure-password",
        },
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    from app.db import SessionLocal
    from app.models import Organization

    with SessionLocal() as db:
        org = db.get(Organization, payload["user"]["organization"]["id"])
        org.allowed_domains = ["customer.example"]
        db.commit()
    return {"Authorization": f"Bearer {payload['access_token']}"}, payload
