"""Tenant-specific widget CORS enforcement before request bodies are available. Public assets bypass tenant policy;
company routes require a permitted HTTP Origin and current organization state.
"""

from sqlalchemy import select
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.config import get_settings
from app.db import SessionLocal
from app.models import Organization
from app.services.domain import is_domain_allowed


class WidgetCORSMiddleware:
    """The URL identifies the tenant before browser preflight sends a request body."""

    def __init__(self, app):
        """Store the downstream ASGI app and configured widget path prefix; no tenant/database lookup occurs until
        a matching request arrives.
        """
        self.app = app
        self.prefix = get_settings().api_v1_prefix + "/widget/"

    async def __call__(self, scope, receive, send):
        """Route HTTP widget traffic by URL company ID, check tenant/origin in a worker thread and answer supported
        preflights. Forward allowed requests with scoped CORS headers; deny invalid companies/origins/methods
        with 403.
        """
        if scope["type"] != "http" or not scope["path"].startswith(self.prefix):
            return await self.app(scope, receive, send)
        request = Request(scope, receive)
        suffix = scope["path"][len(self.prefix) :].split("/")
        if suffix in (["script.js"], ["preview"], ["brand.png"]) or suffix[0] == "assets":
            return await self.app(scope, receive, send)
        company_id = None
        if len(suffix) == 2:
            company_id = suffix[1] if suffix[0] == "settings" else suffix[0]
        elif len(suffix) == 3 and suffix[1] == "cases":
            company_id = suffix[0]
        elif suffix == ["chat"]:
            company_id = request.query_params.get("company_id")

        def permitted():
            """Look up this request's company in a separate Session and return whether it is active, unsuspended
            and origin-allowed. Runs off the event loop and performs no writes.
            """
            with SessionLocal() as db:
                org = db.scalar(select(Organization).where(Organization.public_id == company_id))
                return bool(
                    org
                    and not org.archived_at
                    and org.subscription_status != "suspended"
                    and is_domain_allowed(org, request)
                )

        if not company_id or not await run_in_threadpool(permitted):
            return await JSONResponse({"detail": "Widget origin or company is not allowed"}, status_code=403)(
                scope, receive, send
            )
        origin = request.headers["origin"]
        cors_headers = {
            "Access-Control-Allow-Origin": origin,
            "Vary": "Origin",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Accept",
            "Access-Control-Max-Age": "600",
        }
        if request.method == "OPTIONS":
            method = request.headers.get("access-control-request-method", "")
            headers = {
                h.strip().lower() for h in request.headers.get("access-control-request-headers", "").split(",") if h
            }
            if method not in {"GET", "POST"} or not headers.issubset({"content-type", "accept"}):
                return await Response(status_code=403)(scope, receive, send)
            return await Response(status_code=204, headers=cors_headers)(scope, receive, send)

        async def send_with_cors(message):
            """Intercept ASGI response-start messages, replace existing CORS headers with the validated origin
            policy and forward all messages to the original send callable.
            """
            if message["type"] == "http.response.start":
                message["headers"] = [
                    (k, v) for k, v in message.get("headers", []) if not k.lower().startswith(b"access-control-")
                ]
                message["headers"] += [(k.lower().encode(), v.encode()) for k, v in cors_headers.items()]
            await send(message)

        await self.app(scope, receive, send_with_cors)
