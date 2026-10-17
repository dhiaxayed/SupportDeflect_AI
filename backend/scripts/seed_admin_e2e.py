"""Synthetic browser-test data, restricted to a separate disposable SQLite database."""

import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alembic import command
from alembic.config import Config
from app.core.config import get_settings
from app.db import SessionLocal
from app.models import BillingEntry, ConversationLog, Document, Organization, User
from app.security import get_password_hash
from scripts.create_super_admin import create_super_admin


def main():
    """Require test mode, an empty dedicated admin_e2e SQLite database and fixture password, then migrate/seed
    synthetic platform/tenant, activity and ledger data. Commit fixture writes without modifying normal user
    databases; reject unsafe selection with SystemExit.
    """
    settings = get_settings()
    if (
        settings.environment != "test"
        or not settings.database_url.startswith("sqlite:")
        or "admin_e2e" not in settings.database_url
    ):
        raise SystemExit("Use ENVIRONMENT=test and a separate admin_e2e SQLite database")
    password = os.environ["E2E_ADMIN_PASSWORD"]
    command.upgrade(Config("alembic.ini"), "head")
    now = datetime.now(UTC)
    with SessionLocal() as db:
        if db.query(Organization).count():
            raise SystemExit("Fixture database must be empty")
        create_super_admin(db, "operator@example.com", password, "E2E Operator")
        names = ["Atlas Commerce", "Northstar Cloud", "Helio Studio", "Meridian Labs", "Nova Services", "Forma Digital"]
        for index, name in enumerate(names):
            plan = ["pro", "enterprise", "starter", "trial", "pro", "starter"][index]
            org = Organization(
                public_id=f"company_e2e_{index}",
                name=name,
                widget_brand_name=name,
                widget_greeting="Welcome",
                subscription_plan=plan,
                subscription_status="trialing" if plan == "trial" else "active",
                trial_ends_at=now + timedelta(days=2) if plan == "trial" else None,
                subscription_ends_at=now + timedelta(days=5) if index == 5 else None,
                monthly_fee_minor=[14900, 89000, 4900, 0, 14900, 4900][index],
                billing_currency="EUR",
                allowed_domains=["customer.example"],
                created_at=now - timedelta(days=100 - index * 15),
            )
            user = User(
                organization=org,
                email=f"owner{index}@example.com",
                full_name="Account Owner",
                hashed_password=get_password_hash(password),
                role="tenant_admin",
            )
            db.add_all([org, user])
            db.flush()
            if index != 3:
                db.add(
                    Document(
                        org_id=org.id,
                        title="Customer guide",
                        source_type="file",
                        source="guide.md",
                        status="indexed",
                        chunk_count=10,
                    )
                )
            for day in range(60):
                for j in range((day * 3 + index * 7) % 12 + 2):
                    resolved = (j + day) % 4 != 0
                    db.add(
                        ConversationLog(
                            org_id=org.id,
                            channel="widget",
                            visitor_id="e2e-visitor",
                            question="Synthetic E2E question",
                            answer="Synthetic E2E answer",
                            resolved=resolved,
                            outcome="answered" if resolved else "escalated",
                            needs_human=not resolved,
                            confidence_score=0.84 if resolved else 0.2,
                            created_at=now - timedelta(days=day, minutes=j),
                        )
                    )
                if day % 6 == index and plan != "trial":
                    db.add(
                        BillingEntry(
                            org_id=org.id,
                            kind="payment",
                            amount_minor=org.monthly_fee_minor,
                            currency="EUR",
                            reference="E2E fixture",
                            idempotency_key=f"e2e-{index}-{day}",
                            occurred_at=now - timedelta(days=day),
                        )
                    )
        db.commit()
    print("Synthetic administration fixtures created in isolated test database")


if __name__ == "__main__":
    main()
