import asyncio
import contextlib
import json

from app import body_limit
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


def _run_asgi(chunks: list[bytes], headers: list[tuple[bytes, bytes]], path: str = "/x"):
    """Drive the middleware with a streamed body; return (sent, bytes seen, unread chunks)."""
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

    scope = {"type": "http", "method": "POST", "path": path, "headers": headers}
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


BEARER = [(b"authorization", b"Bearer abc")]
MB = 1024 * 1024


def test_import_path_accepts_a_body_over_64kb_with_a_bearer_token():
    sent, seen, _ = _run_asgi([b"x" * MB] * 2, headers=BEARER, path="/me/import")
    assert sent[0]["status"] == 200
    assert seen == 2 * MB


def test_import_path_still_rejects_over_5mb():
    sent, _, _ = _run_asgi([b"x" * MB] * 6, headers=BEARER, path="/me/import")
    assert sent[0]["status"] == 413
    declared = [(b"authorization", b"Bearer abc"), (b"content-length", str(5 * MB + 1).encode())]
    sent, _, _ = _run_asgi([b"x"], headers=declared, path="/me/import")
    assert sent[0]["status"] == 413


def test_import_path_without_a_bearer_token_keeps_the_64kb_limit():
    sent, _, _ = _run_asgi([b"x" * MB], headers=[], path="/me/import")
    assert sent[0]["status"] == 413
    basic = [(b"authorization", b"Basic abc")]
    sent, _, _ = _run_asgi([b"x" * MB], headers=basic, path="/me/import")
    assert sent[0]["status"] == 413


def test_other_paths_keep_the_64kb_limit_even_with_a_token():
    sent, _, _ = _run_asgi([b"x" * MB], headers=BEARER, path="/portfolio/holdings")
    assert sent[0]["status"] == 413


def test_get_is_untouched(anon_client):
    assert anon_client.get("/health").status_code == 200


BUSY = {"detail": "Too many large uploads right now. Try again shortly."}


def _drive(app, headers, path="/me/import", body=b"x"):
    """Start the middleware over `app` as its own task; return (task, sent messages)."""
    sent: list[dict] = []
    queue = [{"type": "http.request", "body": body, "more_body": False}]

    async def receive():
        return queue.pop(0)

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": "POST", "path": path, "headers": headers}
    return asyncio.ensure_future(BodySizeLimitMiddleware(app)(scope, receive, send)), sent


def _holding_app(gate: asyncio.Event, fail: bool = False):
    """An app that reads its body, then waits for `gate`, then answers (or crashes)."""

    async def app(scope, receive, send):
        await receive()
        await gate.wait()
        if fail:
            raise RuntimeError("boom")
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    return app


def test_a_third_concurrent_large_upload_is_503_with_retry_after():
    async def scenario():
        gate = asyncio.Event()
        first = _drive(_holding_app(gate), BEARER)
        second = _drive(_holding_app(gate), BEARER)
        await asyncio.sleep(0)
        third_task, third = _drive(_holding_app(gate), BEARER)
        await third_task
        gate.set()
        await asyncio.gather(first[0], second[0])
        return third, first[1], second[1]

    third, first, second = asyncio.run(scenario())

    assert third[0]["status"] == 503
    assert (b"retry-after", b"5") in third[0]["headers"]
    assert json.loads(third[1]["body"]) == BUSY
    assert first[0]["status"] == second[0]["status"] == 200


def test_a_large_upload_slot_is_freed_when_the_request_ends_or_fails():
    async def scenario():
        gate = asyncio.Event()
        gate.set()
        for fail in (False, True, False, True, False):  # more requests than slots
            task, sent = _drive(_holding_app(gate, fail), BEARER)
            with contextlib.suppress(RuntimeError):
                await task
            if not fail:
                assert sent[0]["status"] == 200
        return body_limit._large_in_flight

    assert asyncio.run(scenario()) == 0


def test_a_rejected_large_upload_does_not_hold_a_slot():
    async def scenario():
        gate = asyncio.Event()
        held = [_drive(_holding_app(gate), BEARER) for _ in range(2)]
        await asyncio.sleep(0)
        too_big = [(b"content-length", str(6 * MB).encode())]
        task, sent = _drive(_holding_app(gate), BEARER + too_big)
        await task
        gate.set()
        for h in held:
            await h[0]
        return sent[0]["status"], body_limit._large_in_flight

    assert asyncio.run(scenario()) == (413, 0)


def test_requests_on_the_default_limit_are_never_blocked_by_large_uploads():
    async def scenario():
        gate = asyncio.Event()
        held = [_drive(_holding_app(gate), BEARER) for _ in range(2)]
        await asyncio.sleep(0)
        other_gate = asyncio.Event()
        other_gate.set()
        results = []
        for path, headers in (("/portfolio/holdings", BEARER), ("/me/import", [])):
            task, sent = _drive(_holding_app(other_gate), headers, path=path)
            await task
            results.append(sent[0]["status"])
        gate.set()
        for h in held:
            await h[0]
        return results

    assert asyncio.run(scenario()) == [200, 200]
