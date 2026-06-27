from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import get_db
from app.models import Organization
from app.schemas import ChatResponse, WidgetChatRequest, WidgetPublicSettings
from app.services.domain import is_domain_allowed
from app.services.rag import rag_service
from app.services.rate_limiter import rate_limiter
from app.services.subscriptions import enforce_question_quota

router = APIRouter(prefix="/widget", tags=["widget"])
settings = get_settings()


@router.get("/script.js", include_in_schema=True)
def script_js() -> Response:
    script_path = Path(__file__).resolve().parents[1] / "static" / "widget.js"
    content = script_path.read_text(encoding="utf-8")
    return Response(
        content=content,
        media_type="application/javascript; charset=utf-8",
        headers={"Cache-Control": "public, max-age=300"},
    )


@router.get("/settings/{company_id}", response_model=WidgetPublicSettings)
def widget_settings(
    company_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> WidgetPublicSettings:
    org = get_org_by_public_id(company_id, db)
    if not is_domain_allowed(org, request):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This domain is not allowed for the widget")
    return WidgetPublicSettings(
        company_id=org.public_id,
        brand_name=org.widget_brand_name,
        primary_color=org.widget_primary_color,
        greeting_message=org.widget_greeting,
        support_email=org.support_email,
        strict_mode=org.strict_mode,
    )


@router.post("/chat", response_model=ChatResponse)
def widget_chat(
    payload: WidgetChatRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ChatResponse:
    org = get_org_by_public_id(payload.company_id, db)
    if not is_domain_allowed(org, request):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This domain is not allowed for the widget")
    ip = request.client.host if request.client else "unknown"
    org_ip_key = f"widget:{org.public_id}:ip:{ip}"
    visitor_key = f"widget:{org.public_id}:visitor:{payload.visitor_id}:{ip}"
    if not rate_limiter.allow(org_ip_key, limit=settings.widget_rate_limit_per_minute * 3, window_seconds=60):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")
    if not rate_limiter.allow(visitor_key, limit=settings.widget_rate_limit_per_minute, window_seconds=60):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")
    enforce_question_quota(db, org)
    return rag_service.answer_question(
        db=db,
        org=org,
        question=payload.question,
        channel="widget",
        visitor_id=payload.visitor_id,
    )


def get_org_by_public_id(company_id: str, db: Session) -> Organization:
    org = db.scalar(select(Organization).where(Organization.public_id == company_id))
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    return org
