from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_org
from app.models import Organization
from app.schemas import ChatRequest, ChatResponse
from app.services.rag import rag_service
from app.services.subscriptions import enforce_question_quota

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
def chat(
    payload: ChatRequest,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_current_org),
) -> ChatResponse:
    enforce_question_quota(db, org)
    return rag_service.answer_question(db=db, org=org, question=payload.question, channel="admin")
