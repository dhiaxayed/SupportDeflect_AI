"""Stage business audit records in the same transaction as the action being described.

Callers choose platform/tenant scope and safe metadata, then commit or roll back
the audit row together with their mutation; this module performs no delivery.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditEvent, User


def record_audit_event(
    db: Session,
    *,
    scope: str,
    action: str,
    target_type: str,
    target_id: str | None = None,
    actor: User | None = None,
    org_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditEvent:
    """Stage and return an audit row for the supplied action, actor and optional tenant.

    The caller must supply already-authorized scope and nonsensitive metadata.
    This only adds to db: it neither flushes nor commits, so a failed business
    transaction cannot leave a committed audit entry claiming the action succeeded.
    """
    event = AuditEvent(
        org_id=org_id,
        actor_user_id=actor.id if actor else None,
        scope=scope,
        action=action,
        target_type=target_type,
        target_id=target_id,
        event_metadata=metadata or {},
    )
    db.add(event)
    return event
