"""Sliding-window request admission for authentication, widget traffic and case polling.

A successful admission consumes an event independently of downstream request success.
Database mode shares limits across processes; memory mode is process-local.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
from threading import Lock

from sqlalchemy import delete, func, select, text

from app.core.config import get_settings
from app.db import SessionLocal
from app.models import RateLimitEvent

settings = get_settings()
# All HTTP callers use 60 seconds. Retain a day to support longer independent
# policies too; maintenance must never remove events inside an accepted window.
MAX_WINDOW_SECONDS = 86400


def validate_window(limit: int, window_seconds: int) -> None:
    """Reject invalid policies before either implementation consumes capacity."""
    if limit < 1 or not 1 <= window_seconds <= MAX_WINDOW_SECONDS:
        raise ValueError("Rate limits require positive capacity and a window of 1..86400 seconds")


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

        Use monotonic seconds and a per-instance lock. A successful downstream failure
        still consumes the event; process restarts or other replicas do not share it.
        """
        validate_window(limit, window_seconds)
        with self._lock:
            now = time.monotonic()
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

        PostgreSQL advisory locking serializes equal keys; SQLite reserves its writer
        before counting. Admission touches only this key's live window, with no cleanup.
        Database failures propagate; there is no silent
        memory fallback, and admitted events survive downstream request failure.
        """
        validate_window(limit, window_seconds)
        with SessionLocal() as db:
            if db.bind.dialect.name == "postgresql":
                db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": key})
            elif db.bind.dialect.name == "sqlite":
                db.execute(text("BEGIN IMMEDIATE"))
            now = datetime.now(UTC)
            cutoff = now - timedelta(seconds=window_seconds)
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
            db.add(RateLimitEvent(key=key, created_at=now))
            db.commit()
            return True


def cleanup_expired_events(*, batch_size: int = 1000) -> int:
    """Remove a bounded batch outside every supported window in a separate worker transaction.

    The created_at index avoids full-table expiry scans. PostgreSQL workers skip
    each other's locked rows; SQLite serializes this short maintenance write.
    Return the number deleted; database failures propagate for supervisor visibility.
    """
    if batch_size < 1:
        raise ValueError("Cleanup batch size must be positive")
    cutoff = datetime.now(UTC) - timedelta(seconds=MAX_WINDOW_SECONDS)
    with SessionLocal() as db:
        if db.bind.dialect.name == "sqlite":
            db.execute(text("BEGIN IMMEDIATE"))
        expired = select(RateLimitEvent.id).where(RateLimitEvent.created_at <= cutoff).order_by(
            RateLimitEvent.created_at, RateLimitEvent.id,
        ).limit(batch_size)
        if db.bind.dialect.name == "postgresql":
            expired = expired.with_for_update(skip_locked=True)
        ids = list(db.scalars(expired))
        if ids:
            db.execute(delete(RateLimitEvent).where(RateLimitEvent.id.in_(ids)))
        db.commit()
        return len(ids)


def build_rate_limiter() -> BaseRateLimiter:
    """Construct the configured memory or database implementation for module-level reuse.

    Settings validation owns provider validity and production restrictions. Merely
    constructing the database limiter does not yet open a database session.
    """
    if settings.rate_limit_provider.lower() == "memory":
        return InMemoryRateLimiter()
    return DatabaseRateLimiter()


rate_limiter = build_rate_limiter()
