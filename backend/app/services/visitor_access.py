"""Signed, audience-bound visitor capabilities for one tenant support case.

Tokens permit reply polling only; they are distinct from staff login JWTs and
remain subject to the widget route's independent organization/origin checks.
"""

from datetime import UTC, datetime, timedelta

import jwt

from app.core.config import get_settings


def issue_case_access(org_id: str, case_id: str) -> str:
    """Return a seven-day signed capability bound to one organization and support case.

    The widget-case audience prevents reuse as a staff access token. Callers must
    create/authorize the case first and treat the returned capability as private;
    this helper writes no database state or independent revocation record.
    """
    settings = get_settings()
    # An audience-bound capability cannot authenticate as an application user.
    return jwt.encode(
        {"sub": case_id, "org": org_id, "aud": "widget-case", "exp": datetime.now(UTC) + timedelta(days=7)},
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )


def verify_case_access(token: str, org_id: str, case_id: str) -> bool:
    """Return whether a signed, unexpired widget capability matches both supplied IDs.

    Require subject, tenant, expiry and widget-case audience using the configured
    algorithm/key. Invalid JWTs return False without exception details; organization
    activity and allowed Origin checks remain responsibilities of the public route.
    """
    settings = get_settings()
    try:
        claims = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
            audience="widget-case",
            options={"require": ["sub", "org", "exp", "aud"]},
        )
        return claims["sub"] == case_id and claims["org"] == org_id
    except jwt.InvalidTokenError:
        return False
