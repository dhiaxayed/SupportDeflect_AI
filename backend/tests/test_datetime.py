"""Prove that API/database timestamps retain the instant and carry an explicit UTC offset.

Both pure conversion and a real SQLite round trip are covered, since SQLite otherwise
returns naive datetimes even when incoming values include a different UTC offset."""

from datetime import UTC, datetime, timedelta, timezone

from app.core.datetime import as_utc


def test_database_timestamps_are_normalized_without_changing_the_instant():
    """Normalize naive/offset-aware inputs to UTC while preserving the actual instant rather than only changing the
    timezone label.
    """
    naive = datetime(2026, 10, 3, 12)
    assert as_utc(naive) == naive.replace(tzinfo=UTC)
    offset = datetime(2026, 10, 3, 14, tzinfo=timezone(timedelta(hours=2)))
    assert as_utc(offset) == as_utc(naive)
    assert as_utc(offset).tzinfo is UTC
    assert as_utc(None) is None


def test_sqlite_roundtrip_preserves_non_utc_input_instant(client, auth_headers):
    """Persist a non-UTC fixture timestamp through SQLite and require its reloaded/API representation to retain the
    same instant.
    """
    from app.db import SessionLocal
    from app.models import Organization
    from tests.test_product_consistency import tenant_id

    value = datetime(2026, 10, 3, 14, tzinfo=timezone(timedelta(hours=2)))
    org_id = tenant_id(auth_headers)
    with SessionLocal() as db:
        db.get(Organization, org_id).trial_ends_at = value
        db.commit()
    with SessionLocal() as db:
        stored = db.get(Organization, org_id).trial_ends_at
        assert stored == value and stored.tzinfo is UTC and stored.hour == 12
