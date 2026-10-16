"""Reserve in-flight question usage without holding a database lock across Groq calls."""

import sqlalchemy as sa

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    """Create tenant-linked expiring in-flight question slots and the org/expiry index. Admission services can
    commit these slots before slow generation instead of holding a quota lock throughout it.
    """
    op.create_table(
        "question_reservations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("org_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_question_reservations_org_expires", "question_reservations", ["org_id", "expires_at"])


def downgrade():
    """Drop the question_reservations table and its index through Alembic, discarding transient in-flight slots;
    coordinate rollback with stopped callers that expect this schema.
    """
    op.drop_table("question_reservations")
