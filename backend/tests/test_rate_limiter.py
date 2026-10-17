"""Real SQLite transaction/concurrency and bounded maintenance regressions for shared admission."""

import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.exc import OperationalError

from app.db import SessionLocal, engine
from app.models import RateLimitEvent
from app.services import rate_limiter as module
from app.services.rate_limiter import DatabaseRateLimiter, cleanup_expired_events


def test_boundaries_expiration_and_no_request_cleanup(monkeypatch):
    """Admit exactly the limit, exclude the exact cutoff and execute no DELETE on the request path."""
    now = datetime(2026, 10, 16, 12, tzinfo=UTC)

    class Clock:
        """Control the service clock without sleeping across a sliding-window boundary."""

        @staticmethod
        def now(_):
            """Return the deterministic UTC admission time."""
            return now

    monkeypatch.setattr(module, "datetime", Clock)
    with SessionLocal() as db:
        db.add_all([
            RateLimitEvent(key="same", created_at=now - timedelta(seconds=60)),
            RateLimitEvent(key="other", created_at=now - timedelta(days=2)),
        ])
        db.commit()
    statements = []

    def record(_, __, statement, *args):
        """Capture actual issued SQL to verify admission performs no global expiry write."""
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        limiter = DatabaseRateLimiter()
        assert limiter.allow("same", limit=2)
        assert limiter.allow("same", limit=2)
        assert not limiter.allow("same", limit=2)
        now += timedelta(seconds=60)
        assert limiter.allow("same", limit=2)
        assert not any(sql.lstrip().upper().startswith("DELETE") for sql in statements)
    finally:
        event.remove(engine, "before_cursor_execute", record)
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(RateLimitEvent).where(RateLimitEvent.key == "other")) == 1


@pytest.mark.parametrize("shared_key", [True, False])
def test_separate_instances_and_connections_admit_atomically(shared_key):
    """Competing workers share a key's capacity while distinct keys retain independent budgets."""
    barrier = Barrier(8)

    def admit(index):
        """Start separate limiter instances at the same barrier against the real shared SQLite database."""
        barrier.wait(timeout=10)
        return DatabaseRateLimiter().allow("shared" if shared_key else f"key-{index}", limit=3)

    with ThreadPoolExecutor(max_workers=8) as pool:
        decisions = list(pool.map(admit, range(8)))
    assert sum(decisions) == (3 if shared_key else 8)


def test_admission_is_shared_across_processes():
    """Independent Python workers must not each admit a fresh process-local allowance."""
    assert str(engine.url) == os.environ["DATABASE_URL"], "Test helpers must not replace the inherited database URL"
    script = (
        "from app.services.rate_limiter import DatabaseRateLimiter; "
        "r=DatabaseRateLimiter(); print(sum(r.allow('multiprocess', limit=4) for _ in range(4)))"
    )
    workers = [subprocess.Popen([sys.executable, "-c", script], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               cwd=Path(__file__).resolve().parents[1])
               for _ in range(3)]
    try:
        results = [worker.communicate(timeout=40) for worker in workers]
        for worker, (_, stderr) in zip(workers, results, strict=True):
            assert worker.returncode == 0, stderr.decode()
        assert sum(int(stdout) for stdout, _ in results) == 4
    finally:
        for worker in workers:
            if worker.poll() is None:
                worker.kill()
                worker.wait()


def test_cleanup_is_bounded_and_preserves_every_live_window():
    """Remove abandoned keys off-request in small batches without affecting a day-long policy."""
    now = datetime.now(UTC)
    with SessionLocal() as db:
        db.add_all([RateLimitEvent(key=f"expired-{i}", created_at=now - timedelta(days=2)) for i in range(5)])
        db.add(RateLimitEvent(key="live", created_at=now - timedelta(hours=12)))
        db.commit()
    assert cleanup_expired_events(batch_size=2) == 2
    assert cleanup_expired_events(batch_size=2) == 2
    assert cleanup_expired_events(batch_size=2) == 1
    assert cleanup_expired_events(batch_size=2) == 0
    assert not DatabaseRateLimiter().allow("live", limit=1, window_seconds=86400)


def test_database_failure_is_not_silently_admitted(monkeypatch):
    """A failed event commit must propagate and roll back instead of granting unrecorded capacity."""
    from sqlalchemy.orm import Session

    with monkeypatch.context() as patch:
        def fail_commit(_):
            """Simulate storage failure after admission has staged its event."""
            raise OperationalError("fixture", {}, Exception("unavailable"))

        patch.setattr(Session, "commit", fail_commit)
        with pytest.raises(OperationalError):
            DatabaseRateLimiter().allow("failed", limit=1)
    assert DatabaseRateLimiter().allow("failed", limit=1)
    assert not DatabaseRateLimiter().allow("failed", limit=1)


@pytest.mark.parametrize("limit,window", [(0, 60), (1, 0), (1, 86401)])
def test_maintenance_retention_bounds_supported_policies(limit, window):
    """Both providers reject policies whose events could be removed while still live."""
    for limiter in (DatabaseRateLimiter(), module.InMemoryRateLimiter()):
        with pytest.raises(ValueError):
            limiter.allow("invalid", limit=limit, window_seconds=window)
