"""Authenticated tenant-administrator playground adapter; share the production RAG pipeline while reserving rolling
question quota before generation.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_tenant_admin_org
from app.models import Organization
from app.schemas import ChatRequest, ChatResponse
from app.services.rag import rag_service
from app.services.subscriptions import reserve_question_quota

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
def chat(
    payload: ChatRequest,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_tenant_admin_org),
) -> ChatResponse:
    """Answer payload.question/history for the authenticated org through RAG on the admin channel. The reservation
    context accounts for in-flight usage without holding a lock across inference and releases it on
    completion/failure.
    """
    with reserve_question_quota(db, org) as reservation_id:
        return rag_service.answer_question(
            db=db,
            org=org,
            question=payload.question,
            channel="admin",
            history=payload.history,
            quota_reservation_id=reservation_id,
        )
