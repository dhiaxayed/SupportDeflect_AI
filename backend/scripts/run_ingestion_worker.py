"""Standalone durable ingestion consumer using configured provider/database settings. A successful loop iteration
updates the health heartbeat; queue processing owns its short claim/result transactions.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import time

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.services.ingestion_jobs import process_next_ingestion_job
from app.services.rate_limiter import cleanup_expired_events


def main() -> None:
    """Configure safe logging and process jobs until interrupted, touching the platform-appropriate heartbeat after
    each cycle. Sleep only when no job was processed; unrecovered exceptions stop the process for supervisor
    visibility.
    """
    settings = get_settings()
    configure_logging(settings.debug)
    print("Ingestion worker started.")
    next_cleanup = 0.0
    while True:
        processed = process_next_ingestion_job()
        if settings.rate_limit_provider == "database" and time.monotonic() >= next_cleanup:
            removed = cleanup_expired_events()
            # Drain a backlog over short transactions without delaying every admission.
            next_cleanup = time.monotonic() + (1 if removed == 1000 else 60)
        Path(
            "/tmp/supportdeflect-worker-heartbeat" if sys.platform != "win32" else "supportdeflect-worker-heartbeat"
        ).touch()
        if not processed:
            time.sleep(settings.ingestion_worker_poll_seconds)


if __name__ == "__main__":
    main()
