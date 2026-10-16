"""Organization lifecycle operations, including their audit and mail transaction.

Platform routes authorize the operator before entering these services. Lifecycle
changes preserve tenant history and commit their audit/outbox effects together;
shared invitation preparation deliberately does not commit independently.
"""

import secrets
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.admin_schemas import ArchiveRequest, OrganizationCreate, OrganizationEdit, PeriodAdjustment
from app.core.datetime import as_utc
from app.models import MailMessage, Organization, User
from app.services.accounts import raise_account_creation_conflict
from app.services.audit import record_audit_event
from app.services.invitations import issue_invitation
from app.services.mailing import notify_org
from app.services.subscriptions import trial_end_for_new_org


def generate_company_public_id(db: Session) -> str:
    """Return a random unused public widget identifier checked against the supplied session.

    This is discoverable tenant routing data, not an authentication secret. The
    helper only reads; the database unique constraint still governs insert races.
    """
    while True:
        token = secrets.token_urlsafe(9).replace("-", "").replace("_", "")[:12]
        public_id = f"company_{token}"
        if not db.scalar(select(Organization).where(Organization.public_id == public_id)):
            return public_id


def get_org(db: Session, org_id: str) -> Organization:
    """Load an organization by internal ID or raise HTTP 404 without committing.

    This helper does not authorize tenant access or reject archived organizations;
    its platform callers must enforce the appropriate lifecycle/role boundary.
    """
    org = db.get(Organization, org_id)
    if org is None:
        raise HTTPException(404, "Organization not found")
    return org


def renew_administrator_invitation(org_id: str, user_id: str, db: Session, actor: User) -> dict[str, str]:
    """Rotate an active unaccepted tenant-administrator invitation and return queued status.

    Lock the target user, reject wrong/archived ownership with HTTP 404 and
    accepted/inactive invitations with HTTP 409. Commit credentials, encrypted mail
    and operator audit together; actor platform authorization belongs to the route.
    """
    org = get_org(db, org_id)
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if org.archived_at or not user or user.org_id != org.id or user.role != "tenant_admin":
        raise HTTPException(404, "Administrator not found")
    if not user.is_active or not user.must_change_password:
        raise HTTPException(409, "Only unaccepted active invitations can be renewed")
    issue_invitation(db, user, org)
    record_audit_event(
        db,
        scope="platform",
        action="organization.invitation_renewed",
        target_type="user",
        target_id=user.id,
        org_id=org.id,
        actor=actor,
    )
    db.commit()
    return {"status": "queued"}


def create_organization(payload: OrganizationCreate, db: Session, actor: User) -> Organization:
    """Create a tenant and its administrator invitation in one audited transaction.

    Validated plan/billing inputs establish trial or active defaults; duplicate
    email raises HTTP 409, including concurrent unique-constraint winners after
    rollback. Commit organization, user, encrypted invitation and audit together,
    returning the organization without exposing the generated password.
    """
    email = payload.admin_email.lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(409, "This email already belongs to an account")
    org = Organization(
        public_id=generate_company_public_id(db),
        name=payload.name.strip(),
        widget_brand_name=payload.name.strip()[:120],
        widget_greeting="Bonjour ! Comment pouvons-nous vous aider ?",
        allowed_domains=[],
        subscription_plan=payload.subscription_plan,
        subscription_status="trialing" if payload.subscription_plan == "trial" else "active",
        trial_ends_at=trial_end_for_new_org() if payload.subscription_plan == "trial" else None,
        billing_currency=payload.billing_currency,
        billing_email=payload.billing_email,
        monthly_fee_minor=0 if payload.subscription_plan == "trial" else payload.monthly_fee_minor,
    )
    user = User(
        organization=org,
        email=email,
        full_name=payload.admin_name,
        role="tenant_admin",
    )
    db.add_all([org, user])
    try:
        issue_invitation(db, user, org)
    except IntegrityError as error:
        raise_account_creation_conflict(db, email=email, error=error, detail="This email already belongs to an account")
    record_audit_event(
        db,
        scope="platform",
        action="organization.created",
        target_type="organization",
        target_id=org.id,
        actor=actor,
        org_id=org.id,
    )
    db.commit()
    return org


def update_organization(org_id: str, payload: OrganizationEdit, db: Session, actor: User) -> Organization:
    """Apply validated platform edits and return the refreshed tenant after commit.

    Archived tenants raise HTTP 409 and forbidden nulls raise HTTP 422. Normalize
    trial/nontrial dates and fees, audit actual changes without copying private
    notes, and queue subscription mail only for relevant edits in the same commit.
    """
    org = get_org(db, org_id)
    changes = {}
    if org.archived_at:
        raise HTTPException(409, "Restore the organization before editing")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is None and field not in {"billing_email", "admin_notes", "trial_ends_at", "subscription_ends_at"}:
            raise HTTPException(422, f"{field} cannot be null")
        old = getattr(org, field)
        if old != value:
            changes[field] = {
                "from": old.isoformat() if isinstance(old, datetime) else old,
                "to": value.isoformat() if isinstance(value, datetime) else value,
            }
            if field == "admin_notes":
                changes[field] = {"updated": True}
            setattr(org, field, value)
    if org.subscription_plan != "trial":
        org.trial_ends_at = None
    elif org.trial_ends_at is None:
        org.trial_ends_at = trial_end_for_new_org()
    if org.subscription_plan == "trial":
        org.monthly_fee_minor = 0
    if changes:
        if any(key.startswith("subscription_") or key in {"trial_ends_at", "monthly_fee_minor"} for key in changes):
            notify_org(
                db,
                org,
                "subscription_updated",
                "Votre abonnement a ete mis a jour",
                f"L'abonnement de {org.name} a ete mis a jour : {org.subscription_plan}, "
                f"statut {org.subscription_status}. Retrouvez les details dans votre espace.",
            )
        record_audit_event(
            db,
            scope="platform",
            action="organization.updated",
            target_type="organization",
            target_id=org.id,
            actor=actor,
            org_id=org.id,
            metadata=changes,
        )
    db.commit()
    db.refresh(org)
    return org


def adjust_period(org_id: str, payload: PeriodAdjustment, db: Session, actor: User) -> Organization:
    """Adjust the selected subscription deadline and commit its audit/notice together.

    Use the trial deadline for trials and paid deadline otherwise. Positive days
    start from the later of now/current end; negative days subtract from an existing
    end. Missing/archived tenants, zero days and reducing unlimited periods raise
    HTTP 404/422/400 respectively. Locking serializes PostgreSQL period updates.
    """
    org = db.scalar(select(Organization).where(Organization.id == org_id).with_for_update())
    if not org or org.archived_at:
        raise HTTPException(404, "Active organization not found")
    if payload.days == 0:
        raise HTTPException(422, "Choose a nonzero period adjustment")
    field = "trial_ends_at" if org.subscription_plan == "trial" else "subscription_ends_at"
    old = as_utc(getattr(org, field))
    now = datetime.now(UTC)
    base = max(old or now, now) if payload.days > 0 else old
    if base is None:
        raise HTTPException(400, "Set an end date before reducing an unlimited period")
    new = base + timedelta(days=payload.days)
    setattr(org, field, new)
    record_audit_event(
        db,
        scope="platform",
        action="subscription.period_adjusted",
        target_type="organization",
        target_id=org.id,
        actor=actor,
        org_id=org.id,
        metadata={
            "days": payload.days,
            "reason": payload.reason,
            "from": old.isoformat() if old else None,
            "to": new.isoformat(),
        },
    )
    notify_org(
        db,
        org,
        "subscription_updated",
        "Votre periode d'abonnement a ete ajustee",
        f"La nouvelle date de fin de votre periode est le {new:%d/%m/%Y}.",
    )
    db.commit()
    return org


def archive_organization(org_id: str, payload: ArchiveRequest, db: Session, actor: User) -> Organization:
    """Soft-archive the confirmed tenant while retaining its business and support history.

    A mismatched typed name raises HTTP 400. First archive cancels queued/failed
    mail and scrubs its secrets, then commits with an audit row; in-flight mail is
    not recalled. Repeating the operation commits without another archive event.
    """
    org = get_org(db, org_id)
    if payload.confirm_name != org.name:
        raise HTTPException(400, "Type the organization name to confirm archiving")
    if org.archived_at is None:
        org.archived_at = datetime.now(UTC)
        db.execute(
            update(MailMessage)
            .where(MailMessage.org_id == org.id, MailMessage.status.in_(["queued", "failed"]))
            .values(status="canceled", sensitive_payload=None)
        )
        record_audit_event(
            db,
            scope="platform",
            action="organization.archived",
            target_type="organization",
            target_id=org.id,
            actor=actor,
            org_id=org.id,
        )
    db.commit()
    return org


def restore_organization(org_id: str, db: Session, actor: User) -> Organization:
    """Clear an existing archive flag and commit a restoration audit when needed.

    Missing IDs raise HTTP 404; repeated restoration is idempotent. This does not
    renew an expired subscription or recreate previously canceled mail.
    """
    org = get_org(db, org_id)
    if org.archived_at:
        org.archived_at = None
        record_audit_event(
            db,
            scope="platform",
            action="organization.restored",
            target_type="organization",
            target_id=org.id,
            actor=actor,
            org_id=org.id,
        )
    db.commit()
    return org
