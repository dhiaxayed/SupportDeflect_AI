"""FastAPI authentication and authorization dependencies. JWTs identify users, but current database roles, token
versions, invitation state and organization lifecycle determine access.
"""

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import get_db
from app.models import TENANT_ROLES, Organization, User, UserRole
from app.security import decode_access_token
from app.services.invitations import require_valid_invitation

settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.api_v1_prefix}/auth/login")


def get_current_user(
    request: Request,
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    """Decode the bearer token and reload its active user through db. Reject invalid/revoked identities with 401
    and archived organizations or restricted invitation sessions with 403; return the current ORM user without
    committing.
    """
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
    except ValueError:
        raise credentials_error from None
    user_id = payload.get("sub")
    if not isinstance(user_id, str):
        raise credentials_error
    user = db.scalar(select(User).where(User.id == user_id, User.is_active.is_(True)))
    if user is None or payload.get("version", 0) != user.token_version:
        raise credentials_error
    if user.org_id and user.organization.archived_at is not None:
        raise HTTPException(403, "Organization is archived")
    require_valid_invitation(user)
    if user.must_change_password and request.url.path not in {
        f"{settings.api_v1_prefix}/auth/me",
        f"{settings.api_v1_prefix}/auth/change-password",
    }:
        raise HTTPException(403, detail={"code": "password_change_required", "message": "Change your initial password"})
    return user


def require_tenant_user(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    """Return the authenticated user only when a tenant role and organization ID are present; deny platform
    accounts or malformed tenant identities with HTTP 403.
    """
    if current_user.role not in TENANT_ROLES or not current_user.org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access required")
    return current_user


def require_tenant_admin(current_user: Annotated[User, Depends(require_tenant_user)]) -> User:
    """Require the tenant_admin role after tenant authentication and return that user; support agents receive HTTP
    403.
    """
    if current_user.role != UserRole.TENANT_ADMIN.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant administrator access required")
    return current_user


def require_support_access(current_user: Annotated[User, Depends(require_tenant_user)]) -> User:
    """Return an authenticated tenant administrator/support agent for support workflows; reject any other role with
    HTTP 403.
    """
    if current_user.role not in {UserRole.TENANT_ADMIN.value, UserRole.SUPPORT_AGENT.value}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Support access required")
    return current_user


def require_super_admin(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    """Return only an authenticated super_admin with no tenant organization; tenant or inconsistent platform
    identities receive HTTP 403.
    """
    if current_user.role != UserRole.SUPER_ADMIN.value or current_user.org_id is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Platform administrator access required")
    return current_user


def get_tenant_admin_org(
    current_user: Annotated[User, Depends(require_tenant_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> Organization:
    """Load the administrator's own usable organization from db; archived/suspended organizations are denied and no
    request-supplied organization ID is trusted.
    """
    return _load_tenant_org(db, current_user)


def get_support_org(
    current_user: Annotated[User, Depends(require_support_access)],
    db: Annotated[Session, Depends(get_db)],
) -> Organization:
    """Load the support user's own usable organization for tenant staff workflows; propagate lifecycle/absence
    errors from the shared loader.
    """
    return _load_tenant_org(db, current_user)


def get_billing_org(
    current_user: Annotated[User, Depends(require_tenant_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> Organization:
    # Suspension blocks workspace operations, not the administrator's renewal/usage information.
    """Return the tenant administrator's organization while permitting suspension for renewal/usage inspection.
    Archival still denies access; no state is changed.
    """
    return _load_tenant_org(db, current_user, allow_suspended=True)


def _load_tenant_org(db: Session, current_user: User, *, allow_suspended: bool = False) -> Organization:
    """Resolve current_user.org_id through db, returning its organization or 404. Deny archival and, unless
    allow_suspended is set, suspension with 403; never commit or cross tenant boundaries.
    """
    org = db.get(Organization, current_user.org_id)
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    if org.archived_at or (org.subscription_status == "suspended" and not allow_suspended):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization is suspended")
    return org
