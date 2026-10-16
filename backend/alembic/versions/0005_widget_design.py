"""Persist the complete widget design without changing existing branding."""

import sqlalchemy as sa

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    """Add nonnull JSON widget_design with an empty-object server default so existing tenant branding remains
    intact and schema defaults can populate the versioned design.
    """
    op.add_column("organizations", sa.Column("widget_design", sa.JSON(), nullable=False, server_default="{}"))


def downgrade():
    """Refuse destructive removal of saved widget designs with RuntimeError; restore a verified backup to return to
    the earlier schema.
    """
    raise RuntimeError("Restore a verified backup to preserve saved widget designs")
