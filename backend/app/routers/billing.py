"""Super-administrator business dashboard and manual ledger HTTP adapters. Financial entries describe recorded
receipts/refunds, not card processing or external payment execution.
"""

import csv
import io
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.admin_schemas import Currency, PaymentCreate, RefundCreate
from app.core.datetime import as_utc
from app.db import get_db
from app.deps import require_super_admin
from app.models import BillingEntry, Organization, User
from app.services import billing as billing_service
from app.services.business import business_dashboard

router = APIRouter(prefix="/platform", tags=["business"], dependencies=[Depends(require_super_admin)])


@router.get("/business")
def dashboard(
    days: int = Query(30, ge=1, le=365),
    currency: Currency = "EUR",
    channel: Literal["all", "widget", "admin"] = "widget",
    db: Session = Depends(get_db),
):
    """Return cross-tenant business metrics for bounded days, currency and channel filters; router-level super-
    admin authorization applies and this endpoint performs no writes.
    """
    return business_dashboard(db, days=days, currency=currency, channel=channel)


@router.get("/billing/payments")
def payments(
    page: int = Query(1, ge=1),
    org_id: str | None = None,
    currency: Currency = "EUR",
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """Return a page of ledger entries and refund totals filtered by optional org_id, currency and date window; all
    access is platform-only and reads delegate to the ledger service.
    """
    return billing_service.list_payments(db, page=page, org_id=org_id, currency=currency, days=days)


@router.post("/billing/payments", status_code=201)
def record_payment(payload: PaymentCreate, db: Session = Depends(get_db), actor: User = Depends(require_super_admin)):
    """Delegate payload, db and the authorized platform actor to transactional receipt recording; return the
    new/replayed entry and propagate validation/idempotency conflicts.
    """
    return billing_service.record_payment(payload, db, actor)


@router.post("/billing/payments/{payment_id}/refund", status_code=201)
def refund(
    payment_id: str, payload: RefundCreate, db: Session = Depends(get_db), actor: User = Depends(require_super_admin)
):
    """Delegate payment_id and refund payload to the ledger service, which enforces original currency, remaining
    balance and idempotency before committing the platform actor's audit.
    """
    return billing_service.refund(payment_id, payload, db, actor)


@router.get("/billing/export")
def export(currency: Currency = "EUR", days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db)):
    """Read the platform ledger for currency/days and return UTF-8 BOM CSV with UTC dates. Text cells are protected
    against spreadsheet formulas; no ledger or subscription state changes.
    """
    result = io.StringIO()
    writer = csv.writer(result)
    writer.writerow(["id", "organization", "date_utc", "kind", "amount_minor", "currency", "reference"])
    rows = db.execute(
        select(BillingEntry, Organization.name)
        .join(Organization)
        .where(BillingEntry.currency == currency, BillingEntry.occurred_at >= datetime.now(UTC) - timedelta(days=days))
        .order_by(BillingEntry.occurred_at.desc())
    )

    def safe(value):
        """Return text with an apostrophe prefix when its first nonspace character can start a spreadsheet formula;
        convert missing values to an empty cell.
        """
        text = str(value or "")
        return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text

    for item, name in rows:
        writer.writerow(
            [
                item.id,
                safe(name),
                as_utc(item.occurred_at).isoformat(),
                item.kind,
                item.amount_minor,
                item.currency,
                safe(item.reference),
            ]
        )
    return Response(
        "\ufeff" + result.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="supportdeflect-encaissements.csv"'},
    )
