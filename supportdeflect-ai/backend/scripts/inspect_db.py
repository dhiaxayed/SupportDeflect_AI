from pathlib import Path
import sys

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
        database, schema, user = conn.execute(
            text("select current_database(), current_schema(), current_user")
        ).one()
        print(f"database={database}")
        print(f"schema={schema}")
        print(f"user={user}")
        for table in TABLES:
            count = conn.execute(text(f"select count(*) from {table}")).scalar()
            print(f"{table}={count}")
