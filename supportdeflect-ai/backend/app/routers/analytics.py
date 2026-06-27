from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_org
from app.models import Organization
from app.schemas import AnalyticsQuestion, AnalyticsSummary
from app.services.analytics import analytics_service

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/summary", response_model=AnalyticsSummary)
def summary(
    db: Session = Depends(get_db),
    org: Organization = Depends(get_current_org),
) -> AnalyticsSummary:
    return analytics_service.summary(db, org.id)


@router.get("/unresolved", response_model=list[AnalyticsQuestion])
def unresolved(
    db: Session = Depends(get_db),
    org: Organization = Depends(get_current_org),
) -> list[AnalyticsQuestion]:
    return analytics_service.unresolved(db, org.id)
