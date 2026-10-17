"""UTC application/server logs that omit sensitive messages and exception values."""

import logging
import sys
import time
import traceback
from urllib.parse import urlsplit

from app.core.source_urls import redact_source_urls

SENSITIVE_WORDS = ("password", "authorization", "token", "secret", "api_key")


class RedactingFilter(logging.Filter):
    """Sanitize complete log messages containing credential-related markers while retaining the record for
    operational diagnostics.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        """Inspect the rendered record message and replace sensitive text/arguments in place. Always return True:
        records are sanitized rather than silently discarded.
        """
        private_message = record.getMessage()
        if record.name == "uvicorn.access" and isinstance(record.args, tuple) and len(record.args) == 5:
            client, method, target, version, code = record.args
            try:
                target = urlsplit(str(target)).path
            except ValueError:
                target = "[private request URL]"
            record.args = (client, method, target, version, code)
        original = record.getMessage()
        rendered = redact_source_urls(original)
        record.msg, record.args = rendered, ()
        message = private_message.lower()
        if any(word in message for word in SENSITIVE_WORDS):
            record.msg = "[redacted sensitive log message]"
            record.args = ()
        return True


class SafeFormatter(logging.Formatter):
    """Format timestamps in UTC and rebuild exception output without exception values, source lines or another
    handler's cached traceback text.
    """

    converter = time.gmtime

    def formatException(self, exc_info) -> str:
        # SQL/provider exception strings may embed query parameters or credentials.
        # Preserve the exception type and call sites without serializing their values.
        """Return exception type and traceback file/line/function locations from exc_info. Omit exception values
        and source snippets, which may contain SQL parameters or provider credentials.
        """
        frames = traceback.extract_tb(exc_info[2])
        locations = "\n".join(f'  File "{frame.filename}", line {frame.lineno}, in {frame.name}' for frame in frames)
        return f"Traceback (most recent call last):\n{locations}\n{exc_info[0].__name__}: details omitted"

    def format(self, record: logging.LogRecord) -> str:
        # Another handler may already have cached the unredacted exception text.
        """Clear cached exception text on record before standard formatting so a previous handler cannot bypass
        this formatter's redaction boundary.
        """
        record.exc_text = None
        return super().format(record)


def configure_logging(debug: bool = False) -> None:
    """Replace root handlers with a sanitized stdout handler at the requested debug level, protect existing Uvicorn
    handlers, and limit SDK payload logs. Mutates process logging configuration; never enables raw exception-
    value logging.
    """
    level = logging.DEBUG if debug else logging.INFO
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(RedactingFilter())
    formatter = SafeFormatter(
        fmt="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%SZ",
    )
    handler.setFormatter(formatter)
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)
    # Uvicorn creates independent handlers before importing app.main. Replacing
    # only root handlers leaves uncaught ASGI/SQL exceptions and access URLs raw.
    # Preserve their streams/propagation while applying the same privacy boundary.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        for server_handler in logging.getLogger(name).handlers:
            server_handler.setFormatter(formatter)
            if not any(isinstance(item, RedactingFilter) for item in server_handler.filters):
                server_handler.addFilter(RedactingFilter())
    # SDK debug payloads can include complete tenant knowledge/history, not only secrets.
    logging.getLogger("groq").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.INFO)
