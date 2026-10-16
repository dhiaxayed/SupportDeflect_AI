"""Tenant team reads and administrator-only invitation/account mutations. Safe metadata is separated from encrypted
outbox credentials; identity changes revoke or renew access explicitly.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_support_org, get_tenant_admin_org, require_tenant_admin
from app.models import MailMessage, Organization, User
from app.schemas import InvitationDeliveryOut, TeamUserCreate, TeamUserOut, TeamUserUpdate
from app.services.accounts import raise_account_creation_conflict
from app.services.audit import record_audit_event
from app.services.invitations import issue_invitation
from app.services.mailing import cancel_pending_invitations, delivery_state

router = APIRouter(prefix="/team", tags=["team"])


@router.get("/users", response_model=list[TeamUserOut])
def list_team_users(
    db: Session = Depends(get_db),
    org: Organization = Depends(get_support_org),
) -> list[TeamUserOut]:
    """Return users of the staff member's own organization and their latest invitation delivery metadata using a
    window-ranked lookup; never expose ciphertext, passwords or claim capabilities.
    """
    users = list(db.scalars(select(User).where(User.org_id == org.id).order_by(User.created_at, User.email)))
    # Return only the latest delivery per member, never encrypted credentials or claim capabilities.
    ranked = (
        select(
            MailMessage.id,
            func.row_number()
            .over(partition_by=MailMessage.user_id, order_by=(MailMessage.created_at.desc(), MailMessage.id.desc()))
            .label("position"),
        )
        .where(MailMessage.org_id == org.id, MailMessage.template == "invitation")
        .subquery()
    )
    latest = {
        message.user_id: message
        for message in db.scalars(
            select(MailMessage).join(ranked, ranked.c.id == MailMessage.id).where(ranked.c.position == 1)
        )
    }
    return [team_response(user, latest.get(user.id)) for user in users]


@router.get("/mail-status")
def team_mail_status(db: Session = Depends(get_db), org: Organization = Depends(get_tenant_admin_org)):
    """Return observed worker readiness for a tenant administrator authorized by org; transport diagnostics are
    shared, but no platform delivery log/body is exposed.
    """
    return delivery_state(db)


def team_response(user: User, message: MailMessage | None = None) -> TeamUserOut:
    """Build a safe TeamUserOut from user and optional latest invitation; copy only supported delivery modes from
    payload and leave private outbox fields unrepresented.
    """
    result = TeamUserOut.model_validate(user)
    if message:
        result.invitation_delivery = InvitationDeliveryOut.model_validate(message)
        mode = message.payload.get("delivery_mode")
        if mode in {"local_capture", "smtp"}:
            result.invitation_delivery.mode = mode
    return result


@router.post("/users", response_model=TeamUserOut, status_code=status.HTTP_201_CREATED)
def create_team_user(
    payload: TeamUserCreate,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_tenant_admin_org),
    actor: User = Depends(require_tenant_admin),
) -> User:
    """Create a tenant-only identity from payload, issue a mandatory-reset invitation and commit user/outbox/audit
    atomically. Concurrent/global duplicate email yields 409 after rollback; return the refreshed safe user.
    """
    email = payload.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists")
    user = User(
        org_id=org.id,
        email=email,
        full_name=payload.full_name,
        role=payload.role,
        is_active=True,
    )
    try:
        issue_invitation(db, user, org, payload.password)
    except IntegrityError as error:
        raise_account_creation_conflict(
            db, email=email, error=error, detail="A user with this email already exists"
        )
    record_audit_event(
        db,
        scope="tenant",
        action="team.user_created",
        target_type="user",
        target_id=user.id,
        actor=actor,
        org_id=org.id,
        metadata={"role": user.role},
    )
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/invite", response_model=TeamUserOut)
def resend_invitation(
    user_id: str,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_tenant_admin_org),
    actor: User = Depends(require_tenant_admin),
):
    """Lock this tenant's member, reject self/inactive/accepted accounts and renew pending invitation credentials
    with audit. Commit and return the member; the invitation service guards in-flight SMTP claims.
    """
    user = _get_tenant_user(db, org.id, user_id)
    if user.id == actor.id or not user.is_active or not user.must_change_password:
        raise HTTPException(400, "Only active, unaccepted invitations can be renewed")
    issue_invitation(db, user, org)
    record_audit_event(
        db,
        scope="tenant",
        action="team.invitation_renewed",
        target_type="user",
        target_id=user.id,
        actor=actor,
        org_id=org.id,
    )
    db.commit()
    return user


@router.patch("/users/{user_id}", response_model=TeamUserOut)
def update_team_user(
    user_id: str,
    payload: TeamUserUpdate,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_tenant_admin_org),
    actor: User = Depends(require_tenant_admin),
) -> User:
    """Apply explicit profile/role/activity fields on a locked tenant member while preventing self-removal. Revoke
    sessions or renew pending credentials as needed, cancel inactive invitations and commit safe audit metadata.
    """
    user = _get_tenant_user(db, org.id, user_id)
    if user.id == actor.id and ((payload.role is not None and payload.role != user.role) or payload.is_active is False):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot remove your own administrator access"
        )

    changes: dict[str, object] = {}
    renew = False
    if "full_name" in payload.model_fields_set:
        changes["full_name"] = payload.full_name
        user.full_name = payload.full_name
    if payload.role is not None and payload.role != user.role:
        changes["role"] = {"from": user.role, "to": payload.role}
        user.role = payload.role
        if user.must_change_password:
            renew = True
        else:
            user.token_version += 1
    if payload.is_active is not None and payload.is_active != user.is_active:
        changes["is_active"] = {"from": user.is_active, "to": payload.is_active}
        user.is_active = payload.is_active
        user.token_version += 1
        if user.must_change_password:
            if user.is_active:
                renew = True
            else:
                user.temporary_password_expires_at = datetime.now(UTC)
        if not user.is_active:
            cancel_pending_invitations(db, user.id, "invitation_inactive")

    if renew and user.is_active:
        issue_invitation(db, user, org)

    db.add(user)
    if changes:
        record_audit_event(
            db,
            scope="tenant",
            action="team.user_updated",
            target_type="user",
            target_id=user.id,
            actor=actor,
            org_id=org.id,
            metadata=changes,
        )
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/deactivate", response_model=TeamUserOut)
def deactivate_team_user(
    user_id: str,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_tenant_admin_org),
    actor: User = Depends(require_tenant_admin),
) -> User:
    """Reject self-deactivation, lock a tenant member and commit inactivity, token revocation, pending invitation
    expiry/cancellation and audit. Return safe identity metadata; historical records remain.
    """
    if user_id == actor.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot deactivate your own account")
    user = _get_tenant_user(db, org.id, user_id)
    user.is_active = False
    user.token_version += 1
    if user.must_change_password:
        user.temporary_password_expires_at = datetime.now(UTC)
    cancel_pending_invitations(db, user.id, "invitation_inactive")
    db.add(user)
    record_audit_event(
        db,
        scope="tenant",
        action="team.user_deactivated",
        target_type="user",
        target_id=user.id,
        actor=actor,
        org_id=org.id,
        metadata={"role": user.role},
    )
    db.commit()
    db.refresh(user)
    return user


def _get_tenant_user(db: Session, org_id: str, user_id: str) -> User:
    """Select user_id within org_id, requesting a PostgreSQL row lock for the caller's mutation.

    Return the ORM user or 404 for missing/foreign identities. SQLite ignores FOR UPDATE;
    the caller owns validation and commit/rollback rather than this lookup committing early.
    """
    user = db.scalar(select(User).where(User.id == user_id, User.org_id == org_id).with_for_update())
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team member not found")
    return user
