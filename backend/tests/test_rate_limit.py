from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.rate_limit import rate_limiter


def _make_probe_app() -> FastAPI:
    app = FastAPI()

    @app.get("/probe", dependencies=[Depends(rate_limiter("test_probe", limit=3))])
    def probe() -> dict[str, bool]:
        return {"ok": True}

    return app


def test_rate_limiter_allows_calls_up_to_the_limit():
    # Entering TestClient's `with` block keeps one event loop alive across
    # every request made inside it -- without it, each call gets its own
    # loop and the second Redis call fails with "Event loop is closed"
    # (same reason conftest's `client` fixture uses this pattern).
    with TestClient(_make_probe_app()) as probe_client:
        for _ in range(3):
            assert probe_client.get("/probe").status_code == 200


def test_rate_limiter_blocks_after_the_limit():
    with TestClient(_make_probe_app()) as probe_client:
        for _ in range(3):
            probe_client.get("/probe")

        response = probe_client.get("/probe")

    assert response.status_code == 429
