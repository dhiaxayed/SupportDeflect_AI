"""Validate browser Origin hostnames against a tenant widget allowlist.

This is a browser-origin policy, not visitor authentication: nonbrowser clients
can forge Origin, so capability checks, rate limits and quotas remain separate.
"""

from urllib.parse import urlparse

from fastapi import Request

from app.core.config import get_settings
from app.models import Organization

settings = get_settings()


def get_request_hostname(request: Request) -> str | None:
    """Return a normalized hostname from a valid HTTP(S) Origin, or None.

    Require an Origin rather than inferring identity from Referer/Host. Reject
    credentials, malformed ports and URL path/query/fragment content before any
    CORS reflection; hostname comparison uses lowercase IDNA without a trailing dot.
    """
    origin = request.headers.get("origin")
    if not origin:
        return None
    try:
        parsed = urlparse(origin)
        hostname = (parsed.hostname or "").lower().rstrip(".").encode("idna").decode("ascii")
        _ = parsed.port  # Reject malformed ports before reflecting an Origin.
    except (ValueError, UnicodeError):
        return None
    if (
        parsed.scheme not in {"http", "https"}
        or parsed.path not in {"", "/"}
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        return None
    return hostname or None


def is_domain_allowed(org: Organization, request: Request) -> bool:
    """Check the request Origin against the organization's configured hostnames.

    Empty allowlists fail closed. Exact hosts and dot-delimited subdomains match;
    ports are not distinguished. This pure browser-policy check does not authenticate
    a visitor or verify a case capability.
    """
    allowed_domains = [domain.lower().strip() for domain in (org.allowed_domains or []) if domain.strip()]
    if not allowed_domains:
        return False
    hostname = get_request_hostname(request)
    if not hostname:
        return False
    for domain in allowed_domains:
        if hostname == domain or hostname.endswith(f".{domain}"):
            return True
    return False
