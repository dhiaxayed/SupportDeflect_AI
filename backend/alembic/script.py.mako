## Alembic's Mako source template: placeholders render a new frozen revision, not live model code.
"""${message}"""
from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}

def upgrade():
    """Apply this revision's reviewed forward operations in Alembic's migration context."""
    ${upgrades if upgrades else "pass"}

def downgrade():
    """Run the reviewed reversal; replace unsafe generated drops with an explicit backup requirement."""
    ${downgrades if downgrades else "pass"}
