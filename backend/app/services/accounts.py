"""Recover account email races while preserving caller-owned organization/outbox transactions.

Route-specific conflict messages are preserved after the entire attempted
account/organization transaction is rolled back; unrelated constraints remain errors.
"""

from typing import NoReturn

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import User


def raise_account_creation_conflict(db: Session, *, email: str, error: IntegrityError, detail: str) -> NoReturn:
    """Roll back an attempted create and translate only the known unique email violation.

    The friendly precheck cannot serialize concurrent requests. Database uniqueness
    remains authoritative; unrelated foreign-key/check/public-ID violations must
    retain their original error rather than masquerading as an email conflict.

    email is the normalized attempted address and detail is the existing route
    conflict message. Always raise HTTP 409 after finding its committed duplicate,
    or re-raise the original IntegrityError; this helper never commits.
    """
    db.rollback()
    original = error.orig
    constraint = getattr(getattr(original, "diag", None), "constraint_name", None)
    duplicate_email = constraint == "uq_users_email" or (
        getattr(original, "sqlite_errorname", None) == "SQLITE_CONSTRAINT_UNIQUE"
        and str(original) == "UNIQUE constraint failed: users.email"
    )
    if duplicate_email and db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(409, detail) from None
    raise error
