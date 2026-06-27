import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import time

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db import init_db
from app.services.ingestion_jobs import process_next_ingestion_job


def main() -> None:
    settings = get_settings()
    configure_logging(settings.debug)
    init_db()
    print("Ingestion worker started.")
    while True:
        processed = process_next_ingestion_job()
        if not processed:
            time.sleep(settings.ingestion_worker_poll_seconds)


if __name__ == "__main__":
    main()
