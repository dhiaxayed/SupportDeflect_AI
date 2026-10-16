"""Hash/verify bounded bcrypt passwords and sign/decode configured JWTs. Authorization and token-version revocation
are enforced separately against current database state.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from jwt import InvalidTokenError
from passlib.context import CryptContext

from app.core.config import get_settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
settings = get_settings()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Compare a plaintext password against its stored bcrypt hash; return False above bcrypt's 72 UTF-8 byte
    bound. Hash-format/backend errors propagate rather than being treated as a successful match.
    """
    if len(plain_password.encode("utf-8")) > 72:
        return False
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Return a salted bcrypt hash of password; reject input above 72 UTF-8 bytes with ValueError to avoid silent
    truncation. Never persist or log plaintext here.
    """
    if len(password.encode("utf-8")) > 72:
        raise ValueError("Password must not exceed 72 UTF-8 bytes")
    return pwd_context.hash(password)


def create_access_token(subject: str, extra_claims: dict[str, Any] | None = None) -> str:
    """Sign a token for subject with configured lifetime and optional extra_claims. Supplied claims are merged into
    the payload; callers provide role/org/version, while current-user authorization remains database-backed.
    """
    expires_delta = timedelta(minutes=settings.access_token_expire_minutes)
    expire = datetime.now(UTC) + expires_delta
    payload: dict[str, Any] = {"sub": subject, "exp": expire}
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    """Verify token signature, configured algorithm and registered expiry claims; return decoded claims or wrap
    invalid JWTs as ValueError for the authentication dependency.
    """
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except InvalidTokenError as exc:
        raise ValueError("Invalid authentication token") from exc
