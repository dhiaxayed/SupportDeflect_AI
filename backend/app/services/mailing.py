"""Transactional mail outbox preparation, scheduling and delivery-claim state.

Administrative callers stage mail with their business writes; claim_message commits
a worker lease and releases decrypted credentials only to the authenticated mailer.
SMTP transport and acknowledgement handling live outside this service.
"""

import base64
import hashlib
import json
import secrets
from datetime import UTC, datetime, timedelta

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from sqlalchemy import or_, select, update

from app.core.config import get_settings
from app.core.datetime import as_utc
from app.models import MailAutomation, MailMessage, MailWorkerState, Organization, User, UserRole


def delivery_state(db):
    """Return sanitized mailer connectivity, SMTP readiness and sender metadata.

    A heartbeat older than two minutes is offline regardless of its previous
    SMTP flag. This read does not test SMTP directly or expose queued message bodies.
    """
    worker = db.get(MailWorkerState, "nodemailer")
    connected = bool(worker and as_utc(worker.last_seen_at) > datetime.now(UTC) - timedelta(minutes=2))
    return dict(
        connected=connected,
        smtp_ready=bool(connected and worker.smtp_ready),
        detail=worker.detail if connected else "worker_offline",
        from_address=get_settings().mail_from,
        last_seen_at=worker.last_seen_at if worker else None,
    )


def cancel_pending_invitations(db, user_id, reason="invitation_superseded"):
    """Cancel queued/failed invitations for one member and scrub credentials/claim tokens.

    Keep in-flight SMTP deliveries unchanged; renewal must separately guard them.
    The update stays in the caller's transaction and does not commit.
    """
    db.execute(
        update(MailMessage)
        .where(
            MailMessage.user_id == user_id,
            MailMessage.template == "invitation",
            MailMessage.status.in_(["queued", "failed"]),
        )
        .values(status="canceled", sensitive_payload=None, claim_token=None, error_code=reason)
    )


def recover_expired_claims(db, *, user_id=None):
    """Mark missing/expired five-minute sending leases as delivery_unknown failures.

    An optional user_id restricts recovery to that member's invitations. Lost
    acknowledgement may follow accepted SMTP DATA, so this never automatically
    resends. Claim receipts are cleared; the caller owns commit/rollback.
    """
    filters = [
        MailMessage.status == "sending",
        or_(MailMessage.locked_at.is_(None), MailMessage.locked_at <= datetime.now(UTC) - timedelta(minutes=5)),
    ]
    if user_id:
        filters.extend([MailMessage.user_id == user_id, MailMessage.template == "invitation"])
    # No automatic resend after a lost acknowledgement: SMTP might already have accepted DATA.
    db.execute(
        update(MailMessage).where(*filters).values(status="failed", error_code="delivery_unknown", claim_token=None)
    )


def ensure_invitation_not_sending(db, user_id):
    """Recover old invitation leases, then raise HTTP 409 if one is still sending.

    Credential rotation must call this before replacing a pending password so mail
    in flight does not become unusable. Updates remain caller-owned; PostgreSQL
    callers also lock the user before this mail-state check.
    """
    recover_expired_claims(db, user_id=user_id)
    if db.scalar(
        select(MailMessage.id).where(
            MailMessage.user_id == user_id, MailMessage.template == "invitation", MailMessage.status == "sending"
        )
    ):
        raise HTTPException(409, "Invitation is being sent. Wait for delivery to finish before renewing it.")


def invitation_error(message, user):
    """Return a stable rejection code, or None, for a message's current invitation binding.

    Check account/tenant activity, expiry, role, recipient, credential version and
    remaining ciphertext without decrypting. Call under the appropriate user lock
    before claiming; this function itself performs no writes or commit.
    """
    now = datetime.now(UTC)
    if (
        not user
        or not user.organization
        or message.org_id != user.org_id
        or not user.is_active
        or not user.must_change_password
        or user.organization.archived_at
    ):
        return "invitation_inactive"
    if not user.temporary_password_expires_at or as_utc(user.temporary_password_expires_at) <= now:
        return "invitation_expired"
    try:
        expires = as_utc(datetime.fromisoformat(message.payload["expires_at"]))
    except (KeyError, TypeError, ValueError):
        return "invitation_superseded"
    if (
        expires != as_utc(user.temporary_password_expires_at)
        or message.recipient != user.email
        or message.payload.get("role") != user.role
    ):
        return "invitation_superseded"
    if "credential_version" in message.payload and message.payload["credential_version"] != user.token_version:
        return "invitation_superseded"
    if not message.sensitive_payload:
        return "invitation_credentials_unavailable"
    return None


AUTOMATIONS = {
    "welcome": "Bienvenue a une nouvelle organisation",
    "subscription_updated": "Modification de l'abonnement",
    "subscription_expiring": "Echeance dans 3 jours",
    "subscription_expired": "Periode d'abonnement terminee",
    "payment_received": "Encaissement enregistre",
    "password_changed": "Confirmation du changement de mot de passe",
}


def cipher():
    """Derive the invitation-at-rest Fernet cipher from the application secret.

    A purpose-prefixed SHA-256 derivation separates this key use from JWT signing.
    Changing the secret makes existing ciphertext unreadable; plaintext credentials
    must never be copied into the ordinary outbox payload or logs.
    """
    # Invitations are encrypted at rest, then scrubbed after delivery or expiration.
    secret = get_settings().secret_key.encode()
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(b"mail-invitations:" + secret).digest()))


def queue_mail(
    db, *, recipient, subject, template, payload, org_id=None, user_id=None, dedupe_key=None, sensitive=None
):
    """Stage an outbox row and return it, or None when its deduplication key already exists.

    Hash optional dedupe keys and encrypt the separate sensitive payload; ordinary
    payload must already be safe to inspect. This helper neither flushes nor commits,
    so business changes and mail can share one transaction. Database uniqueness
    remains authoritative for concurrent dedupe-key inserts.
    """
    if dedupe_key:
        dedupe_key = hashlib.sha256(dedupe_key.encode()).hexdigest()
    if dedupe_key and db.scalar(select(MailMessage.id).where(MailMessage.dedupe_key == dedupe_key)):
        return None
    message = MailMessage(
        org_id=org_id,
        user_id=user_id,
        recipient=recipient,
        subject=subject,
        template=template,
        payload=payload,
        dedupe_key=dedupe_key,
        sensitive_payload=cipher().encrypt(json.dumps(sensitive).encode()).decode() if sensitive else None,
    )
    db.add(message)
    return message


def org_recipients(db, org):
    """Return billing-contact tuples, falling back to active tenant administrators.

    An explicit billing_email replaces the administrator audience and has no user ID.
    This lookup does not require invitation acceptance or commit any state.
    """
    if org.billing_email:
        return [(org.billing_email, None)]
    users = db.scalars(
        select(User).where(User.org_id == org.id, User.role == UserRole.TENANT_ADMIN, User.is_active.is_(True))
    )
    return [(user.email, user.id) for user in users]


def notify_org(db, org, event, subject, message, *, dedupe_prefix=None):
    """Stage one enabled automation message per selected organization recipient.

    An explicit disabled setting suppresses the event; optional dedupe prefixes
    prevent repeated notice preparation. No SMTP occurs and the caller commits
    these outbox rows with the corresponding business operation.
    """
    setting = db.get(MailAutomation, event)
    if setting and not setting.enabled:
        return
    for email, user_id in org_recipients(db, org):
        queue_mail(
            db,
            recipient=email,
            subject=subject,
            template=event,
            payload={"organization": org.name, "message": message},
            org_id=org.id,
            user_id=user_id,
            dedupe_key=f"{dedupe_prefix}:{email}" if dedupe_prefix else None,
        )


def invite_user(db, user, org, password):
    """Replace unsent invitation mail with a credential-version-bound encrypted invitation.

    The caller must already set/hash the temporary password and deadline and
    exclude active sending claims. Only the sensitive payload receives plaintext;
    old queued/failed secrets are scrubbed in this same uncommitted transaction.
    """
    cancel_pending_invitations(db, user.id)
    queue_mail(
        db,
        recipient=user.email,
        org_id=org.id,
        user_id=user.id,
        subject=f"Votre acces a {org.name}"[:180],
        template="invitation",
        payload={
            "organization": org.name,
            "name": user.full_name or user.email,
            "role": user.role,
            "expires_at": as_utc(user.temporary_password_expires_at).isoformat(),
            "credential_version": user.token_version,
        },
        sensitive={"initial_password": password},
    )


def schedule_notices(db):
    """Stage deduplicated expiry notices and scrub invalid queued/failed invitations.

    Inspect nonarchived active/trialing tenants whose period is due within three
    days or expired; automation settings select recipients. This is outbox/database
    maintenance only, with commit and scheduling cadence owned by the mail route.
    """
    now = datetime.now(UTC)
    orgs = db.scalars(
        select(Organization).where(
            Organization.archived_at.is_(None),
            Organization.subscription_status.in_(["active", "trialing"]),
            or_(Organization.trial_ends_at.is_not(None), Organization.subscription_ends_at.is_not(None)),
        )
    )
    for org in orgs:
        end = as_utc(org.trial_ends_at if org.subscription_plan == "trial" else org.subscription_ends_at)
        if not end or end > now + timedelta(days=3):
            continue
        event = "subscription_expired" if end <= now else "subscription_expiring"
        subject = "Votre periode est terminee" if end <= now else "Votre abonnement arrive a echeance"
        notify_org(
            db,
            org,
            event,
            subject,
            f"La periode {org.subscription_plan} de {org.name} se termine le {end:%d/%m/%Y}. "
            "Contactez SupportDeflect AI pour faire le point sur votre abonnement.",
            dedupe_prefix=f"{event}:{org.id}:{end.isoformat()}",
        )
    invalid_users = (
        select(User.id)
        .join(Organization)
        .where(
            or_(
                User.is_active.is_(False),
                User.must_change_password.is_(False),
                User.temporary_password_expires_at.is_(None),
                User.temporary_password_expires_at <= now,
                Organization.archived_at.is_not(None),
            )
        )
    )
    db.execute(
        update(MailMessage)
        .where(
            MailMessage.template == "invitation",
            MailMessage.status.in_(["queued", "failed"]),
            or_(MailMessage.user_id.is_(None), MailMessage.user_id.in_(invalid_users)),
        )
        .values(status="canceled", sensitive_payload=None, error_code="invitation_expired")
    )


def claim_message(db, *, delivery_mode="unknown"):
    """Commit one due mail lease and return its private worker delivery contract, or None.

    Invitation claims lock the user before rereading mail and validate its current
    generation before decryption. Conditional queued-to-sending update arbitrates
    contention; invalid/corrupt credentials are canceled/failed and scrubbed. A
    successful reply includes plaintext invitation credentials and a claim token
    solely for the authenticated mailer; caller must enforce its service token/quota.
    This helper commits/rolls back its lease transaction but performs no SMTP.
    """
    now = datetime.now(UTC)
    candidate = db.scalar(
        select(MailMessage)
        .where(MailMessage.status == "queued", MailMessage.available_at <= now)
        .order_by(MailMessage.created_at)
        .limit(1)
    )
    if not candidate:
        db.commit()
        return None
    if candidate.template == "invitation":
        # Invitation changes and claims lock User first, avoiding user/mail lock-order inversion.
        user = db.scalar(
            select(User).where(User.id == candidate.user_id).with_for_update().execution_options(populate_existing=True)
        )
        db.refresh(candidate)
        if candidate.status != "queued":
            db.commit()
            return None
        reason = invitation_error(candidate, user)
        if reason:
            candidate.status, candidate.sensitive_payload = "canceled", None
            candidate.error_code = reason
            db.commit()
            return None
    token = secrets.token_urlsafe(24)
    claimed = db.execute(
        update(MailMessage)
        .where(MailMessage.id == candidate.id, MailMessage.status == "queued")
        .values(status="sending", claim_token=token, locked_at=now, attempts=MailMessage.attempts + 1)
    )
    if claimed.rowcount != 1:
        db.rollback()
        return None
    candidate.payload = {**candidate.payload, "delivery_mode": delivery_mode}
    payload = dict(candidate.payload)
    if candidate.sensitive_payload:
        try:
            sensitive = json.loads(cipher().decrypt(candidate.sensitive_payload.encode()))
            if not isinstance(sensitive, dict) or not sensitive.get("initial_password"):
                raise ValueError("Missing invitation credentials")
            payload.update(sensitive)
        except (InvalidToken, ValueError, TypeError):
            candidate.status, candidate.sensitive_payload, candidate.claim_token = "failed", None, None
            candidate.error_code = "invitation_credentials_unavailable"
            db.commit()
            return None
    result = dict(
        id=candidate.id,
        recipient=candidate.recipient,
        subject=candidate.subject,
        template=candidate.template,
        payload=payload,
        claim_token=token,
        login_url=get_settings().frontend_url.rstrip("/") + "/login",
    )
    db.commit()
    return result
