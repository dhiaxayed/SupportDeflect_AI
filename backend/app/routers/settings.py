"""Tenant widget configuration, owned raster assets and subscription usage."""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import get_db
from app.deps import get_billing_org, get_tenant_admin_org, require_tenant_admin
from app.models import Organization, User
from app.schemas import SubscriptionUsageOut, WidgetSettingsUpdate
from app.services.audit import record_audit_event
from app.services.subscriptions import quota_payload
from app.services.widget_assets import store_logo, validate_owned_logo

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/widget", response_model=WidgetSettingsUpdate)
def get_widget_settings(org: Organization = Depends(get_tenant_admin_org)) -> WidgetSettingsUpdate:
    """Serialize the authorized tenant's saved branding, domain policy and versioned design, applying schema
    defaults for older empty designs; performs no write.
    """
    return WidgetSettingsUpdate(
        brand_name=org.widget_brand_name,
        primary_color=org.widget_primary_color,
        greeting_message=org.widget_greeting,
        support_email=org.support_email,
        strict_mode=org.strict_mode,
        allowed_domains=org.allowed_domains or [],
        design=org.widget_design or {},
    )


@router.put("/widget", response_model=WidgetSettingsUpdate)
def update_widget_settings(
    payload: WidgetSettingsUpdate,
    db: Session = Depends(get_db),
    org: Organization = Depends(get_tenant_admin_org),
    actor: User = Depends(require_tenant_admin),
) -> WidgetSettingsUpdate:
    # Older settings clients can update safety/domains without erasing the design.
    """Validate tenant ownership/custom-logo readiness and commit supplied widget policy plus audit. Preserve an
    existing design when older clients omit design, then return the refreshed saved settings.
    """
    if "design" in payload.model_fields_set:
        validate_owned_logo(org.id, payload.design.logo_path)
        if payload.design.identity == "custom" and not payload.design.logo_path:
            raise HTTPException(422, "Upload a logo before choosing custom identity")
        org.widget_design = payload.design.model_dump()
    org.widget_brand_name = payload.brand_name
    org.widget_primary_color = payload.primary_color
    org.widget_greeting = payload.greeting_message
    org.support_email = str(payload.support_email) if payload.support_email else None
    org.strict_mode = payload.strict_mode
    org.allowed_domains = payload.allowed_domains
    db.add(org)
    record_audit_event(
        db,
        scope="tenant",
        action="widget.settings_updated",
        target_type="organization",
        target_id=org.id,
        actor=actor,
        org_id=org.id,
        metadata={"allowed_domains": org.allowed_domains, "strict_mode": org.strict_mode},
    )
    db.commit()
    db.refresh(org)
    return get_widget_settings(org)


@router.post("/widget/logo", status_code=201)
def upload_widget_logo(
    file: UploadFile = File(...),
    org: Organization = Depends(get_tenant_admin_org),
) -> dict[str, str]:
    # Decode/re-encode potentially expensive image data in FastAPI's worker pool.
    """Read bounded image bytes for this tenant and store a validated/re-encoded local logo in the worker thread.
    Return its public asset path; saving the design reference is a separate settings operation.
    """
    content = file.file.read(get_settings().widget_logo_max_bytes + 1)
    file.file.close()
    return {"logo_path": store_logo(org.id, content)}


@router.get("/subscription", response_model=SubscriptionUsageOut)
def get_subscription_usage(
    db: Session = Depends(get_db),
    org: Organization = Depends(get_billing_org),
) -> dict:
    """Return quota_payload for the tenant administrator's organization; the billing dependency permits suspended
    tenants to inspect renewal/usage while archival still denies access.
    """
    return quota_payload(org, db)
