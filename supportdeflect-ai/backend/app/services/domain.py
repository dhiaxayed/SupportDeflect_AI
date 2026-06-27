from urllib.parse import urlparse

from fastapi import Request

from app.core.config import get_settings
from app.models import Organization

settings = get_settings()


def get_request_hostname(request: Request) -> str | None:
    origin = request.headers.get("origin") or request.headers.get("referer")
    if not origin:
        return None
    parsed = urlparse(origin)
    return (parsed.hostname or "").lower() or None


def is_domain_allowed(org: Organization, request: Request) -> bool:
    allowed_domains = [domain.lower().strip() for domain in (org.allowed_domains or []) if domain.strip()]
    if not allowed_domains:
        return settings.environment.lower() not in {"prod", "production"}
    hostname = get_request_hostname(request)
    if not hostname:
        return False
    for domain in allowed_domains:
        if hostname == domain or hostname.endswith(f".{domain}"):
            return True
    return False
