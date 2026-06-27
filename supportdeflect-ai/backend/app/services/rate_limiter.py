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
    def allow(self, key: str, *, limit: int, window_seconds: int = 60) -> bool:
        raise NotImplementedError


class InMemoryRateLimiter(BaseRateLimiter):
    """Simple per-process sliding-window limiter.

    For production, replace this with Redis so limits are shared across API
    replicas and survive restarts.
    """

    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str, *, limit: int, window_seconds: int = 60) -> bool:
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
        cutoff = datetime.now(UTC) - timedelta(seconds=window_seconds)
        with SessionLocal() as db:
            if is_postgres():
                db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": key})
            db.query(RateLimitEvent).filter(RateLimitEvent.created_at <= cutoff).delete(synchronize_session=False)
            current_count = db.scalar(
                select(func.count(RateLimitEvent.id)).where(
                    RateLimitEvent.key == key,
                    RateLimitEvent.created_at > cutoff,
                )
            ) or 0
            if current_count >= limit:
                db.commit()
                return False
            db.add(RateLimitEvent(key=key))
            db.commit()
            return True


def build_rate_limiter() -> BaseRateLimiter:
    if settings.rate_limit_provider.lower() == "memory":
        return InMemoryRateLimiter()
    return DatabaseRateLimiter()


rate_limiter = build_rate_limiter()
