"""Public widget renderer, branding/settings, bounded chat and visitor case polling. Public company IDs identify
tenants; Origin policy, quotas and signed case capabilities provide separate access boundaries.
"""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import get_db
from app.models import Organization, SupportCase
from app.schemas import ChatResponse, VisitorCaseRequest, WidgetChatPathRequest, WidgetChatRequest, WidgetPublicSettings
from app.services.domain import is_domain_allowed
from app.services.rag import rag_service
from app.services.rate_limiter import rate_limiter
from app.services.subscriptions import reserve_question_quota
from app.services.visitor_access import verify_case_access
from app.services.widget_assets import asset_path

router = APIRouter(prefix="/widget", tags=["widget"])
settings = get_settings()


@router.get("/script.js", include_in_schema=True)
def script_js() -> Response:
    """Read and return the shared vanilla renderer as cacheable JavaScript; no tenant session or alternate preview
    implementation is required.
    """
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
    """Look up an unarchived public company, enforce request Origin policy and return only public branding/design.
    Unknown companies raise 404 and disallowed origins raise 403.
    """
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
        design=org.widget_design or {},
    )


@router.get("/assets/{filename}", include_in_schema=False)
def widget_asset(filename: str) -> FileResponse:
    """Resolve a validated generated asset filename and serve immutable PNG bytes, or raise 404 if absent. Asset
    names contain no caller-controlled filesystem traversal.
    """
    path = asset_path(filename)
    if not path.is_file():
        raise HTTPException(404, "Image not found")
    return FileResponse(
        path,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/brand.png", include_in_schema=False)
def widget_brand() -> FileResponse:
    """Serve the local default widget icon as PNG; this public static asset contains no tenant or account data."""
    return FileResponse(Path(__file__).resolve().parents[1] / "static" / "official-icon.png", media_type="image/png")


@router.get("/preview", response_class=HTMLResponse, include_in_schema=False)
def widget_preview() -> str:
    # The frame loads exactly the embed renderer, not a second React approximation.
    """Return the small iframe document loading the exact production renderer in preview mode; saved/draft data is
    exchanged by the renderer's correlated message bridge.
    """
    return (
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>Widget preview</title></head><body style="margin:0;background:#f8faff">'
        '<script src="./script.js" data-preview="true"></script></body></html>'
    )


@router.post("/{company_id}/chat", response_model=ChatResponse)
def widget_chat_by_company(
    company_id: str,
    payload: WidgetChatPathRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ChatResponse:
    """Combine URL company_id with the bounded chat body and delegate to the shared widget handler; tenant identity
    does not depend on hidden cross-origin request-body inspection.
    """
    return widget_chat(WidgetChatRequest(company_id=company_id, **payload.model_dump()), request, db)


@router.post("/chat", response_model=ChatResponse, deprecated=True)
def widget_chat(
    payload: WidgetChatRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ChatResponse:
    """Validate company consistency/origin, enforce tenant-IP and visitor-IP throttles, reserve question quota and
    call RAG on the widget channel. Return its answer/capability result; reject mismatch/access/rate failures
    with 403/429.
    """
    query_company = request.query_params.get("company_id")
    if query_company and query_company != payload.company_id:
        raise HTTPException(403, "Company ID mismatch")
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
    with reserve_question_quota(db, org) as reservation_id:
        return rag_service.answer_question(
            db=db,
            org=org,
            question=payload.question,
            channel="widget",
            visitor_id=payload.visitor_id,
            history=payload.history,
            quota_reservation_id=reservation_id,
        )


@router.post("/{company_id}/cases/{case_id}")
def visitor_case(
    company_id: str,
    case_id: str,
    payload: VisitorCaseRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Verify request Origin and signed tenant/case capability, enforce poll rate and return only status/final
    human answer with no-store. Missing cases raise 404; invalid access raises 403 and internal notes/staff
    identity never leave this boundary.
    """
    org = get_org_by_public_id(company_id, db)
    if not is_domain_allowed(org, request) or not verify_case_access(payload.token, org.id, case_id):
        raise HTTPException(403, "Invalid visitor access")
    ip = request.client.host if request.client else "unknown"
    if not rate_limiter.allow(f"case-poll:{org.id}:{ip}", limit=240, window_seconds=60):
        raise HTTPException(429, "Rate limit exceeded")
    case = db.scalar(select(SupportCase).where(SupportCase.id == case_id, SupportCase.org_id == org.id))
    if not case:
        raise HTTPException(404, "Case not found")
    response.headers["Cache-Control"] = "no-store"
    # Never serialize the internal case model: notes and staff identity stay private.
    return {"status": case.status, "answer": case.human_answer if case.status in {"resolved", "closed"} else None}


def get_org_by_public_id(company_id: str, db: Session) -> Organization:
    """Return the company matching public_id through db or 404 when absent/archived. This is identity lookup only;
    callers still enforce origin, subscription and quota policy.
    """
    org = db.scalar(select(Organization).where(Organization.public_id == company_id))
    if org is None or org.archived_at:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    return org
