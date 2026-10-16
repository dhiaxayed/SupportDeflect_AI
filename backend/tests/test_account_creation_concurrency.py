"""Concurrent API account creation must produce a conflict without partial tenants/outboxes."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import Document, MailMessage, Organization, User
from app.security import create_access_token, get_password_hash


@pytest.mark.parametrize("operation", ["register", "team", "platform"])
def test_concurrent_duplicate_email_is_a_conflict(client, auth_headers, monkeypatch, operation):
    """Force two account-create prechecks to race and require one HTTP 201, one existing-contract 409, and no partial
    organization/outbox.
    """
    email = f"duplicate-{operation}@example.com"
    ready = Barrier(2)
    original = Session.scalar

    def simultaneous_precheck(db, statement, *args, **kwargs):
        """Return the real SQL lookup result, pausing only absent email checks so both requests reach the same unique-
        key race.
        """
        result = original(db, statement, *args, **kwargs)
        if result is None and email in statement.compile().params.values():
            ready.wait(timeout=10)
        return result

    headers = auth_headers
    if operation == "register":
        path = "/api/v1/auth/register"
        payload = {"organization_name": "Collision organization", "admin_email": email, "password": "secure-password"}
        expected_detail = "A user with this email already exists"
    elif operation == "team":
        path = "/api/v1/team/users"
        payload = {"email": email, "role": "support_agent"}
        expected_detail = "A user with this email already exists"
    else:
        with SessionLocal() as db:
            actor = User(
                email="platform-collision-fixture@example.com", role="super_admin",
                hashed_password=get_password_hash("platform-fixture-password"),
            )
            db.add(actor)
            db.commit()
            headers = {"Authorization": f"Bearer {create_access_token(actor.id)}"}
        path = "/api/v1/platform/organizations"
        payload = {"name": "Collision organization", "admin_email": email, "admin_name": "Fixture administrator"}
        expected_detail = "This email already belongs to an account"
    monkeypatch.setattr(Session, "scalar", simultaneous_precheck)

    def submit(_):
        """Execute one competing fixture request; return only status/detail or exception type so failed SQL cannot
        disclose fixture credentials.
        """
        try:
            response = client.post(path, json=payload, headers=headers)
            return response.status_code, response.json().get("detail")
        except Exception as error:
            # Report only the exception type; failed SQL parameters can contain fixture credentials.
            return type(error).__name__, None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, range(2)))
    assert {status for status, _ in results} == {201, 409}
    assert [detail for status, detail in results if status == 409] == [expected_detail]
    with SessionLocal() as db:
        assert db.scalar(select(func.count(User.id)).where(User.email == email)) == 1
        assert db.scalar(select(func.count(MailMessage.id)).where(MailMessage.recipient == email)) == 1
        if operation != "team":
            count = db.scalar(select(func.count(Organization.id)).where(Organization.name == "Collision organization"))
            assert count == 1


def test_account_conflict_recovery_does_not_mask_an_unrelated_constraint(client, auth_headers):
    """Keep foreign-key failures visible after rollback even when an existing email could otherwise make them look
    like a duplicate-account conflict.
    """
    from app.services.accounts import raise_account_creation_conflict

    with SessionLocal() as db:
        email = db.scalar(select(User.email))
        db.add(Document(org_id="missing-organization", title="Guide", source="guide.txt", source_type="file"))
        with pytest.raises(IntegrityError) as observed:
            try:
                db.flush()
            except IntegrityError as error:
                original = error
                raise_account_creation_conflict(db, email=email, error=error, detail="Duplicate email")
        assert observed.value is original
        assert db.scalar(select(func.count(Document.id))) == 0
