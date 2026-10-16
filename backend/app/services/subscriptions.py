"""Plan limits and transaction-scoped quota admission for tenant knowledge and questions.

Limits are local manual-subscription rules, not external billing integration.
Admission counts persisted work plus in-flight questions and uses short database
locks; display helpers compute effective expiry without rewriting stored status.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.datetime import as_utc
from app.models import ConversationLog, Document, Organization, QuestionReservation, VectorChunk

settings = get_settings()


@dataclass(frozen=True)
class PlanLimits:
    """Immutable manual-plan allowances; the monthly-named question limit uses a rolling 30 days."""

    name: str
    label: str
    max_documents: int
    max_chunks: int
    max_questions_per_month: int
    max_upload_bytes: int
    advanced_analytics: bool
    manual_upgrade_label: str


PLANS: dict[str, PlanLimits] = {
    "trial": PlanLimits(
        name="trial",
        label="Free Trial",
        max_documents=25,
        max_chunks=2_000,
        max_questions_per_month=100,
        max_upload_bytes=10 * 1024 * 1024,
        advanced_analytics=True,
        manual_upgrade_label="Contact us to unlock more usage",
    ),
    "starter": PlanLimits(
        name="starter",
        label="Starter",
        max_documents=25,
        max_chunks=2_000,
        max_questions_per_month=2_000,
        max_upload_bytes=10 * 1024 * 1024,
        advanced_analytics=True,
        manual_upgrade_label="Manual subscription managed by SupportDeflect",
    ),
    "pro": PlanLimits(
        name="pro",
        label="Pro",
        max_documents=250,
        max_chunks=25_000,
        max_questions_per_month=25_000,
        max_upload_bytes=25 * 1024 * 1024,
        advanced_analytics=True,
        manual_upgrade_label="Manual subscription managed by SupportDeflect",
    ),
    "enterprise": PlanLimits(
        name="enterprise",
        label="Enterprise",
        max_documents=10_000,
        max_chunks=1_000_000,
        max_questions_per_month=1_000_000,
        max_upload_bytes=100 * 1024 * 1024,
        advanced_analytics=True,
        manual_upgrade_label="Custom manual subscription",
    ),
}


def get_plan(org: Organization) -> PlanLimits:
    """Return the organization's configured limits, using trial limits for unknown/missing plans.

    This lookup does not validate subscription activity or alter the organization.
    """
    return PLANS.get((org.subscription_plan or "trial").lower(), PLANS["trial"])


def trial_end_for_new_org() -> datetime:
    """Return an aware UTC deadline fourteen days from now for new trial admission."""
    return datetime.now(UTC) + timedelta(days=14)


def subscription_end(org: Organization) -> datetime | None:
    """Return the effective UTC trial/paid deadline, or None for an unlimited period.

    Legacy trials missing a deadline fall back to creation plus fourteen days,
    preventing accidental unlimited free usage without mutating the stored row.
    """
    if org.subscription_plan == "trial":
        # Legacy rows without a trial deadline must not become unlimited free subscriptions.
        return as_utc(org.trial_ends_at) or (as_utc(org.created_at) + timedelta(days=14) if org.created_at else None)
    return as_utc(org.subscription_ends_at)


def effective_subscription_status(org: Organization, *, at: datetime | None = None) -> str:
    """Compute archived/expired/stored status for an organization without updating it.

    Only active/trialing states expire by their effective deadline; other stored
    commercial states remain authoritative. Optional at must be an aware comparison
    time, otherwise current UTC is used.
    """
    if org.archived_at:
        return "archived"
    stored = (org.subscription_status or "active").lower()
    if stored not in {"active", "trialing"}:
        return stored
    end = subscription_end(org)
    return "expired" if end and end <= (at or datetime.now(UTC)) else stored


def ensure_subscription_active(org: Organization) -> None:
    """Raise the structured HTTP 402 quota/subscription error unless service is usable.

    Archive, expiry and inactive commercial states have actionable messages.
    This guard changes no stored status, reserves no capacity and acquires no locks.
    """
    effective = effective_subscription_status(org)
    if effective == "archived":
        raise quota_error("Organization is archived.")
    if effective == "expired":
        if org.subscription_plan == "trial":
            raise quota_error("Your free trial has ended. Please contact support to activate a subscription.")
        raise quota_error("Your subscription period has ended. Please contact support to renew.")
    if effective not in {"active", "trialing"}:
        raise quota_error("Subscription is not active. Please contact support to reactivate your workspace.")


def lock_organization_for_write(db: Session, org: Organization) -> None:
    """Serialize quota reads and their following write until the caller commits.

    PostgreSQL's non-key update lock serializes quota writers while permitting
    foreign-key readers to reference the organization. A stronger UPDATE lock
    could deadlock document retry, which already owns the document before auditing.
    SQLite ignores row locks, so a no-op update reserves its database writer.
    Call only after expensive model work; never hold this reservation during Groq.

    Refresh org in place without committing; the caller must keep the following
    capacity read/write in this transaction and release it before external work.
    """
    if db.get_bind().dialect.name == "sqlite":
        db.execute(
            update(Organization)
            .where(Organization.id == org.id)
            .values(id=Organization.id, updated_at=Organization.updated_at)
            .execution_options(synchronize_session=False)
        )
    db.refresh(org, with_for_update={"key_share": True})


def enforce_document_quota(db: Session, org: Organization, *, upload_size: int) -> None:
    """Lock tenant admission and validate active subscription, upload bytes and knowledge limits.

    Count active documents and persisted chunks; violations raise HTTP 402.
    No slot row is inserted here: the caller must create document/job and commit
    inside this same transaction, or roll back, to retain serialized admission.
    """
    # The upload and queued job commit together; serialize admission before counting documents.
    lock_organization_for_write(db, org)
    ensure_subscription_active(org)
    plan = get_plan(org)
    effective_upload_limit = min(plan.max_upload_bytes, settings.max_upload_bytes)
    if upload_size > effective_upload_limit:
        raise quota_error(
            f"Upload limit exceeded for {plan.label}. Maximum file size is {effective_upload_limit} bytes."
        )
    active_documents = (
        db.scalar(select(func.count(Document.id)).where(Document.org_id == org.id, Document.is_active.is_(True))) or 0
    )
    if active_documents >= plan.max_documents:
        raise quota_error(f"Document quota exceeded for {plan.label}. Please contact support to upgrade.")
    active_chunks = db.scalar(select(func.count(VectorChunk.id)).where(VectorChunk.org_id == org.id)) or 0
    if active_chunks >= plan.max_chunks:
        raise quota_error(f"Knowledge base quota exceeded for {plan.label}. Please contact support to upgrade.")


def enforce_question_quota(db: Session, org: Organization) -> None:
    """Check the rolling 30-day question count plus live in-flight reservations.

    An inactive subscription or exhausted limit raises HTTP 402. This read does
    not lock or reserve by itself; concurrent request admission must use
    reserve_question_quota rather than calling this check alone.
    """
    ensure_subscription_active(org)
    plan = get_plan(org)
    window_start = datetime.now(UTC) - timedelta(days=30)
    question_count = (
        db.scalar(
            select(func.count(ConversationLog.id)).where(
                ConversationLog.org_id == org.id,
                ConversationLog.created_at >= window_start,
            )
        )
        or 0
    )
    in_flight = (
        db.scalar(
            select(func.count(QuestionReservation.id)).where(
                QuestionReservation.org_id == org.id, QuestionReservation.expires_at > datetime.now(UTC)
            )
        )
        or 0
    )
    if question_count + in_flight >= plan.max_questions_per_month:
        raise quota_error(f"Monthly question quota exceeded for {plan.label}. Please contact support to upgrade.")


@contextmanager
def reserve_question_quota(db: Session, org: Organization):
    """Yield a committed ten-minute question reservation ID after serialized admission.

    Release the organization lock before slow retrieval/Groq. RAG consumes the
    reservation with its conversation commit; finally rollback any unfinished work
    and commit deletion of a remaining reservation on success/error. Crashed process
    leases expire. Callers must not leave unrelated uncommitted session work here.
    """
    # Lock only admission. Slow local retrieval/Groq generation must not hold a tenant DB lock.
    lock_organization_for_write(db, org)
    enforce_question_quota(db, org)
    db.execute(
        delete(QuestionReservation).where(
            QuestionReservation.org_id == org.id, QuestionReservation.expires_at <= datetime.now(UTC)
        )
    )
    reservation = QuestionReservation(org_id=org.id, expires_at=datetime.now(UTC) + timedelta(minutes=10))
    db.add(reservation)
    db.flush()
    reservation_id = reservation.id
    db.commit()
    try:
        yield reservation_id
    finally:
        # The successful conversation transaction consumes it; crashes expire, exceptions release it.
        db.rollback()
        db.execute(
            delete(QuestionReservation).where(
                QuestionReservation.id == reservation_id, QuestionReservation.org_id == org.id
            )
        )
        db.commit()


def quota_payload(org: Organization, db: Session) -> dict[str, int | str | bool | None]:
    """Return tenant plan, effective activity/deadlines and persisted usage for display.

    Question usage is the rolling 30-day conversation count, excluding in-flight
    reservations; displayed upload size is the smaller plan/global limit. This
    read-only payload is not an admission guarantee and does not commit.
    """
    plan = get_plan(org)
    active_documents = (
        db.scalar(select(func.count(Document.id)).where(Document.org_id == org.id, Document.is_active.is_(True))) or 0
    )
    active_chunks = db.scalar(select(func.count(VectorChunk.id)).where(VectorChunk.org_id == org.id)) or 0
    window_start = datetime.now(UTC) - timedelta(days=30)
    question_count = (
        db.scalar(
            select(func.count(ConversationLog.id)).where(
                ConversationLog.org_id == org.id,
                ConversationLog.created_at >= window_start,
            )
        )
        or 0
    )
    return {
        "plan": plan.name,
        "plan_label": plan.label,
        "status": org.subscription_status,
        "trial_ends_at": subscription_end(org).isoformat()
        if org.subscription_plan == "trial" and subscription_end(org)
        else None,
        "subscription_ends_at": org.subscription_ends_at.isoformat() if org.subscription_ends_at else None,
        "effective_status": effective_subscription_status(org),
        "is_active": effective_subscription_status(org) in {"active", "trialing"},
        "documents_used": active_documents,
        "documents_limit": plan.max_documents,
        "chunks_used": active_chunks,
        "chunks_limit": plan.max_chunks,
        "questions_used_30d": question_count,
        "questions_limit_30d": plan.max_questions_per_month,
        "max_upload_bytes": min(plan.max_upload_bytes, settings.max_upload_bytes),
        "advanced_analytics": plan.advanced_analytics,
        "manual_upgrade_label": plan.manual_upgrade_label,
    }


def quota_error(message: str) -> HTTPException:
    """Build the shared HTTP 402 detail contract with an operator-contact upgrade instruction.

    Return an exception for the caller to raise; this performs no billing action,
    payment processing, database mutation or implicit plan upgrade.
    """
    return HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail={
            "code": "quota_or_subscription_required",
            "message": message,
            "upgrade": "Contact SupportDeflect to activate or upgrade your manual subscription.",
        },
    )
