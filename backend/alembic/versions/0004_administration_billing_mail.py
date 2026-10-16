"""Business administration, cash ledger and durable transactional email."""

import sqlalchemy as sa

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    """Add tenant commercial/archive fields, invitation/session-revocation columns and manual
    ledger/outbox/automation/heartbeat tables. Defaults preserve existing rows; no external payment or SMTP
    operation is performed.
    """
    for column in (
        sa.Column("subscription_ends_at", sa.DateTime(timezone=True)),
        sa.Column("monthly_fee_minor", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("billing_currency", sa.String(3), nullable=False, server_default="EUR"),
        sa.Column("billing_email", sa.String(255)),
        sa.Column("admin_notes", sa.Text()),
        sa.Column("archived_at", sa.DateTime(timezone=True)),
    ):
        op.add_column("organizations", column)
    for column in (
        sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("temporary_password_expires_at", sa.DateTime(timezone=True)),
    ):
        op.add_column("users", column)
    op.create_table(
        "billing_entries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("org_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("amount_minor", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("reference", sa.String(160)),
        sa.Column("note", sa.String(1000)),
        sa.Column("refund_of_id", sa.String(36), sa.ForeignKey("billing_entries.id")),
        sa.Column("idempotency_key", sa.String(64), nullable=False, unique=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.CheckConstraint("amount_minor > 0", name="ck_billing_amount_positive"),
        sa.CheckConstraint("kind IN ('payment', 'refund')", name="ck_billing_kind"),
    )
    op.create_index("ix_billing_entries_org_id", "billing_entries", ["org_id"])
    op.create_index("ix_billing_entries_refund_of_id", "billing_entries", ["refund_of_id"])
    op.create_index("ix_billing_currency_occurred", "billing_entries", ["currency", "occurred_at"])
    op.create_table(
        "mail_messages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("org_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="SET NULL")),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("recipient", sa.String(255), nullable=False),
        sa.Column("subject", sa.String(180), nullable=False),
        sa.Column("template", sa.String(64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("sensitive_payload", sa.Text()),
        sa.Column("dedupe_key", sa.String(255), unique=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("claim_token", sa.String(64)),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("error_code", sa.String(64)),
        sa.Column("provider_message_id", sa.String(255)),
    )
    op.create_index("ix_mail_messages_org_id", "mail_messages", ["org_id"])
    op.create_index("ix_mail_status_available", "mail_messages", ["status", "available_at"])
    op.create_table(
        "mail_automations",
        sa.Column("event", sa.String(64), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
    )
    op.create_table(
        "mail_worker_state",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("smtp_ready", sa.Boolean(), nullable=False),
        sa.Column("detail", sa.String(64), nullable=False),
    )


def downgrade():
    """Raise RuntimeError rather than discard billing/delivery history or invitation state; rollback requires
    restoring the matching verified backup.
    """
    raise RuntimeError("Restore a verified backup to preserve billing and delivery history")
