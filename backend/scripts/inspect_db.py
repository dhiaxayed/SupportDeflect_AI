"""Read-only PostgreSQL operator inspection of configured database/schema/user and selected table counts. The fixed
table allowlist avoids identifier input; PostgreSQL catalog functions mean this is not a SQLite inspection
command.
"""

import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import engine

TABLES = [
    "organizations",
    "users",
    "documents",
    "conversation_logs",
    "vector_chunks",
    "rate_limit_events",
]


if __name__ == "__main__":
    with engine.connect() as conn:
        database, schema, user = conn.execute(text("select current_database(), current_schema(), current_user")).one()
        print(f"database={database}")
        print(f"schema={schema}")
        print(f"user={user}")
        for table in TABLES:
            count = conn.execute(text(f"select count(*) from {table}")).scalar()
            print(f"{table}={count}")
