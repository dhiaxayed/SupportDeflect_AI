"""Alembic entry point for offline SQL rendering or online transactional upgrades. Prefer an explicit Alembic URL,
otherwise use normalized runtime settings; model imports populate metadata and batch rendering supports SQLite
alterations.
"""

from sqlalchemy import create_engine, pool

from alembic import context
from app import models  # noqa: F401
from app.core.config import get_settings
from app.db import Base, normalize_database_url

config = context.config
url = config.get_main_option("sqlalchemy.url") or normalize_database_url(get_settings().database_url)

if context.is_offline_mode():
    context.configure(url=url, target_metadata=Base.metadata, literal_binds=True, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = create_engine(url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()
