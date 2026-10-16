"""Invitation expiry and credential rotation shared by authentication and administration.

User credentials and encrypted invitation mail are prepared together; the calling
route/service owns commit, audit recording and authorization of the target member.
"""

import secrets
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.datetime import as_utc
from app.models import Organization, User
from app.security import get_password_hash
from app.services.mailing import ensure_invitation_not_sending, invite_user


def invitation_expired(user: User) -> bool:
    """Return whether a mandatory-password-change account lacks a future invitation deadline.

    Missing deadlines fail closed; accepted accounts are not invitation-expired.
    UTC normalization keeps SQLite and PostgreSQL comparisons consistent.
    """
    return user.must_change_password and (
        not user.temporary_password_expires_at or as_utc(user.temporary_password_expires_at) <= datetime.now(UTC)
    )


def require_valid_invitation(user: User) -> None:
    """Reject an expired invitation with the structured HTTP 403 invitation_expired error.

    Authentication uses this guard for login and already-issued JWTs so holding
    a token cannot bypass the temporary credential deadline. No user state changes.
    """
    if invitation_expired(user):
        raise HTTPException(
            403,
            detail={
                "code": "invitation_expired",
                "message": "Invitation expired. Ask your administrator for a new invitation.",
            },
        )


def issue_invitation(db: Session, user: User, org: Organization, password: str | None = None) -> None:
    """Prepare credentials and encrypted outbox mail in the caller's transaction.

    Accept an authorized user/org and optional initial password; otherwise create
    a random credential, set a seven-day deadline and require password replacement.
    Renewal revokes older JWT versions and guards in-flight mail before rotation.
    Flush identity/credential changes and stage encrypted mail without committing;
    callers own user locking, audit and rollback on validation/database failures.
    """
    if user.id:
        ensure_invitation_not_sending(db, user.id)
    password = password or secrets.token_urlsafe(18)
    if user.hashed_password:
        # Renewals revoke previously issued sessions as well as the old password.
        user.token_version += 1
    user.hashed_password = get_password_hash(password)
    user.must_change_password = True
    user.temporary_password_expires_at = datetime.now(UTC) + timedelta(days=7)
    db.add(user)
    db.flush()
    invite_user(db, user, org, password)
