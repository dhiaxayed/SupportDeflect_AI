from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db import SessionLocal, init_db
from app.routers import analytics, auth, chat, documents, widget
from app.routers import settings as settings_router

settings = get_settings()
configure_logging(settings.debug)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.init_database_on_startup:
        init_db()
    yield


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Multi-tenant SaaS RAG support chatbot platform with embeddable JavaScript widget.",
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url="/redoc" if settings.docs_enabled else None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
    lifespan=lifespan,
)

if settings.enforce_trusted_hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", tags=["health"])
def root() -> dict[str, str]:
    return {"name": settings.app_name, "status": "ok"}


@app.get("/healthz", tags=["health"])
def healthz() -> dict[str, str]:
    return {"status": "healthy"}


@app.get("/healthz/db", tags=["health"])
def db_healthz() -> dict[str, str]:
    with SessionLocal() as db:
        row = db.execute(text("select current_database(), current_schema(), current_user")).one()
    if not settings.debug:
        return {"status": "healthy"}
    return {
        "status": "healthy",
        "database": str(row[0]),
        "schema": str(row[1]),
        "user": str(row[2]),
    }


app.include_router(auth.router, prefix=settings.api_v1_prefix)
app.include_router(documents.router, prefix=settings.api_v1_prefix)
app.include_router(chat.router, prefix=settings.api_v1_prefix)
app.include_router(widget.router, prefix=settings.api_v1_prefix)
app.include_router(analytics.router, prefix=settings.api_v1_prefix)
app.include_router(settings_router.router, prefix=settings.api_v1_prefix)
