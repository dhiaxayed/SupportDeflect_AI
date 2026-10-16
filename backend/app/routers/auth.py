"""Public registration/login and authenticated account maintenance. Writes atomically combine identity changes,
safe audit metadata and outbox records; duplicate-email conflicts are recovered after rollback.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import get_db
from app.deps import get_current_user
from app.models import Organization, User, UserRole
from app.schemas import ChangePasswordRequest, LoginRequest, RegisterRequest, TokenResponse, UserOut
from app.security import create_access_token, get_password_hash, verify_password
from app.services.accounts import raise_account_creation_conflict
from app.services.audit import record_audit_event
from app.services.invitations import require_valid_invitation
from app.services.mailing import cancel_pending_invitations, notify_org, queue_mail
from app.services.organizations import generate_company_public_id
from app.services.rate_limiter import rate_limiter
from app.services.subscriptions import trial_end_for_new_org

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    """Rate-limit request IP, create a trial organization and tenant administrator from payload, and commit welcome
    outbox data with the identity. Return a token/user snapshot; duplicate email raises 409, including
    concurrent insertion races.
    """
    enforce_admin_rate_limit(request, "register")
    email = payload.admin_email.lower()
    existing = db.scalar(select(User).where(User.email == email))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists")

    org = Organization(
        public_id=generate_company_public_id(db),
        name=payload.organization_name.strip(),
        widget_brand_name=payload.organization_name.strip()[:120],
        widget_primary_color=settings.default_widget_primary_color,
        widget_greeting=settings.default_widget_greeting,
        strict_mode=True,
        allowed_domains=[],
        subscription_plan="trial",
        subscription_status="trialing",
        trial_ends_at=trial_end_for_new_org(),
    )
    user = User(
        organization=org,
        email=email,
        full_name=payload.admin_full_name,
        hashed_password=get_password_hash(payload.password),
        role=UserRole.TENANT_ADMIN.value,
    )
    db.add(org)
    db.add(user)
    try:
        db.flush()
    except IntegrityError as error:
        raise_account_creation_conflict(
            db, email=email, error=error, detail="A user with this email already exists"
        )
    notify_org(
        db,
        org,
        "welcome",
        "Bienvenue sur SupportDeflect AI",
        f"Votre espace {org.name} est pret. Votre essai se termine le {org.trial_ends_at:%d/%m/%Y}.",
    )
    db.commit()
    db.refresh(user)
    return build_token_response(user)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    """Rate-limit request IP and validate active email/password, archival and invitation expiry through db. Return
    a fresh token snapshot or sanitized 401/403; successful login does not activate an invitation by itself.
    """
    enforce_admin_rate_limit(request, "login")
    user = db.scalar(select(User).where(User.email == payload.email.lower(), User.is_active.is_(True)))
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if user.organization and user.organization.archived_at:
        raise HTTPException(403, "Organization is archived")
    require_valid_invitation(user)
    return build_token_response(user)


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)) -> User:
    """Return the dependency-validated current_user as UserOut; this remains available to a valid mandatory-reset
    session so clients can choose the password-change flow.
    """
    return current_user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Lock/recheck the current account version, verify old credentials and commit replacement hash, invitation
    acceptance, JWT revocation, audit and optional confirmation email. Return no body; stale/invalid account or
    password state raises an HTTP error.
    """
    version = current_user.token_version
    db.refresh(current_user, with_for_update=True)
    if current_user.token_version != version or not current_user.is_active:
        raise HTTPException(401, "Account changed. Sign in again.")
    require_valid_invitation(current_user)
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    if payload.new_password == payload.current_password:
        raise HTTPException(400, "Choose a different password")
    current_user.hashed_password = get_password_hash(payload.new_password)
    current_user.must_change_password = False
    current_user.temporary_password_expires_at = None
    current_user.token_version += 1
    cancel_pending_invitations(db, current_user.id, "invitation_accepted")
    from app.models import MailAutomation

    automation = db.get(MailAutomation, "password_changed")
    if not automation or automation.enabled:
        queue_mail(
            db,
            recipient=current_user.email,
            org_id=current_user.org_id,
            user_id=current_user.id,
            subject="Votre mot de passe a ete modifie",
            template="password_changed",
            payload={"message": "Le mot de passe de votre compte SupportDeflect AI a ete modifie."},
        )
    record_audit_event(
        db,
        scope="platform" if current_user.org_id is None else "tenant",
        action="account.password_changed",
        target_type="user",
        target_id=current_user.id,
        actor=current_user,
        org_id=current_user.org_id,
    )
    db.add(current_user)
    db.commit()


def build_token_response(user: User) -> TokenResponse:
    """Build a signed bearer token from the current ORM user's ID/org/role/version and pair it with a safe UserOut;
    performs no database write or authorization shortcut.
    """
    token = create_access_token(
        subject=user.id, extra_claims={"org_id": user.org_id, "role": user.role, "version": user.token_version}
    )
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


def enforce_admin_rate_limit(request: Request, action: str) -> None:
    """Consume the configured per-minute request-IP/action budget for login/register; raise HTTP 429 on rejection
    and return None when admitted.
    """
    ip = request.client.host if request.client else "unknown"
    key = f"admin:{action}:{ip}"
    if not rate_limiter.allow(key, limit=settings.admin_rate_limit_per_minute, window_seconds=60):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")
