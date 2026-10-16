"""Manual ledger operations. Each write commits the entry and its audit/outbox together.

Amounts stay in integer minor units and currencies are never implicitly converted.
These services record operator-confirmed cash movements, not payment-gateway calls.
"""

from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.admin_schemas import Currency, PaymentCreate, RefundCreate
from app.core.datetime import as_utc
from app.models import BillingEntry, Organization, User
from app.services.audit import record_audit_event
from app.services.mailing import notify_org
from app.services.organizations import get_org


def payment_out(db, item):
    """Return one ledger response with its organization name and aggregate refunds.

    The persisted entry and its organization must exist. Reads use the caller's
    session; no mutation or commit occurs, and database failures propagate.
    """
    org = db.get(Organization, item.org_id)
    refunded = db.scalar(
        select(func.coalesce(func.sum(BillingEntry.amount_minor), 0)).where(BillingEntry.refund_of_id == item.id)
    )
    return serialize_payment(item, org.name, refunded)


def serialize_payment(item: BillingEntry, organization_name: str, refunded: int) -> dict:
    """Build a ledger response from an entry, organization label and refund total.

    Amounts remain integer minor units; the supplied total is not recomputed here.
    This pure mapping is shared by individual replies and page-scoped list queries.
    """
    return dict(
        id=item.id,
        org_id=item.org_id,
        organization_name=organization_name,
        kind=item.kind,
        amount_minor=item.amount_minor,
        currency=item.currency,
        reference=item.reference,
        note=item.note,
        occurred_at=item.occurred_at,
        created_at=item.created_at,
        refunded_minor=refunded,
        refund_of_id=item.refund_of_id,
    )


def list_payments(db: Session, *, page: int, org_id: str | None, currency: Currency, days: int) -> dict:
    """Return a 25-row page and count for the requested currency, lookback and tenant.

    Refund totals are aggregated for the selected IDs in one extra query rather
    than per row. Caller validation/authorization precedes this read-only service;
    rows are not converted between currencies or committed.
    """
    filters = [BillingEntry.currency == currency, BillingEntry.occurred_at >= datetime.now(UTC) - timedelta(days=days)]
    if org_id:
        filters.append(BillingEntry.org_id == org_id)
    rows = db.execute(
        select(BillingEntry, Organization.name)
        .join(Organization)
        .where(*filters)
        .order_by(BillingEntry.occurred_at.desc())
        .offset((page - 1) * 25)
        .limit(25)
    ).all()
    # Refund totals are scoped to the page; query count does not grow with its rows.
    ids = [item.id for item, _ in rows]
    refunds = (
        dict(
            db.execute(
                select(BillingEntry.refund_of_id, func.sum(BillingEntry.amount_minor))
                .where(BillingEntry.refund_of_id.in_(ids))
                .group_by(BillingEntry.refund_of_id)
            ).all()
        )
        if ids
        else {}
    )
    return dict(
        items=[serialize_payment(item, name, refunds.get(item.id, 0)) for item, name in rows],
        page=page,
        page_size=25,
        total=db.scalar(select(func.count()).select_from(BillingEntry).where(*filters)),
    )


def _payment_replay(db: Session, existing: BillingEntry, payload: PaymentCreate) -> dict:
    """Return a committed payment only if the idempotency key matches its core inputs.

    Organization, amount, currency and kind must match; otherwise raise HTTP 409.
    Replays perform reads only and do not duplicate audit entries or notifications.
    """
    if (existing.kind, existing.org_id, existing.amount_minor, existing.currency) != (
        "payment",
        payload.org_id,
        payload.amount_minor,
        payload.currency,
    ):
        raise HTTPException(409, "Idempotency key already used for another payment")
    return payment_out(db, existing)


def _refund_replay(db: Session, existing: BillingEntry, payment_id: str, payload: RefundCreate) -> dict:
    """Return an existing refund only for the same original payment and amount.

    A reused key belonging to another kind/payment/amount raises HTTP 409.
    No additional cash movement, audit record or commit is produced by a replay.
    """
    if (
        existing.kind != "refund"
        or existing.refund_of_id != payment_id
        or existing.amount_minor != payload.amount_minor
    ):
        raise HTTPException(409, "Idempotency key already used")
    return payment_out(db, existing)


def _find_idempotent_entry(db: Session, key) -> BillingEntry | None:
    """Look up the globally unique ledger idempotency key, returning a row or None.

    The key is normalized to its string form. This read alone does not serialize
    new submissions; database uniqueness decides concurrent insert races.
    """
    return db.scalar(select(BillingEntry).where(BillingEntry.idempotency_key == str(key)))


def record_payment(payload: PaymentCreate, db: Session, actor: User) -> dict:
    """Record an operator-confirmed receipt and return its serialized ledger entry.

    Validated inputs use integer minor units; archived organizations raise HTTP 409
    and future receipts raise HTTP 422. This service commits payment, audit and
    optional outbox mail together. Concurrent key winners are replayed after rollback;
    conflicting payloads raise HTTP 409 and unrelated integrity errors propagate.
    """
    existing = _find_idempotent_entry(db, payload.idempotency_key)
    if existing:
        return _payment_replay(db, existing, payload)
    org = get_org(db, payload.org_id)
    if org.archived_at:
        raise HTTPException(409, "Restore the organization before recording a payment")
    if as_utc(payload.occurred_at) > datetime.now(UTC) + timedelta(minutes=1):
        raise HTTPException(422, "A received payment cannot be dated in the future")
    item = BillingEntry(
        **payload.model_dump(exclude={"idempotency_key"}),
        idempotency_key=str(payload.idempotency_key),
        created_by=actor.id,
        kind="payment",
    )
    db.add(item)
    try:
        db.flush()
    except IntegrityError:
        # Another request may commit the key after our initial lookup. The unique
        # constraint chooses the winner; replay it without duplicating audit/mail.
        db.rollback()
        existing = _find_idempotent_entry(db, payload.idempotency_key)
        if existing is None:
            raise
        return _payment_replay(db, existing, payload)
    record_audit_event(
        db,
        scope="platform",
        action="billing.payment_recorded",
        target_type="payment",
        target_id=item.id,
        org_id=org.id,
        actor=actor,
        metadata={"amount_minor": item.amount_minor, "currency": item.currency},
    )
    scale = 1000 if item.currency == "TND" else 100
    notify_org(
        db,
        org,
        "payment_received",
        "Confirmation de votre encaissement",
        f"Un encaissement de {item.amount_minor / scale:.3f} {item.currency} a ete enregistre pour {org.name}.",
    )
    db.commit()
    return payment_out(db, item)


def refund(payment_id: str, payload: RefundCreate, db: Session, actor: User):
    """Record a refund against one payment without exceeding its remaining balance.

    Lock the original payment before summing refunds; SQLite first reserves its
    writer because it ignores row locks. Missing payments raise HTTP 404 and
    excess/refused idempotent reuse raises HTTP 409. A new refund and audit row
    commit together; a replay returns the existing entry without another mutation.
    """
    if db.get_bind().dialect.name == "sqlite":
        # SQLite ignores FOR UPDATE. Reserve its writer before reading the refund
        # total, so concurrent native requests cannot each spend the same balance.
        db.execute(update(BillingEntry).where(BillingEntry.id == payment_id).values(id=BillingEntry.id))
    original = db.scalar(select(BillingEntry).where(BillingEntry.id == payment_id).with_for_update())
    if not original or original.kind != "payment":
        raise HTTPException(404, "Payment not found")
    existing = _find_idempotent_entry(db, payload.idempotency_key)
    if existing:
        return _refund_replay(db, existing, payment_id, payload)
    refunded = db.scalar(
        select(func.coalesce(func.sum(BillingEntry.amount_minor), 0)).where(BillingEntry.refund_of_id == payment_id)
    )
    if refunded + payload.amount_minor > original.amount_minor:
        raise HTTPException(409, "Refund exceeds the remaining paid amount")
    item = BillingEntry(
        org_id=original.org_id,
        amount_minor=payload.amount_minor,
        currency=original.currency,
        note=payload.note,
        kind="refund",
        refund_of_id=payment_id,
        idempotency_key=str(payload.idempotency_key),
        created_by=actor.id,
    )
    db.add(item)
    try:
        db.flush()
    except IntegrityError:
        # Keys are global: concurrent refunds of different payments can race too.
        db.rollback()
        existing = _find_idempotent_entry(db, payload.idempotency_key)
        if existing is None:
            raise
        return _refund_replay(db, existing, payment_id, payload)
    record_audit_event(
        db,
        scope="platform",
        action="billing.refund_recorded",
        target_type="payment",
        target_id=item.id,
        org_id=original.org_id,
        actor=actor,
        metadata={"amount_minor": item.amount_minor, "currency": item.currency, "payment_id": payment_id},
    )
    db.commit()
    return payment_out(db, item)
