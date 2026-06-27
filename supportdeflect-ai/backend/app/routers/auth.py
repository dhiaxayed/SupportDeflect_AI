import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import get_db
from app.deps import get_current_user
from app.models import Organization, User
from app.schemas import LoginRequest, RegisterRequest, TokenResponse, UserOut
from app.security import create_access_token, get_password_hash, verify_password
from app.services.rate_limiter import rate_limiter
from app.services.subscriptions import trial_end_for_new_org

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    enforce_admin_rate_limit(request, "register")
    email = payload.admin_email.lower()
    existing = db.scalar(select(User).where(User.email == email))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists")

    org = Organization(
        public_id=generate_company_public_id(db),
        name=payload.organization_name.strip(),
        widget_brand_name=payload.organization_name.strip(),
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
        role="admin",
    )
    db.add(org)
    db.add(user)
    db.commit()
    db.refresh(user)
    return build_token_response(user)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    enforce_admin_rate_limit(request, "login")
    user = db.scalar(select(User).where(User.email == payload.email.lower(), User.is_active.is_(True)))
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    return build_token_response(user)


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


def build_token_response(user: User) -> TokenResponse:
    token = create_access_token(subject=user.id, extra_claims={"org_id": user.org_id, "role": user.role})
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


def generate_company_public_id(db: Session) -> str:
    while True:
        token = secrets.token_urlsafe(9).replace("-", "").replace("_", "")[:12]
        public_id = f"company_{token}"
        if not db.scalar(select(Organization).where(Organization.public_id == public_id)):
            return public_id


def enforce_admin_rate_limit(request: Request, action: str) -> None:
    ip = request.client.host if request.client else "unknown"
    key = f"admin:{action}:{ip}"
    if not rate_limiter.allow(key, limit=settings.admin_rate_limit_per_minute, window_seconds=60):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")
