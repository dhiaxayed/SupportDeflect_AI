"""Verify privacy at both application and actual Uvicorn logging-handler boundaries.

Only synthetic sensitive strings are emitted. Handler fixtures preserve and restore
the test process configuration while testing exception values, access URLs and UTC output."""

import logging
import sys
from io import StringIO

import pytest
from uvicorn import Config

from app.core.logging import RedactingFilter, SafeFormatter, configure_logging


def test_exception_logs_keep_locations_without_exception_values():
    """Retain exception type/call sites while discarding private exception values and another handler's cached raw
    text.
    """
    try:
        raise RuntimeError("private-document-and-credential-value")
    except RuntimeError:
        record = logging.LogRecord("test", logging.ERROR, __file__, 1, "Provider failed", (), sys.exc_info())
    record.exc_text = "another-handler-cached-private-document-and-credential-value"
    output = SafeFormatter("%(message)s").format(record)
    assert "RuntimeError" in output
    assert "test_logging.py" in output
    assert "private-document-and-credential-value" not in output
    assert "Provider failed" in output


def test_log_time_is_utc_and_sensitive_messages_are_redacted():
    """Require UTC timestamps and removal of sensitive message arguments at the formatter/filter boundary."""
    record = logging.LogRecord("test", logging.INFO, __file__, 1, "authorization=%s", ("private-value",), None)
    record.created = 0
    assert RedactingFilter().filter(record)
    output = SafeFormatter("%(asctime)s %(message)s", datefmt="%Y-%m-%dT%H:%M:%SZ").format(record)
    assert output.startswith("1970-01-01T00:00:00Z")
    assert "private-value" not in output


@pytest.fixture
def server_logging(monkeypatch):
    # Uvicorn installs its own handlers before importing app.main in real startup.
    # Preserve the surrounding test process's logging configuration afterward.
    """Configure real Uvicorn handlers with in-memory output and restore the surrounding logging state after each
    test.
    """
    for name in ("", "uvicorn", "uvicorn.error", "uvicorn.access", "groq", "httpcore"):
        logger = logging.getLogger(name)
        for attribute in ("handlers", "filters", "level", "propagate", "disabled"):
            value = getattr(logger, attribute)
            monkeypatch.setattr(logger, attribute, list(value) if isinstance(value, list) else value)
    Config("app.main:app", log_level="info")
    configure_logging(False)
    output = StringIO()
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        for handler in logging.getLogger(name).handlers:
            # Exercise the real server handlers without depending on pytest's
            # capture streams, which dictConfig replaces during Uvicorn setup.
            monkeypatch.setattr(handler, "stream", output)
    return output


def test_asgi_server_handler_does_not_expose_exception_values(server_logging):
    """Emit an uncaught-ASGI-style exception through the real server handler and reject private values while retaining
    diagnostics.
    """
    try:
        raise RuntimeError("synthetic-private-document-value")
    except RuntimeError:
        logging.getLogger("uvicorn.error").exception("Unhandled ASGI request")
    output = server_logging.getvalue()
    assert "synthetic-private-document-value" not in output
    assert "RuntimeError" in output
    assert "test_logging.py" in output
    assert "Unhandled ASGI request" in output


def test_access_handler_redacts_sensitive_query_values(server_logging):
    """Emit a token-bearing fixture access URL and require handler-level redaction before output."""
    logging.getLogger("uvicorn.access").info(
        '%s - "%s %s HTTP/%s" %d', "127.0.0.1:1234", "GET", "/fixture?token=synthetic-private-value", "1.1", 200
    )
    output = server_logging.getvalue()
    assert "synthetic-private-value" not in output
    assert "redacted sensitive log message" in output
