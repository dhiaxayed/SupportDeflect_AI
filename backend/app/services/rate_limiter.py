"""Sliding-window request admission for authentication, widget traffic and case polling.

A successful admission consumes an event independently of downstream request success.
Database mode shares limits across processes; memory mode is process-local.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
from threading import Lock

from sqlalchemy import func, select, text

from app.core.config import get_settings
from app.db import SessionLocal, is_postgres
from app.models import RateLimitEvent

settings = get_settings()


class BaseRateLimiter:
    """Boolean admission contract that records capacity only for successful admissions."""

    def allow(self, key: str, *, limit: int, window_seconds: int = 60) -> bool:
        """Admit and consume one event for key below limit in the requested sliding window.

        Return False when full; the base method raises NotImplementedError. Callers
        choose stable keys and translate rejection to HTTP without treating this as auth.
        """
        raise NotImplementedError


class InMemoryRateLimiter(BaseRateLimiter):
    """Simple per-process sliding-window limiter.

    Production uses DatabaseRateLimiter below so limits are shared across API
    processes. This implementation is an explicit local/test configuration.
    """

    def __init__(self) -> None:
        """Initialize per-key timestamp queues and their thread lock without persistence."""
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str, *, limit: int, window_seconds: int = 60) -> bool:
        """Prune expired timestamps and atomically admit one event in this process.

        Use wall-clock seconds and a per-instance lock. A successful downstream failure
        still consumes the event; process restarts or other replicas do not share it.
        """
        now = time.time()
        with self._lock:
            queue = self._events[key]
            while queue and queue[0] <= now - window_seconds:
                queue.popleft()
            if len(queue) >= limit:
                return False
            queue.append(now)
            return True


class DatabaseRateLimiter(BaseRateLimiter):
    """Distributed sliding-window limiter using the configured database."""

    def allow(self, key: str, *, limit: int, window_seconds: int = 60) -> bool:
        """Commit a database-backed admission decision for key and the supplied time window.

        PostgreSQL advisory locking serializes equal keys; SQLite cleanup reserves its
        writer. Cleanup is global, so callers must use compatible window durations
        (current routes use 60 seconds). Database failures propagate; there is no silent
        memory fallback, and admitted events survive downstream request failure.
        """
        cutoff = datetime.now(UTC) - timedelta(seconds=window_seconds)
        with SessionLocal() as db:
            if is_postgres():
                db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": key})
            db.query(RateLimitEvent).filter(RateLimitEvent.created_at <= cutoff).delete(synchronize_session=False)
            current_count = (
                db.scalar(
                    select(func.count(RateLimitEvent.id)).where(
                        RateLimitEvent.key == key,
                        RateLimitEvent.created_at > cutoff,
                    )
                )
                or 0
            )
            if current_count >= limit:
                db.commit()
                return False
            db.add(RateLimitEvent(key=key))
            db.commit()
            return True


def build_rate_limiter() -> BaseRateLimiter:
    """Construct the configured memory or database implementation for module-level reuse.

    Settings validation owns provider validity and production restrictions. Merely
    constructing the database limiter does not yet open a database session.
    """
    if settings.rate_limit_provider.lower() == "memory":
        return InMemoryRateLimiter()
    return DatabaseRateLimiter()


rate_limiter = build_rate_limiter()
