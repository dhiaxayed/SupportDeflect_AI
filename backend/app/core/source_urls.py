"""Public source attribution; private fetch URLs retain their original access parameters."""

import re
from urllib.parse import urlsplit, urlunsplit

HTTP_URL = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)


def public_source_url(value: str) -> str:
    """Keep HTTP origin/path, omitting credentials, query and fragment at the response boundary.

    Query names cannot reliably identify credentials (including encoded/signed values).
    Document identity and titles retain attribution without publishing access URLs.
    File names are unchanged; malformed HTTP URLs fail closed rather than echoing secrets.
    """
    if not value.lower().startswith(("http://", "https://")):
        return value
    try:
        parsed = urlsplit(value)
        if not parsed.hostname:
            return "Private source URL"
        return urlunsplit((parsed.scheme, parsed.netloc.rsplit("@", 1)[-1], parsed.path, "", ""))
    except ValueError:
        return "Private source URL"


def redact_source_urls(value: str) -> str:
    """Sanitize URL occurrences in legacy titles, snippets and log messages without mutating storage."""
    return HTTP_URL.sub(lambda match: public_source_url(match.group()), value)
