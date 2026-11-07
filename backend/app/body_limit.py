"""Reject oversized request bodies before FastAPI buffers and parses them.

FastAPI reads the whole body before authentication runs, so without a cap an anonymous caller
could exhaust the memory of the small production machine. Written as plain ASGI (not
BaseHTTPMiddleware) so a streamed body is counted chunk by chunk and never buffered here.
"""

from starlette.types import ASGIApp, Message, Receive, Scope, Send

MAX_BODY_BYTES = 64 * 1024
# Routes that legitimately take a bigger body. The middleware runs before auth, so the larger
# limit applies only to a request that at least carries a Bearer token (presence, not validity).
LARGE_BODY_LIMITS: dict[str, int] = {"/me/import": 5 * 1024 * 1024}
TOO_LARGE_BODY = b'{"detail":"Request body too large."}'
# A Bearer header's presence is enough to be granted the larger limit, so an anonymous flood could
# buffer 5 MiB per request. At most this many large bodies are in flight at once; the rest get 503.
MAX_LARGE_IN_FLIGHT = 2
BUSY_BODY = b'{"detail":"Too many large uploads right now. Try again shortly."}'
# One event loop and no await between the check and the increment: a plain counter is safe.
_large_in_flight = 0


class _BodyTooLarge(Exception):
    pass


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] in ("GET", "HEAD", "OPTIONS"):
            await self.app(scope, receive, send)
            return

        limit = self.max_bytes
        if any(n == b"authorization" and v.startswith(b"Bearer ") for n, v in scope["headers"]):
            for key, large in LARGE_BODY_LIMITS.items():
                if scope["path"].endswith(key):
                    limit = large

        for name, value in scope["headers"]:
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    declared = 0  # malformed: the byte count below still protects us
                if declared > limit:
                    await self._reject(send)
                    return

        if limit > self.max_bytes:
            global _large_in_flight
            if _large_in_flight >= MAX_LARGE_IN_FLIGHT:
                await self._respond(send, 503, BUSY_BODY, [(b"retry-after", b"5")])
                return
            _large_in_flight += 1
            try:
                await self._forward(scope, receive, send, limit)
            finally:
                _large_in_flight -= 1
        else:
            await self._forward(scope, receive, send, limit)

    async def _forward(self, scope: Scope, receive: Receive, send: Send, limit: int) -> None:
        received = 0
        response_started = False

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _BodyTooLarge
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except _BodyTooLarge:
            if response_started:
                raise  # too late to change the status; let the server drop the connection
            await self._reject(send)

    async def _reject(self, send: Send) -> None:
        await self._respond(send, 413, TOO_LARGE_BODY)

    async def _respond(
        self, send: Send, status: int, body: bytes, extra: list[tuple[bytes, bytes]] | None = None
    ) -> None:
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    *(extra or []),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
