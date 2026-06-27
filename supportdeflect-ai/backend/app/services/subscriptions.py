from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import ConversationLog, Document, Organization, VectorChunk

settings = get_settings()


@dataclass(frozen=True)
class PlanLimits:
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
    return PLANS.get((org.subscription_plan or "trial").lower(), PLANS["trial"])


def trial_end_for_new_org() -> datetime:
    return datetime.now(UTC) + timedelta(days=14)


def ensure_subscription_active(org: Organization) -> None:
    status_value = (org.subscription_status or "active").lower()
    if status_value not in {"active", "trialing"}:
        raise quota_error("Subscription is not active. Please contact support to reactivate your workspace.")
    if (org.subscription_plan or "trial").lower() == "trial" and org.trial_ends_at:
        now = datetime.now(UTC)
        trial_ends_at = org.trial_ends_at
        if trial_ends_at.tzinfo is None:
            trial_ends_at = trial_ends_at.replace(tzinfo=UTC)
        if trial_ends_at < now:
            raise quota_error("Your free trial has ended. Please contact support to activate a subscription.")


def enforce_document_quota(db: Session, org: Organization, *, upload_size: int) -> None:
    ensure_subscription_active(org)
    plan = get_plan(org)
    effective_upload_limit = min(plan.max_upload_bytes, settings.max_upload_bytes)
    if upload_size > effective_upload_limit:
        raise quota_error(
            f"Upload limit exceeded for {plan.label}. Maximum file size is {effective_upload_limit} bytes."
        )
    active_documents = db.scalar(
        select(func.count(Document.id)).where(Document.org_id == org.id, Document.is_active.is_(True))
    ) or 0
    if active_documents >= plan.max_documents:
        raise quota_error(f"Document quota exceeded for {plan.label}. Please contact support to upgrade.")
    active_chunks = db.scalar(select(func.count(VectorChunk.id)).where(VectorChunk.org_id == org.id)) or 0
    if active_chunks >= plan.max_chunks:
        raise quota_error(f"Knowledge base quota exceeded for {plan.label}. Please contact support to upgrade.")


def enforce_question_quota(db: Session, org: Organization) -> None:
    ensure_subscription_active(org)
    plan = get_plan(org)
    window_start = datetime.now(UTC) - timedelta(days=30)
    question_count = db.scalar(
        select(func.count(ConversationLog.id)).where(
            ConversationLog.org_id == org.id,
            ConversationLog.created_at >= window_start,
        )
    ) or 0
    if question_count >= plan.max_questions_per_month:
        raise quota_error(f"Monthly question quota exceeded for {plan.label}. Please contact support to upgrade.")


def quota_payload(org: Organization, db: Session) -> dict[str, int | str | bool | None]:
    plan = get_plan(org)
    active_documents = db.scalar(
        select(func.count(Document.id)).where(Document.org_id == org.id, Document.is_active.is_(True))
    ) or 0
    active_chunks = db.scalar(select(func.count(VectorChunk.id)).where(VectorChunk.org_id == org.id)) or 0
    window_start = datetime.now(UTC) - timedelta(days=30)
    question_count = db.scalar(
        select(func.count(ConversationLog.id)).where(
            ConversationLog.org_id == org.id,
            ConversationLog.created_at >= window_start,
        )
    ) or 0
    return {
        "plan": plan.name,
        "plan_label": plan.label,
        "status": org.subscription_status,
        "trial_ends_at": org.trial_ends_at.isoformat() if org.trial_ends_at else None,
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
    return HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail={
            "code": "quota_or_subscription_required",
            "message": message,
            "upgrade": "Contact SupportDeflect to activate or upgrade your manual subscription.",
        },
    )
