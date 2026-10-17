"""Explicit conversation outcomes and an index for off-request throttle cleanup."""

import sqlalchemy as sa

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    """Preserve legacy outcomes as unknown and index expired events for bounded maintenance."""
    op.add_column("conversation_logs", sa.Column("outcome", sa.String(32), nullable=True))
    op.create_index("ix_rate_limit_created", "rate_limit_events", ["created_at"])


def downgrade():
    """Remove the maintenance index and recorded outcome classification."""
    op.drop_index("ix_rate_limit_created", table_name="rate_limit_events")
    op.drop_column("conversation_logs", "outcome")
