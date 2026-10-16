"""Assemble FastAPI routes and middleware, configure safe process logging, warm local embeddings at startup and
expose liveness/schema readiness endpoints.
"""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db import SessionLocal, init_db, required_schema_revision
from app.routers import analytics, auth, billing, chat, documents, mail, platform, support_cases, team, widget
from app.routers import settings as settings_router
from app.services.embeddings import get_embedding_service
from app.widget_cors import WidgetCORSMiddleware

settings = get_settings()
configure_logging(settings.debug)


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Optionally run explicitly enabled migrations, then warm local embeddings in a thread before serving
    requests. Startup failures propagate rather than advertising a ready API; yield controls the application's
    running lifetime.
    """
    if settings.init_database_on_startup:
        init_db()
    # Cold model imports/loading belong to startup, not the visitor's first timed request.
    await asyncio.to_thread(lambda: get_embedding_service().embed_query("warmup"))
    yield


app = FastAPI(
    title=settings.app_name,
    version="2.0.0",
    description="Multi-tenant SaaS RAG support chatbot platform with embeddable JavaScript widget.",
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url="/redoc" if settings.docs_enabled else None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(WidgetCORSMiddleware)
if settings.enforce_trusted_hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)


@app.get("/", tags=["health"])
def root() -> dict[str, str]:
    """Return the configured application name and a lightweight public status marker; this performs no dependency
    or database readiness check.
    """
    return {"name": settings.app_name, "status": "ok"}


@app.get("/healthz", tags=["health"])
def healthz() -> dict[str, str]:
    """Return process liveness only. Database schema and AI/provider availability are verified by their separate
    readiness/administration checks.
    """
    return {"status": "healthy"}


@app.get("/healthz/db", tags=["health"])
def db_healthz() -> dict[str, str]:
    """Check connectivity and the installed Alembic revision through a short-lived Session. Return healthy only at
    the current script head; convert dependency/schema failures to sanitized HTTP 503.
    """
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
            version = db.scalar(text("SELECT version_num FROM alembic_version"))
            if version != required_schema_revision():
                raise ValueError("Schema revision is not current")
    except Exception:
        raise HTTPException(503, "Database or schema is not ready") from None
    return {"status": "healthy"}


app.include_router(auth.router, prefix=settings.api_v1_prefix)
app.include_router(documents.router, prefix=settings.api_v1_prefix)
app.include_router(chat.router, prefix=settings.api_v1_prefix)
app.include_router(widget.router, prefix=settings.api_v1_prefix)
app.include_router(analytics.router, prefix=settings.api_v1_prefix)
app.include_router(settings_router.router, prefix=settings.api_v1_prefix)
app.include_router(platform.router, prefix=settings.api_v1_prefix)
app.include_router(team.router, prefix=settings.api_v1_prefix)
app.include_router(support_cases.router, prefix=settings.api_v1_prefix)
app.include_router(billing.router, prefix=settings.api_v1_prefix)
app.include_router(mail.router, prefix=settings.api_v1_prefix)
app.include_router(mail.internal_router, prefix=settings.api_v1_prefix)
