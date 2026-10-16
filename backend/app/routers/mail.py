"""Separate platform mail administration from service-token worker endpoints. Browser lists expose safe delivery
metadata; only authenticated claims can obtain decrypted invitation delivery data.
"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.admin_schemas import AutomationUpdate, MailCampaign, MailClaim, MailResult, MailSend
from app.core.config import get_settings
from app.db import get_db
from app.deps import require_super_admin
from app.models import MailAutomation, MailMessage, MailWorkerState, Organization, User
from app.services.audit import record_audit_event
from app.services.mailing import (
    AUTOMATIONS,
    claim_message,
    delivery_state,
    invitation_error,
    org_recipients,
    queue_mail,
    recover_expired_claims,
    schedule_notices,
)

router = APIRouter(prefix="/platform/mail", tags=["communication"], dependencies=[Depends(require_super_admin)])
internal_router = APIRouter(prefix="/internal/mail", include_in_schema=False)


@router.get("/status")
def mail_status(db: Session = Depends(get_db)):
    """Return platform-wide delivery counts, observed worker/SMTP state and default-enabled automation preferences;
    router-level super-admin access applies and no state is changed.
    """
    counts = dict(db.execute(select(MailMessage.status, func.count()).group_by(MailMessage.status)).all())
    settings = {setting.event: setting.enabled for setting in db.scalars(select(MailAutomation))}
    return dict(
        **delivery_state(db),
        counts=counts,
        automations=[
            dict(event=event, label=label, enabled=settings.get(event, True)) for event, label in AUTOMATIONS.items()
        ],
    )


@router.get("/messages")
def messages(
    page: int = Query(1, ge=1), status: str | None = None, org_id: str | None = None, db: Session = Depends(get_db)
):
    """Return a 25-row platform delivery log page filtered by optional status/org_id. Serialize safe metadata only,
    excluding mail bodies, ciphertext, credentials and claim receipts.
    """
    filters = []
    if status:
        filters.append(MailMessage.status == status)
    if org_id:
        filters.append(MailMessage.org_id == org_id)
    items = db.scalars(
        select(MailMessage).where(*filters).order_by(MailMessage.created_at.desc()).offset((page - 1) * 25).limit(25)
    )
    return dict(
        items=[
            dict(
                id=m.id,
                org_id=m.org_id,
                recipient=m.recipient,
                subject=m.subject,
                template=m.template,
                status=m.status,
                attempts=m.attempts,
                error_code=m.error_code,
                created_at=m.created_at,
                sent_at=m.sent_at,
            )
            for m in items
        ],
        total=db.scalar(select(func.count()).select_from(MailMessage).where(*filters)),
        page=page,
        page_size=25,
    )


def audience(db, payload):
    """Resolve exactly one organization or all nonarchived organizations into recipient tuples and a stable SHA-256
    fingerprint. Reject ambiguous target selection with 422; perform no enqueue or commit.
    """
    if payload.all_organizations == bool(payload.org_id):
        raise HTTPException(422, "Choose either one organization or all organizations")
    query = select(Organization).where(Organization.archived_at.is_(None))
    if payload.org_id:
        query = query.where(Organization.id == payload.org_id)
    recipients = [(org, email, user_id) for org in db.scalars(query) for email, user_id in org_recipients(db, org)]
    fingerprint = hashlib.sha256(
        "\n".join(sorted(f"{org.id}:{email}" for org, email, _ in recipients)).encode()
    ).hexdigest()
    return recipients, fingerprint


@router.post("/preview")
def preview(payload: MailCampaign, db: Session = Depends(get_db)):
    """Return campaign subject/body, recipient counts/sample, audience fingerprint and worker state to the super
    administrator. This reads the audience but does not queue messages.
    """
    recipients, token = audience(db, payload)
    return dict(
        recipient_count=len(recipients),
        organizations_count=len({org.id for org, _, _ in recipients}),
        audience_token=token,
        sample=[dict(organization=org.name, email=email) for org, email, _ in recipients[:10]],
        subject=payload.subject,
        message=payload.message,
        **delivery_state(db),
    )


@router.post("/send", status_code=202)
def send(payload: MailSend, db: Session = Depends(get_db), actor: User = Depends(require_super_admin)):
    """Recompute/compare the preview audience fingerprint, reject changed/empty recipients and enqueue deduplicated
    campaign mail with audit in one commit. Return queued/recipient counts; no SMTP send occurs in the API
    request.
    """
    recipients, token = audience(db, payload)
    if not secrets.compare_digest(token, payload.audience_token):
        raise HTTPException(409, "Recipients changed. Preview the audience again.")
    if not recipients:
        raise HTTPException(422, "No recipients found")
    queued = 0
    for org, email, user_id in recipients:
        message = queue_mail(
            db,
            recipient=email,
            org_id=org.id,
            user_id=user_id,
            subject=payload.subject,
            template="broadcast",
            payload={"organization": org.name, "message": payload.message},
            dedupe_key=f"campaign:{payload.idempotency_key}:{org.id}:{email}",
        )
        queued += message is not None
    if queued:
        record_audit_event(
            db,
            scope="platform",
            action="mail.campaign_queued",
            target_type="campaign",
            target_id=str(payload.idempotency_key),
            actor=actor,
            org_id=payload.org_id,
            metadata={"recipients": queued, "all_organizations": payload.all_organizations},
        )
    db.commit()
    return {"queued": queued, "recipients": len(recipients)}


@router.patch("/automations/{event}")
def automation(
    event: str, payload: AutomationUpdate, db: Session = Depends(get_db), actor: User = Depends(require_super_admin)
):
    """Validate a supported event, persist its enabled override with platform audit and return the saved state;
    unknown events raise 404 and missing rows start from service defaults.
    """
    if event not in AUTOMATIONS:
        raise HTTPException(404, "Automation not found")
    item = db.get(MailAutomation, event) or MailAutomation(event=event)
    item.enabled = payload.enabled
    db.add(item)
    record_audit_event(
        db,
        scope="platform",
        action="mail.automation_updated",
        target_type="automation",
        target_id=event,
        actor=actor,
        metadata={"enabled": payload.enabled},
    )
    db.commit()
    return {"event": event, "enabled": item.enabled}


@router.post("/messages/{message_id}/retry")
def retry(message_id: str, db: Session = Depends(get_db), actor: User = Depends(require_super_admin)):
    """Requeue a failed platform delivery after checking organization and current invitation validity; reset
    claim/attempt timing and commit audit. Invalid state raises 409; obsolete invitations must be renewed
    through the team workflow.
    """
    message = db.get(MailMessage, message_id)
    if not message or message.status != "failed":
        raise HTTPException(409, "Only failed deliveries can be retried")
    if message.org_id and db.get(Organization, message.org_id).archived_at:
        raise HTTPException(409, "Organization is archived")
    if message.template == "invitation":
        user = db.get(User, message.user_id)
        if invitation_error(message, user):
            raise HTTPException(409, "Renew this invitation from the team instead")
    message.status, message.error_code, message.attempts = "queued", None, 0
    message.claim_token, message.locked_at = None, None
    message.available_at = datetime.now(UTC)
    record_audit_event(
        db,
        scope="platform",
        action="mail.delivery_retried",
        target_type="mail",
        target_id=message.id,
        actor=actor,
        org_id=message.org_id,
    )
    db.commit()
    return {"status": "queued"}


def require_mail_worker(x_mailer_token: str | None = Header(default=None)):
    """Compare the X-Mailer-Token header with the configured independent long service secret using constant-time
    comparison; raise 401 when missing, short or mismatched.
    """
    expected = get_settings().mailer_service_token
    if not expected or len(expected) < 32 or not x_mailer_token or not secrets.compare_digest(expected, x_mailer_token):
        raise HTTPException(401, "Mailer service authentication required")


@internal_router.post("/claim", dependencies=[Depends(require_mail_worker)])
def claim(payload: MailClaim, db: Session = Depends(get_db)):
    """Record worker readiness, recover abandoned claims and schedule notices, then claim a due delivery only when
    SMTP/quota allow. Commits heartbeat/scheduling and delegates fenced claim commit; return None/paused instead
    of silently sending offline.
    """
    state = db.get(MailWorkerState, "nodemailer") or MailWorkerState(id="nodemailer")
    state.last_seen_at, state.smtp_ready, state.detail = datetime.now(UTC), payload.smtp_ready, payload.detail
    db.add(state)
    recover_expired_claims(db)
    schedule_notices(db)
    db.commit()
    if not payload.smtp_ready:
        return {"message": None}
    # Serialize quota reservations across mailer replicas; sending is already a reserved delivery.
    db.scalar(select(MailWorkerState).where(MailWorkerState.id == "nodemailer").with_for_update())
    sent_today = db.scalar(
        select(func.count())
        .select_from(MailMessage)
        .where(
            or_(
                MailMessage.sent_at >= datetime.now(UTC) - timedelta(days=1),
                MailMessage.status == "sending",
            )
        )
    )
    if sent_today >= get_settings().mail_daily_limit:
        return {"message": None, "paused": "daily_limit"}
    return {
        "message": claim_message(db, delivery_mode="local_capture" if payload.detail == "local_capture" else "smtp")
    }


@internal_router.post("/{message_id}/result", dependencies=[Depends(require_mail_worker)])
def result(message_id: str, payload: MailResult, db: Session = Depends(get_db)):
    """Lock a delivery and verify its private claim token before applying success or a safe failure. Commit secret
    scrubbing/retry state; identical receipt replays return existing status, conflicting/stale acknowledgements
    raise 409, and ambiguous sends are not auto-retried.
    """
    item = db.scalar(select(MailMessage).where(MailMessage.id == message_id).with_for_update())
    if not item or not item.claim_token or not secrets.compare_digest(item.claim_token, payload.claim_token):
        raise HTTPException(409, "Delivery claim is no longer active")
    if item.status != "sending":
        same_success = item.status == "sent" and payload.success and item.provider_message_id == payload.message_id
        same_failure = (
            item.status in {"queued", "failed"}
            and not payload.success
            and item.error_code == (payload.error_code or "delivery_failed")
        )
        if same_success or same_failure:
            return {"status": item.status}
        raise HTTPException(409, "Delivery claim is no longer active")
    # Retain the private claim receipt until the next claim so lost HTTP replies are replayable.
    if payload.success:
        item.status, item.sent_at, item.error_code = "sent", datetime.now(UTC), None
        item.provider_message_id = payload.message_id
        item.sensitive_payload = None
    else:
        item.error_code = payload.error_code or "delivery_failed"
        # SMTP can accept DATA before a connection drops: ambiguous failures require review.
        if item.attempts < 3 and item.error_code in {"authentication_failed", "connection_failed"}:
            item.status = "queued"
            item.available_at = datetime.now(UTC) + timedelta(minutes=5 * item.attempts)
        else:
            item.status = "failed"
    db.commit()
    return {"status": item.status}
