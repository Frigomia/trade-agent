import uuid

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.auth.deps import CurrentUser, get_current_user
from app.rate_limit import rate_limiter


def _make_fake_user_factory():
    """Factory that creates a consistent user for dependency injection."""
    user_id = uuid.uuid4()

    def _fake_user() -> CurrentUser:
        return CurrentUser(id=user_id, email="probe@example.com", role="user")

    return _fake_user


def _make_probe_app() -> FastAPI:
    app = FastAPI()

    @app.get("/probe", dependencies=[Depends(rate_limiter("test_probe", limit=3))])
    def probe() -> dict[str, bool]:
        return {"ok": True}

    app.dependency_overrides[get_current_user] = _make_fake_user_factory()
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


def test_rate_limiter_gives_each_user_their_own_budget():
    # Regression test: before this task, the key was the client IP, so two different users
    # behind the same IP (or, in tests, TestClient's fixed fake "testclient" host) shared one
    # budget and throttled each other.
    probe_app = _make_probe_app()
    with TestClient(probe_app) as probe_client:
        for _ in range(3):
            assert probe_client.get("/probe").status_code == 200
        assert probe_client.get("/probe").status_code == 429  # first user is now throttled

        probe_app.dependency_overrides[get_current_user] = (
            _make_fake_user_factory()
        )  # a second, distinct user
        assert probe_client.get("/probe").status_code == 200  # fresh budget


def test_rate_limit_key_always_gets_a_ttl_even_if_expire_never_runs():
    # Regression test: incr and expire used to be two separate calls, so a crash between them left
    # a key with no TTL and the user was 429'd forever. Making expire unavailable simulates it.
    import redis as sync_redis

    from app.config import settings
    from app.redis_client import get_redis

    user_id = uuid.uuid4()
    probe_app = FastAPI()

    @probe_app.get("/probe", dependencies=[Depends(rate_limiter("ttl_probe", limit=3))])
    def probe() -> dict[str, bool]:
        return {"ok": True}

    probe_app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=user_id, email="probe@example.com", role="user"
    )

    async def _no_expire(*args, **kwargs):
        raise RuntimeError("process died before expire")

    with TestClient(probe_app) as probe_client:
        get_redis().expire = _no_expire  # type: ignore[method-assign]
        assert probe_client.get("/probe").status_code == 200

    checker = sync_redis.Redis.from_url(settings.redis_url)
    ttl = checker.ttl(f"ratelimit:ttl_probe:{user_id}")
    checker.delete(f"ratelimit:ttl_probe:{user_id}")
    assert 0 < ttl <= 60
