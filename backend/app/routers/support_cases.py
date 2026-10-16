"""Tenant staff case management with explicit tenant filters and audited mutations. Staff responses include
internal notes; visitor polling uses a separate capability-scoped minimal serializer.
"""

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.deps import get_support_org, require_support_access
from app.models import ConversationLog, Organization, SupportCase, User, UserRole
from app.schemas import (
    SupportCaseAssignRequest,
    SupportCaseNoteRequest,
    SupportCaseOut,
    SupportCaseResolveRequest,
    SupportCaseStatusRequest,
    TeamUserOut,
)
from app.services.audit import record_audit_event

router = APIRouter(prefix="/support-cases", tags=["support-cases"])


@router.get("", response_model=list[SupportCaseOut])
def list_support_cases(
    case_status: Literal["open", "in_review", "resolved", "closed"] | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    org: Organization = Depends(get_support_org),
) -> list[SupportCaseOut]:
    """Read this staff user's tenant cases with optional status filter, eager-loaded conversation/assignee and
    newest updates first; return authenticated staff schemas including private notes.
    """
    statement = (
        select(SupportCase)
        .where(SupportCase.org_id == org.id)
        .options(selectinload(SupportCase.conversation), selectinload(SupportCase.assignee))
        .order_by(desc(SupportCase.updated_at))
    )
    if case_status:
        statement = statement.where(SupportCase.status == case_status)
    return [_to_schema(case) for case in db.scalars(statement)]


@router.get("/{case_id}", response_model=SupportCaseOut)
def get_support_case(
    case_id: str,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_support_org),
) -> SupportCaseOut:
    """Load case_id only within the authorized org and return its staff schema; missing/foreign cases share the
    same HTTP 404 boundary.
    """
    return _to_schema(_get_case(db, org.id, case_id))


@router.patch("/{case_id}/assign", response_model=SupportCaseOut)
def assign_support_case(
    case_id: str,
    payload: SupportCaseAssignRequest,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_support_org),
    actor: User = Depends(require_support_access),
) -> SupportCaseOut:
    """Assign to an active accepted support user in this tenant, to actor when omitted, or unassign on explicit
    null. Commit case/audit together and promote open cases to in_review; invalid assignees raise 400.
    """
    case = _get_case(db, org.id, case_id)
    if "assigned_to_user_id" in payload.model_fields_set and payload.assigned_to_user_id is None:
        case.assigned_to_user_id = None
        record_audit_event(
            db,
            scope="tenant",
            action="support_case.unassigned",
            target_type="support_case",
            target_id=case.id,
            actor=actor,
            org_id=org.id,
        )
        db.commit()
        return _to_schema(_get_case(db, org.id, case.id))
    assignee_id = payload.assigned_to_user_id or actor.id
    assignee = db.scalar(
        select(User).where(
            User.id == assignee_id,
            User.org_id == org.id,
            User.is_active.is_(True),
            User.must_change_password.is_(False),
            User.role.in_([UserRole.TENANT_ADMIN.value, UserRole.SUPPORT_AGENT.value]),
        )
    )
    if assignee is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee is not an active support user")
    case.assigned_to_user_id = assignee.id
    if case.status == "open":
        case.status = "in_review"
    db.add(case)
    record_audit_event(
        db,
        scope="tenant",
        action="support_case.assigned",
        target_type="support_case",
        target_id=case.id,
        actor=actor,
        org_id=org.id,
        metadata={"assigned_to_user_id": assignee.id},
    )
    db.commit()
    return _to_schema(_get_case(db, org.id, case.id))


@router.patch("/{case_id}/note", response_model=SupportCaseOut)
def add_support_case_note(
    case_id: str,
    payload: SupportCaseNoteRequest,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_support_org),
    actor: User = Depends(require_support_access),
) -> SupportCaseOut:
    """Replace or clear a tenant-owned case's private note and commit an audit event without copying its content
    into metadata; return the refreshed staff view.
    """
    case = _get_case(db, org.id, case_id)
    case.internal_note = payload.internal_note or None
    db.add(case)
    record_audit_event(
        db,
        scope="tenant",
        action="support_case.note_updated",
        target_type="support_case",
        target_id=case.id,
        actor=actor,
        org_id=org.id,
    )
    db.commit()
    return _to_schema(_get_case(db, org.id, case.id))


@router.patch("/{case_id}/status", response_model=SupportCaseOut)
def update_support_case_status(
    case_id: str,
    payload: SupportCaseStatusRequest,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_support_org),
    actor: User = Depends(require_support_access),
) -> SupportCaseOut:
    """Set a tenant-owned case status and UTC resolution timestamp with audit in one commit. Reject resolved
    without a human answer; reopening clears resolved_at.
    """
    case = _get_case(db, org.id, case_id)
    if payload.status == "resolved" and not case.human_answer:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Resolve the case with a human answer")
    case.status = payload.status
    case.resolved_at = datetime.now(UTC) if payload.status in {"resolved", "closed"} else None
    db.add(case)
    record_audit_event(
        db,
        scope="tenant",
        action="support_case.status_changed",
        target_type="support_case",
        target_id=case.id,
        actor=actor,
        org_id=org.id,
        metadata={"status": payload.status},
    )
    db.commit()
    return _to_schema(_get_case(db, org.id, case.id))


@router.patch("/{case_id}/resolve", response_model=SupportCaseOut)
def resolve_support_case(
    case_id: str,
    payload: SupportCaseResolveRequest,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_support_org),
    actor: User = Depends(require_support_access),
) -> SupportCaseOut:
    """Persist the required human answer, resolved status/time and fallback actor assignment with tenant audit.
    Return the staff view; the public visitor endpoint exposes only the resolved answer/status.
    """
    case = _get_case(db, org.id, case_id)
    case.human_answer = payload.human_answer
    case.status = "resolved"
    case.resolved_at = datetime.now(UTC)
    case.assigned_to_user_id = case.assigned_to_user_id or actor.id
    db.add(case)
    record_audit_event(
        db,
        scope="tenant",
        action="support_case.resolved",
        target_type="support_case",
        target_id=case.id,
        actor=actor,
        org_id=org.id,
    )
    db.commit()
    return _to_schema(_get_case(db, org.id, case.id))


def _get_case(db: Session, org_id: str, case_id: str) -> SupportCase:
    """Query case_id with org_id and eager-load its conversation/assignee; return the ORM case or indistinguishable
    404 for absent/foreign cases, without committing.
    """
    case = db.scalar(
        select(SupportCase)
        .where(SupportCase.id == case_id, SupportCase.org_id == org_id)
        .options(selectinload(SupportCase.conversation), selectinload(SupportCase.assignee))
    )
    if case is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Support case not found")
    return case


def _to_schema(case: SupportCase) -> SupportCaseOut:
    """Combine an already tenant-authorized case with its conversation and optional safe assignee output. Includes
    private notes for staff, so never use this serializer in visitor capability responses.
    """
    conversation: ConversationLog = case.conversation
    return SupportCaseOut(
        id=case.id,
        org_id=case.org_id,
        conversation_id=case.conversation_id,
        status=case.status,
        assigned_to_user_id=case.assigned_to_user_id,
        assignee=TeamUserOut.model_validate(case.assignee) if case.assignee else None,
        human_answer=case.human_answer,
        internal_note=case.internal_note,
        reason=case.reason,
        created_at=case.created_at,
        updated_at=case.updated_at,
        resolved_at=case.resolved_at,
        visitor_id=conversation.visitor_id,
        channel=conversation.channel,
        question=conversation.question,
        ai_answer=conversation.answer,
        confidence_score=conversation.confidence_score,
        sources=conversation.sources or [],
    )
