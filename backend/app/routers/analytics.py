"""Tenant-administrator analytics adapters. Authentication supplies the organization; aggregate queries never
accept an arbitrary cross-tenant ID from the request.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_tenant_admin_org
from app.models import Organization
from app.schemas import AnalyticsQuestion, AnalyticsSummary
from app.services.analytics import analytics_service

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/summary", response_model=AnalyticsSummary)
def summary(
    db: Session = Depends(get_db),
    org: Organization = Depends(get_tenant_admin_org),
) -> AnalyticsSummary:
    """Return analytics_service aggregates for the authenticated administrator's org.id through db; reads only,
    with subscription/tenant access enforced by the dependency.
    """
    return analytics_service.summary(db, org.id)


@router.get("/unresolved", response_model=list[AnalyticsQuestion])
def unresolved(
    db: Session = Depends(get_db),
    org: Organization = Depends(get_tenant_admin_org),
) -> list[AnalyticsQuestion]:
    """Return the tenant's bounded unresolved-conversation view from analytics_service; org is authorized by the
    administrator dependency and no conversation state is changed.
    """
    return analytics_service.unresolved(db, org.id)
