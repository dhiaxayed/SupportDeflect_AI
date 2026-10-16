"""Explicit roles, support workflow and audited administration."""

import sqlalchemy as sa

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    """Translate the legacy admin role, permit platform users without a tenant, enforce role/org pairing and create
    support/audit history tables and indexes under Alembic transaction ownership.
    """
    op.execute("UPDATE users SET role = 'tenant_admin' WHERE role = 'admin'")
    with op.batch_alter_table("users") as batch:
        batch.alter_column("org_id", existing_type=sa.String(36), nullable=True)
        batch.create_check_constraint(
            "ck_users_role_org",
            "(role = 'super_admin' AND org_id IS NULL) OR "
            "(role IN ('tenant_admin', 'support_agent') AND org_id IS NOT NULL)",
        )
    op.create_table(
        "support_cases",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("org_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "conversation_id", sa.String(36), sa.ForeignKey("conversation_logs.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("assigned_to_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("human_answer", sa.Text()),
        sa.Column("internal_note", sa.Text()),
        sa.Column("reason", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("conversation_id", name="uq_support_cases_conversation"),
        sa.CheckConstraint("status IN ('open', 'in_review', 'resolved', 'closed')", name="ck_support_cases_status"),
    )
    op.create_index("ix_support_cases_org_id", "support_cases", ["org_id"])
    op.create_index("ix_support_cases_org_status", "support_cases", ["org_id", "status"])
    op.create_index("ix_support_cases_assignee", "support_cases", ["assigned_to_user_id"])
    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("org_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="SET NULL")),
        sa.Column("actor_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("scope", sa.String(32), nullable=False),
        sa.Column("action", sa.String(80), nullable=False),
        sa.Column("target_type", sa.String(80), nullable=False),
        sa.Column("target_id", sa.String(64)),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_audit_events_org_id", "audit_events", ["org_id"])
    op.create_index("ix_audit_events_actor_user_id", "audit_events", ["actor_user_id"])
    op.create_index("ix_audit_events_scope_created", "audit_events", ["scope", "created_at"])
    op.create_index("ix_audit_events_org_created", "audit_events", ["org_id", "created_at"])


def downgrade():
    # Downgrading would orphan platform identities and destroy support history.
    """Refuse automatic reversal with RuntimeError because platform identities and support history cannot be safely
    represented by the earlier schema; restore a verified pre-migration backup instead.
    """
    raise RuntimeError("Restore a pre-migration backup to roll back revision 0002")
