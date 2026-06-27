from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_org
from app.models import Organization
from app.schemas import SubscriptionUsageOut, WidgetSettingsUpdate
from app.services.subscriptions import quota_payload

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/widget", response_model=WidgetSettingsUpdate)
def get_widget_settings(org: Organization = Depends(get_current_org)) -> WidgetSettingsUpdate:
    return WidgetSettingsUpdate(
        brand_name=org.widget_brand_name,
        primary_color=org.widget_primary_color,
        greeting_message=org.widget_greeting,
        support_email=org.support_email,
        strict_mode=org.strict_mode,
        allowed_domains=org.allowed_domains or [],
    )


@router.put("/widget", response_model=WidgetSettingsUpdate)
def update_widget_settings(
    payload: WidgetSettingsUpdate,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_current_org),
) -> WidgetSettingsUpdate:
    org.widget_brand_name = payload.brand_name
    org.widget_primary_color = payload.primary_color
    org.widget_greeting = payload.greeting_message
    org.support_email = str(payload.support_email) if payload.support_email else None
    org.strict_mode = payload.strict_mode
    org.allowed_domains = payload.allowed_domains
    db.add(org)
    db.commit()
    db.refresh(org)
    return get_widget_settings(org)


@router.get("/subscription", response_model=SubscriptionUsageOut)
def get_subscription_usage(
    db: Session = Depends(get_db),
    org: Organization = Depends(get_current_org),
) -> dict:
    return quota_payload(org, db)
