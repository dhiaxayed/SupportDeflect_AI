"""Own the configured SQLAlchemy engine/session factory, explicit migration entry point and schema readiness
helpers. Importing creates the engine, but application writes remain caller-controlled transactions.
"""

from collections.abc import Generator
from functools import lru_cache
from pathlib import Path

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import get_settings

settings = get_settings()


def normalize_database_url(database_url: str) -> str:
    """Translate common PostgreSQL URL prefixes to the psycopg SQLAlchemy driver; return other database URLs
    unchanged without opening a connection.
    """
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    if database_url.startswith("postgres://"):
        return database_url.replace("postgres://", "postgresql+psycopg://", 1)
    return database_url


database_url = normalize_database_url(settings.database_url)
engine = create_engine(
    database_url,
    pool_pre_ping=True,
    pool_recycle=300,
    connect_args={"check_same_thread": False} if database_url.startswith("sqlite") else {"connect_timeout": 10},
)
if engine.dialect.name == "sqlite":

    @event.listens_for(engine, "connect")
    def enable_sqlite_foreign_keys(connection, _):
        """Enable foreign-key enforcement on each newly opened SQLite DBAPI connection; the unused pool-record
        argument is supplied by SQLAlchemy's connect event.
        """
        connection.execute("PRAGMA foreign_keys=ON")


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """Shared declarative metadata registry for application models and Alembic inspection; declaring a model does
    not create its database table.
    """

    pass


def get_db() -> Generator:
    """Yield one request-scoped Session and close it on completion or failure. Routes/services explicitly commit
    writes; closing rolls back any unfinished transaction.
    """
    with SessionLocal() as db:
        yield db


def init_db() -> None:
    """Explicit CLI/local migration entry point; production uses the migrate service."""
    from alembic import command
    from alembic.config import Config

    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "head")


@lru_cache
def required_schema_revision() -> str:
    """Read and cache the current Alembic script head for readiness comparisons; this inspects migration files and
    never upgrades a database.
    """
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    return ScriptDirectory.from_config(config).get_current_head()


def is_postgres() -> bool:
    """Return whether the configured engine dialect is PostgreSQL, selecting native pgvector behavior rather than
    SQLite JSON storage.
    """
    return engine.dialect.name == "postgresql"


def has_pgvector_schema() -> bool:
    """Return whether PostgreSQL exposes vector_chunks.embedding_vector in the current schema; return False for
    SQLite. Database errors propagate to the caller's readiness/error boundary.
    """
    if not is_postgres():
        return False
    with engine.connect() as connection:
        return bool(
            connection.scalar(
                text(
                    "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                    "WHERE table_schema = current_schema() AND table_name = 'vector_chunks' "
                    "AND column_name = 'embedding_vector')"
                )
            )
        )
