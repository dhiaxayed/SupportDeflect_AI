"""Super-administrator cross-tenant operations, grouped metrics, safe audit views and ingestion recovery. Route
adapters delegate commercial/lifecycle transactions to organization services.
"""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, desc, func, select, text
from sqlalchemy.orm import Session

from app.admin_schemas import ArchiveRequest, OrganizationCreate, OrganizationEdit, PeriodAdjustment
from app.core.source_urls import redact_source_urls
from app.db import get_db
from app.deps import require_super_admin
from app.models import AuditEvent, ConversationLog, Document, IngestionJob, Organization, SupportCase, User, VectorChunk
from app.schemas import (
    AuditEventOut,
    PlatformHealthOut,
    PlatformOrganizationDetail,
    PlatformOrganizationList,
    PlatformOrganizationSummary,
    PlatformOverviewOut,
)
from app.services import organizations as organization_service
from app.services.analytics import visitor_questions
from app.services.audit import record_audit_event
from app.services.ingestion import lock_document_for_write
from app.services.llm import check_llm_health
from app.services.organizations import get_org
from app.services.subscriptions import ensure_subscription_active

router = APIRouter(prefix="/platform", tags=["platform"], dependencies=[Depends(require_super_admin)])


def count(db, model, *filters) -> int:
    """Return an integer SQL count for model and caller-supplied filters through db, normalizing an empty aggregate
    to zero without altering data.
    """
    return db.scalar(select(func.count()).select_from(model).where(*filters)) or 0


def recent():
    """Build the rolling thirty-day ConversationLog timestamp SQL predicate in UTC; return an expression for
    callers to combine with tenant/channel filters.
    """
    return ConversationLog.created_at >= datetime.now(UTC) - timedelta(days=30)


@router.get("/overview", response_model=PlatformOverviewOut)
def overview(db: Session = Depends(get_db)):
    """Return platform-wide organization/user/knowledge/question/case/job counters; router-level authorization is
    super-admin and the endpoint does not mutate state.
    """
    return dict(
        organizations_total=count(db, Organization),
        organizations_active=count(db, Organization, Organization.subscription_status == "active"),
        organizations_trialing=count(db, Organization, Organization.subscription_status == "trialing"),
        organizations_suspended=count(db, Organization, Organization.subscription_status == "suspended"),
        users_total=count(db, User),
        documents_total=count(db, Document, Document.is_active.is_(True)),
        vector_chunks_total=count(db, VectorChunk),
        questions_30d=count(db, ConversationLog, recent(), visitor_questions()),
        open_support_cases=count(db, SupportCase, SupportCase.status.in_(["open", "in_review"])),
        pending_ingestion_jobs=count(db, IngestionJob, IngestionJob.status == "pending"),
        processing_ingestion_jobs=count(db, IngestionJob, IngestionJob.status == "processing"),
        failed_ingestion_jobs=count(db, IngestionJob, IngestionJob.status == "failed"),
    )


def org_summary(db, org, counts=None):
    """Serialize one organization with commercial fields and usage counts. Reuse page-grouped counts when supplied,
    otherwise query this org's metrics through db; return no private credentials.
    """
    return dict(
        id=org.id,
        public_id=org.public_id,
        name=org.name,
        created_at=org.created_at,
        subscription_plan=org.subscription_plan,
        subscription_status=org.subscription_status,
        trial_ends_at=org.trial_ends_at,
        subscription_ends_at=org.subscription_ends_at,
        monthly_fee_minor=org.monthly_fee_minor,
        billing_currency=org.billing_currency,
        billing_email=org.billing_email,
        archived_at=org.archived_at,
        **(
            counts
            if counts is not None
            else dict(
                users_count=count(db, User, User.org_id == org.id),
                documents_count=count(db, Document, Document.org_id == org.id, Document.is_active.is_(True)),
                chunks_count=count(db, VectorChunk, VectorChunk.org_id == org.id),
                questions_30d=count(
                    db, ConversationLog, ConversationLog.org_id == org.id, recent(), visitor_questions()
                ),
                support_cases_count=count(db, SupportCase, SupportCase.org_id == org.id),
            )
        ),
    )


@router.get("/organizations", response_model=PlatformOrganizationList)
def organizations(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query("", max_length=160),
    status: str | None = None,
    plan: str | None = None,
    archived: bool = False,
    due: str | None = None,
    db: Session = Depends(get_db),
):
    """Read a filtered/paged tenant list by archival, search, plan/status and due window. Compute usage with page-
    scoped grouped queries rather than per-row counts, then return items and matching pagination totals.
    """
    filters = [Organization.archived_at.is_not(None) if archived else Organization.archived_at.is_(None)]
    if search:
        filters.append(Organization.name.ilike(f"%{search}%"))
    if status:
        filters.append(Organization.subscription_status == status)
    if plan:
        filters.append(Organization.subscription_plan == plan)
    end = case(
        (Organization.subscription_plan == "trial", Organization.trial_ends_at), else_=Organization.subscription_ends_at
    )
    if due == "expired":
        filters.append(end <= datetime.now(UTC))
    elif due == "7d":
        filters.extend([end > datetime.now(UTC), end <= datetime.now(UTC) + timedelta(days=7)])
    rows = list(
        db.scalars(
            select(Organization)
            .where(*filters)
            .order_by(desc(Organization.created_at))
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    # One aggregate per metric, rather than five extra queries per organization.
    counts = {org.id: {} for org in rows}
    for key, model, conditions in (
        ("users_count", User, ()),
        ("documents_count", Document, (Document.is_active.is_(True),)),
        ("chunks_count", VectorChunk, ()),
        ("questions_30d", ConversationLog, (recent(), visitor_questions())),
        ("support_cases_count", SupportCase, ()),
    ):
        totals = (
            dict(
                db.execute(
                    select(model.org_id, func.count())
                    .where(model.org_id.in_(counts), *conditions)
                    .group_by(model.org_id)
                ).all()
            )
            if counts
            else {}
        )
        for org_id in counts:
            counts[org_id][key] = totals.get(org_id, 0)
    return dict(
        items=[org_summary(db, org, counts[org.id]) for org in rows],
        total=count(db, Organization, *filters),
        page=page,
        page_size=page_size,
    )


@router.post("/organizations/{org_id}/administrators/{user_id}/invite")
def renew_administrator_invitation(
    org_id: str, user_id: str, db: Session = Depends(get_db), actor: User = Depends(require_super_admin)
):
    """Delegate an org/user-scoped invitation renewal to the organization service for the authorized platform
    actor; service guards live sends and commits credential/outbox/audit changes.
    """
    return organization_service.renew_administrator_invitation(org_id, user_id, db, actor)


@router.post("/organizations", response_model=PlatformOrganizationSummary, status_code=201)
def create_organization(
    payload: OrganizationCreate, db: Session = Depends(get_db), actor: User = Depends(require_super_admin)
):
    """Delegate platform tenant/administrator creation and transactional invitation to the service, then return its
    usage summary; duplicate identity and business validation errors propagate.
    """
    return org_summary(db, organization_service.create_organization(payload, db, actor))


@router.get("/organizations/{org_id}", response_model=PlatformOrganizationDetail)
def organization_detail(org_id: str, db: Session = Depends(get_db)):
    """Read an existing tenant or raise 404 and return its expanded platform summary, administrator identities,
    notes and ingestion counts; this data is not exposed to public/tenant routes.
    """
    org = get_org(db, org_id)
    return dict(
        **org_summary(db, org),
        widget_brand_name=org.widget_brand_name,
        admin_notes=org.admin_notes,
        administrators=list(db.scalars(select(User).where(User.org_id == org.id, User.role == "tenant_admin"))),
        allowed_domains_count=len(org.allowed_domains or []),
        **{
            f"{state}_ingestion_jobs": count(
                db, IngestionJob, IngestionJob.org_id == org.id, IngestionJob.status == state
            )
            for state in ("pending", "processing", "failed")
        },
    )


@router.patch("/organizations/{org_id}", response_model=PlatformOrganizationSummary)
def update_organization(
    org_id: str,
    payload: OrganizationEdit,
    db: Session = Depends(get_db),
    actor: User = Depends(require_super_admin),
):
    """Apply the platform actor's optional commercial/lifecycle payload through the organization service and return
    the refreshed summary; transaction/audit ownership stays in that service.
    """
    return org_summary(db, organization_service.update_organization(org_id, payload, db, actor))


@router.post("/organizations/{org_id}/period", response_model=PlatformOrganizationSummary)
def adjust_period(
    org_id: str, payload: PeriodAdjustment, db: Session = Depends(get_db), actor: User = Depends(require_super_admin)
):
    """Delegate a bounded signed trial/subscription extension and reason to the organization service, which commits
    the deadline/audit/mail transaction; return the resulting tenant summary.
    """
    return org_summary(db, organization_service.adjust_period(org_id, payload, db, actor))


@router.delete("/organizations/{org_id}", response_model=PlatformOrganizationSummary)
def archive_organization(
    org_id: str, payload: ArchiveRequest, db: Session = Depends(get_db), actor: User = Depends(require_super_admin)
):
    """Delegate explicit name-confirmed reversible archival for the platform actor and return a summary; service
    preserves history and denies invalid confirmation/state.
    """
    return org_summary(db, organization_service.archive_organization(org_id, payload, db, actor))


@router.post("/organizations/{org_id}/restore", response_model=PlatformOrganizationSummary)
def restore_organization(org_id: str, db: Session = Depends(get_db), actor: User = Depends(require_super_admin)):
    """Delegate reversal of tenant archival to the organization service with actor audit; return the restored
    summary without deleting or recreating historical data.
    """
    return org_summary(db, organization_service.restore_organization(org_id, db, actor))


@router.get("/audit-events", response_model=list[AuditEventOut])
def audit_events(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    org_id: str | None = None,
    action: str = Query("", max_length=80),
    db: Session = Depends(get_db),
):
    """Read a filtered platform audit page and attach actor emails with one grouped lookup. Missing/deleted actors
    remain nullable; model output excludes raw credentials and private content.
    """
    filters = []
    if org_id:
        filters.append(AuditEvent.org_id == org_id)
    if action:
        filters.append(AuditEvent.action.ilike(f"%{action}%"))
    rows = list(
        db.scalars(
            select(AuditEvent)
            .where(*filters)
            .order_by(desc(AuditEvent.created_at))
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    actors = {
        user.id: user.email
        for user in db.scalars(select(User).where(User.id.in_({e.actor_user_id for e in rows if e.actor_user_id})))
    }
    return [
        AuditEventOut.model_validate(event).model_copy(update={"actor_email": actors.get(event.actor_user_id)})
        for event in rows
    ]


@router.get("/ingestion/failed")
def failed_ingestion(db: Session = Depends(get_db)):
    """Return up to fifty recent failed jobs with tenant/document labels for active knowledge/nonarchived tenants;
    omit raw text, URL payloads and unsanitized exception values.
    """
    rows = db.execute(
        select(IngestionJob, Organization.name, Document.title)
        .join(Organization, Organization.id == IngestionJob.org_id)
        .join(Document, Document.id == IngestionJob.document_id)
        .where(IngestionJob.status == "failed", Organization.archived_at.is_(None), Document.is_active.is_(True))
        .order_by(IngestionJob.updated_at.desc())
        .limit(50)
    )
    return [
        dict(
            id=job.id, organization_name=name, document_title=redact_source_urls(title),
            attempts=job.attempts, created_at=job.created_at,
        )
        for job, name, title in rows
    ]


@router.post("/ingestion/{job_id}/retry")
def retry_ingestion(job_id: str, db: Session = Depends(get_db), actor: User = Depends(require_super_admin)):
    """Lock document before its job, recheck failed/active/subscription state and commit a cleared pending lease
    plus audit. Reject missing/nonfailed/inactive states with 409; consistent lock ordering avoids lifecycle
    deadlocks.
    """
    job = db.get(IngestionJob, job_id)
    if not job:
        raise HTTPException(409, "Only failed jobs can be retried")
    # All job/document writes lock the document first. Taking the job lock first
    # here could deadlock deletion or completion, each waiting for the other row.
    document = lock_document_for_write(db, document_id=job.document_id, org_id=job.org_id)
    db.refresh(job, with_for_update=True)
    if not job or job.status != "failed":
        raise HTTPException(409, "Only failed jobs can be retried")
    org = get_org(db, job.org_id)
    ensure_subscription_active(org)
    if not document or not document.is_active:
        raise HTTPException(409, "Document is no longer active")
    job.status, job.attempts, job.error_message = "pending", 0, None
    job.locked_at, job.locked_by, job.completed_at = None, None, None
    document.status, document.error_message = "pending", None
    record_audit_event(
        db,
        scope="platform",
        action="ingestion.retried",
        target_type="ingestion_job",
        target_id=job.id,
        org_id=org.id,
        actor=actor,
    )
    db.commit()
    return {"status": "pending"}


@router.get("/health", response_model=PlatformHealthOut)
def health(db: Session = Depends(get_db)):
    """Probe database/pgvector, ingestion counts and configured LLM health; return sanitized per-dependency/overall
    categories. Roll back failed database probes and report SQLite as degraded rather than claiming native
    pgvector.
    """
    checks = {}
    try:
        db.execute(text("SELECT 1"))
        checks["database"] = {"status": "healthy", "detail": db.bind.dialect.name}
        if db.bind.dialect.name == "postgresql":
            vector = db.scalar(text("SELECT extversion FROM pg_extension WHERE extname = 'vector'"))
            checks["pgvector"] = {"status": "healthy" if vector else "unhealthy", "detail": vector or "Missing"}
        else:
            checks["pgvector"] = {"status": "degraded", "detail": "SQLite JSON fallback"}
        pending = count(db, IngestionJob, IngestionJob.status.in_(["pending", "processing"]))
        failed = count(db, IngestionJob, IngestionJob.status == "failed")
        checks["ingestion"] = {
            "status": "degraded" if failed else "healthy",
            "detail": f"{pending} pending/processing; {failed} failed",
        }
    except Exception:
        db.rollback()
        checks["database"] = {"status": "unhealthy", "detail": "Database check failed"}
    state, detail = check_llm_health()
    checks["llm"] = {"status": state, "detail": detail}
    overall = (
        "unhealthy"
        if any(c["status"] == "unhealthy" for c in checks.values())
        else "degraded"
        if any(c["status"] == "degraded" for c in checks.values())
        else "healthy"
    )
    return {"status": overall, "checks": checks}
