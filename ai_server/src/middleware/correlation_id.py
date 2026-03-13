"""
Correlation ID middleware for request tracing.

Reads X-Request-ID from the incoming request (forwarded by the backend) or
generates a new UUID. Attaches the ID to the response header so callers can
trace a request end-to-end across backend and AI server logs.

The request_id ContextVar allows route handlers and services to include the
ID in their own log lines without it being passed as an argument.
"""
import uuid
from contextvars import ContextVar
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# Per-request context variable — set at middleware entry, readable anywhere
# in the same async call chain via request_id_var.get()
request_id_var: ContextVar[str] = ContextVar("request_id", default="")


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        req_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        token = request_id_var.set(req_id)
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        response.headers["X-Request-ID"] = req_id
        return response
