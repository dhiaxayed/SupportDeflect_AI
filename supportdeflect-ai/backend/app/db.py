import logging
from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


def normalize_database_url(database_url: str) -> str:
    """Use psycopg v3 for plain PostgreSQL URLs supplied by hosts like Neon."""
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    if database_url.startswith("postgres://"):
        return database_url.replace("postgres://", "postgresql+psycopg://", 1)
    return database_url


database_url = normalize_database_url(settings.database_url)
connect_args = (
    {"check_same_thread": False}
    if database_url.startswith("sqlite")
    else {"connect_timeout": 10}
)

engine = create_engine(
    database_url,
    pool_pre_ping=True,
    pool_recycle=300,
    connect_args=connect_args,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    # Import models before create_all so SQLAlchemy sees all tables.
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    ensure_app_schema()
    ensure_pgvector_schema()


def is_postgres() -> bool:
    return engine.dialect.name == "postgresql"


def ensure_app_schema() -> None:
    if is_postgres():
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_plan varchar(32)"))
            connection.execute(
                text("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status varchar(32)")
            )
            connection.execute(text("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz"))
            connection.execute(
                text("UPDATE organizations SET subscription_plan = 'trial' WHERE subscription_plan IS NULL")
            )
            connection.execute(
                text("UPDATE organizations SET subscription_status = 'active' WHERE subscription_status IS NULL")
            )
            connection.execute(text("ALTER TABLE organizations ALTER COLUMN subscription_plan SET DEFAULT 'trial'"))
            connection.execute(text("ALTER TABLE organizations ALTER COLUMN subscription_status SET DEFAULT 'active'"))
            connection.execute(text("ALTER TABLE organizations ALTER COLUMN subscription_plan SET NOT NULL"))
            connection.execute(text("ALTER TABLE organizations ALTER COLUMN subscription_status SET NOT NULL"))
        return

    if engine.dialect.name == "sqlite":
        with engine.begin() as connection:
            columns = {
                row[1]
                for row in connection.execute(text("PRAGMA table_info(organizations)")).fetchall()
            }
            if "subscription_plan" not in columns:
                connection.execute(
                    text("ALTER TABLE organizations ADD COLUMN subscription_plan varchar(32) DEFAULT 'trial'")
                )
            if "subscription_status" not in columns:
                connection.execute(
                    text("ALTER TABLE organizations ADD COLUMN subscription_status varchar(32) DEFAULT 'active'")
                )
            if "trial_ends_at" not in columns:
                connection.execute(text("ALTER TABLE organizations ADD COLUMN trial_ends_at datetime"))


def ensure_pgvector_schema() -> bool:
    """Enable pgvector for Neon/Postgres while keeping SQLite local dev simple."""
    if not is_postgres():
        return False

    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            connection.execute(
                text(
                    "ALTER TABLE vector_chunks "
                    f"ADD COLUMN IF NOT EXISTS embedding_vector vector({settings.embedding_dimension})"
                )
            )
            connection.execute(
                text(
                    "UPDATE vector_chunks "
                    "SET embedding_vector = embedding::text::vector "
                    "WHERE embedding_vector IS NULL AND embedding IS NOT NULL"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_vector_chunks_embedding_vector "
                    "ON vector_chunks USING hnsw (embedding_vector vector_cosine_ops)"
                )
            )
        return True
    except SQLAlchemyError as exc:
        logger.warning("pgvector schema setup skipped; database vector search will use JSON fallback: %s", exc)
        return False
