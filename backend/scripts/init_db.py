"""Direct CLI wrapper around canonical Alembic initialization; run from the backend environment with the intended
DATABASE_URL. Execution upgrades to head and prints completion, rather than creating tables from live ORM
metadata.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import init_db

if __name__ == "__main__":
    init_db()
    print("Database schema initialized.")
