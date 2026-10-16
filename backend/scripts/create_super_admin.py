"""Explicit operator bootstrap for a platform identity; never promote an existing tenant or reset an existing
administrator. Secrets come from environment or secure prompting and are never printed.
"""

import os
import sys
from getpass import getpass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import EmailStr, TypeAdapter
from sqlalchemy import select

from app.db import SessionLocal
from app.models import User, UserRole
from app.security import get_password_hash
from app.services.audit import record_audit_event


def create_super_admin(db, email, password, name):
    """Validate email and bcrypt-safe password, then create/audit/commit a new tenantless super administrator.
    Return False for an existing valid platform identity, preserving credentials; reject tenant-email promotion
    with ValueError.
    """
    email = str(TypeAdapter(EmailStr).validate_python(email)).lower()
    if len(password) < 12 or len(password.encode("utf-8")) > 72:
        raise ValueError("Use a password of at least 12 characters and at most 72 UTF-8 bytes")
    existing = db.scalar(select(User).where(User.email == email))
    if existing:
        if existing.role != UserRole.SUPER_ADMIN or existing.org_id is not None:
            raise ValueError("Email belongs to a tenant user; automatic promotion is forbidden")
        return False
    user = User(
        email=email,
        full_name=name,
        hashed_password=get_password_hash(password),
        role=UserRole.SUPER_ADMIN,
        org_id=None,
        is_active=True,
    )
    db.add(user)
    db.flush()
    record_audit_event(
        db, scope="platform", action="super_admin.created", target_type="user", target_id=user.id, actor=user
    )
    db.commit()
    return True


def main():
    """Read bootstrap email/name and environment-or-hidden password, open a Session, invoke idempotent creation and
    print only the outcome. Validation/database failures propagate without displaying the password.
    """
    email = os.environ.get("SUPERADMIN_EMAIL") or input("Super Admin email: ")
    password = os.environ.get("SUPERADMIN_PASSWORD") or getpass("Super Admin password: ")
    name = os.environ.get("SUPERADMIN_NAME", "Platform Administrator")
    with SessionLocal() as db:
        created = create_super_admin(db, email, password, name)
    print("Super Admin created." if created else "Super Admin already exists; credentials unchanged.")


if __name__ == "__main__":
    main()
