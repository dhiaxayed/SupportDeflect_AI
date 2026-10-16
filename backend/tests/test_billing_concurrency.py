"""Real concurrent ledger writes must preserve idempotency and the refund ceiling."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier, current_thread
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.admin_schemas import PaymentCreate, RefundCreate
from app.db import SessionLocal
from app.models import AuditEvent, BillingEntry, Organization, User
from app.services.billing import record_payment, refund


@pytest.fixture
def ledger():
    """Persist one synthetic organization/platform actor and return their IDs for separate competing database
    sessions.
    """
    with SessionLocal() as db:
        org = Organization(public_id="ledger_fixture", name="Ledger", widget_brand_name="Ledger", widget_greeting="Hi")
        actor = User(email="operator@example.com", hashed_password="unused-fixture-hash", role="super_admin")
        db.add_all([org, actor])
        db.commit()
        return org.id, actor.id


def payment_payload(org_id, *, key=None, amount=100):
    """Build a valid received-payment DTO, allowing the UUID or amount to vary across the concurrency scenarios."""
    return PaymentCreate(
        org_id=org_id,
        amount_minor=amount,
        currency="EUR",
        occurred_at=datetime.now(UTC),
        idempotency_key=key or uuid4(),
    )


@pytest.mark.parametrize("conflicting", [False, True])
def test_concurrent_payment_idempotency(ledger, monkeypatch, conflicting):
    """Race real unique-key inserts and require one ledger/audit entry, with identical replays accepted and
    conflicting amounts rejected.
    """
    org_id, actor_id = ledger
    key = uuid4()
    ready = Barrier(2)
    scalar = Session.scalar

    def synchronized_lookup(db, statement, *args, **kwargs):
        """Pause each worker after its first real key lookup so both observe absence before insertion; never fabricate
        a SQL result.
        """
        result = scalar(db, statement, *args, **kwargs)
        # Force both real transactions to observe the key as absent before either inserts.
        if (
            current_thread().name.startswith("ledger-payment")
            and "billing_entries.idempotency_key =" in str(statement)
            and not db.info.get("synchronized")
        ):
            db.info["synchronized"] = True
            ready.wait(timeout=15)
        return result

    monkeypatch.setattr(Session, "scalar", synchronized_lookup)

    def write(amount):
        """Record one payment in a dedicated session and expose only the resulting receipt or HTTP conflict status."""
        with SessionLocal() as db:
            try:
                return record_payment(payment_payload(org_id, key=key, amount=amount), db, db.get(User, actor_id))
            except HTTPException as exc:
                return exc.status_code

    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="ledger-payment") as pool:
        results = list(pool.map(write, [100, 200 if conflicting else 100]))
    if conflicting:
        assert len([result for result in results if result == 409]) == 1
        assert len([result for result in results if isinstance(result, dict)]) == 1
    else:
        assert results[0]["id"] == results[1]["id"]
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(BillingEntry)) == 1
        assert (
            db.scalar(
                select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "billing.payment_recorded")
            )
            == 1
        )


def test_concurrent_refunds_cannot_exceed_payment(ledger, monkeypatch):
    """Race two refunds against one payment and require the persisted total to remain within the received amount."""
    org_id, actor_id = ledger
    with SessionLocal() as db:
        payment = record_payment(payment_payload(org_id), db, db.get(User, actor_id))
    ready = Barrier(2)
    scalar = Session.scalar

    def synchronized_total(db, statement, *args, **kwargs):
        """Synchronize the first unreserved balance read while allowing fixed writer-reserved transactions to proceed
        without a test deadlock.
        """
        result = scalar(db, statement, *args, **kwargs)
        if (
            current_thread().name.startswith("ledger-refund")
            and "sum(billing_entries.amount_minor)" in str(statement)
            and not db.info.get("refund_total_checked")
        ):
            db.info["refund_total_checked"] = True
            # Fixed SQLite transactions reserve the writer before this read. Waiting here
            # would deadlock them; synchronize only the original, unreserved implementation.
            connection = db.connection().connection.driver_connection
            if not connection.in_transaction:
                ready.wait(timeout=15)
        return result

    monkeypatch.setattr(Session, "scalar", synchronized_total)

    def write(_):
        """Attempt one independent refund transaction and return its receipt or business rejection status."""
        with SessionLocal() as db:
            try:
                return refund(
                    payment["id"],
                    RefundCreate(amount_minor=70, note="Fixture refund", idempotency_key=uuid4()),
                    db,
                    db.get(User, actor_id),
                )
            except HTTPException as exc:
                return exc.status_code

    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="ledger-refund") as pool:
        results = list(pool.map(write, range(2)))
    assert len([result for result in results if isinstance(result, dict)]) == 1
    assert 409 in results
    with SessionLocal() as db:
        assert db.scalar(select(func.sum(BillingEntry.amount_minor)).where(BillingEntry.kind == "refund")) == 70
