import asyncio

from app.body_limit import MAX_BODY_BYTES, BodySizeLimitMiddleware

TOO_LARGE = {"detail": "Request body too large."}


def _json_body(size: int) -> bytes:
    """A valid JSON string body of exactly `size` bytes."""
    return b'"' + b"a" * (size - 2) + b'"'


def test_declared_content_length_over_limit_is_413(anon_client):
    response = anon_client.post(
        "/portfolio/holdings",
        content=_json_body(MAX_BODY_BYTES + 1),
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json() == TOO_LARGE


def test_body_exactly_at_limit_passes_the_middleware(anon_client):
    response = anon_client.post(
        "/portfolio/holdings",
        content=_json_body(MAX_BODY_BYTES),
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 401  # reached auth


def test_normal_requests_pass(client):
    holding = {
        "ticker": "AAPL",
        "name": "Apple",
        "asset_type": "STOCK",
        "shares": 1,
        "cost_basis": 1,
        "first_purchase_date": "2024-01-01",
    }
    assert client.post("/portfolio/holdings", json=holding).status_code == 200
    assert client.put("/me/claude-key", json={"key": "x"}).status_code != 413
    assert client.get("/portfolio/holdings").status_code == 200


def _run_asgi(chunks: list[bytes], headers: list[tuple[bytes, bytes]]):
    """Drive the middleware directly with a streamed body; return (sent messages, bytes the app saw)."""
    seen = 0

    async def app(scope, receive, send):
        nonlocal seen
        while True:
            message = await receive()
            seen += len(message.get("body", b""))
            if not message.get("more_body"):
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    queue = [
        {"type": "http.request", "body": c, "more_body": i < len(chunks) - 1}
        for i, c in enumerate(chunks)
    ]

    async def receive():
        return queue.pop(0)

    sent: list[dict] = []

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": "POST", "headers": headers}
    asyncio.run(BodySizeLimitMiddleware(app)(scope, receive, send))
    return sent, seen, queue


def test_streamed_body_over_limit_is_413_without_reading_everything():
    chunk = b"x" * 16384
    sent, seen, remaining = _run_asgi([chunk] * 10, headers=[])  # no content-length: chunked
    assert sent[0]["status"] == 413
    assert sent[1]["body"] == b'{"detail":"Request body too large."}'
    assert seen <= MAX_BODY_BYTES  # app never saw the over-limit chunk
    assert remaining  # the rest of the stream was never pulled


def test_streamed_body_at_limit_passes():
    chunk = b"x" * 16384
    sent, seen, _ = _run_asgi([chunk] * 4, headers=[])
    assert sent[0]["status"] == 200
    assert seen == MAX_BODY_BYTES


def test_get_is_untouched(anon_client):
    assert anon_client.get("/health").status_code == 200
