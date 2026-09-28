import uuid

import httpx
import pytest
from fastapi import HTTPException

from app.auth.supabase_admin import (
    SupabaseAdmin,
    SupabaseAdminError,
    SupabaseUserExists,
    get_supabase_admin,
)
from app.config import settings
from tests.auth_support import TEST_SUPABASE_URL

USER_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
NEW_KEY = "sb_secret_abc123"
LEGACY_KEY = "eyJlegacy.service.role"


def _client(handler, key: str = NEW_KEY) -> SupabaseAdmin:
    return SupabaseAdmin(TEST_SUPABASE_URL, key, transport=httpx.MockTransport(handler))


def test_invite_posts_the_email_and_returns_the_user_id():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": str(USER_ID), "email": "a@example.com"})

    result = _client(handler).invite("a@example.com", "https://app.example.com/welcome")

    assert result == USER_ID
    request = seen[0]
    assert request.method == "POST"
    assert request.url.path == "/auth/v1/invite"
    assert request.url.params["redirect_to"] == "https://app.example.com/welcome"
    assert request.read() == b'{"email":"a@example.com"}'


def test_invite_without_a_redirect_sends_no_redirect_parameter():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": str(USER_ID)})

    _client(handler).invite("a@example.com", None)

    assert "redirect_to" not in seen[0].url.params


def test_new_style_secret_key_goes_in_apikey_only():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": str(USER_ID)})

    _client(handler, NEW_KEY).invite("a@example.com", None)

    assert seen[0].headers["apikey"] == NEW_KEY
    assert "authorization" not in seen[0].headers


def test_legacy_jwt_key_is_sent_in_both_headers():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": str(USER_ID)})

    _client(handler, LEGACY_KEY).invite("a@example.com", None)

    assert seen[0].headers["apikey"] == LEGACY_KEY
    assert seen[0].headers["authorization"] == f"Bearer {LEGACY_KEY}"


def test_invite_of_a_confirmed_user_raises_user_exists():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json={"code": 422, "error_code": "email_exists", "msg": "x"})

    with pytest.raises(SupabaseUserExists):
        _client(handler).invite("a@example.com", None)


def test_ban_and_unban_put_the_ban_duration():
    bodies = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append((request.method, request.url.path, request.read()))
        return httpx.Response(200, json={})

    client = _client(handler)
    client.ban(USER_ID)
    client.unban(USER_ID)

    assert bodies[0] == ("PUT", f"/auth/v1/admin/users/{USER_ID}", b'{"ban_duration":"876000h"}')
    assert bodies[1] == ("PUT", f"/auth/v1/admin/users/{USER_ID}", b'{"ban_duration":"none"}')


def test_delete_treats_not_found_as_success():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "DELETE"
        assert request.url.path == f"/auth/v1/admin/users/{USER_ID}"
        return httpx.Response(404, json={"error_code": "user_not_found"})

    _client(handler).delete(USER_ID)  # must not raise


@pytest.mark.parametrize("call", ["invite", "ban", "unban", "delete"])
def test_server_errors_raise_without_leaking_the_response(call):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"msg": "secret-in-body a@example.com"})

    client = _client(handler)
    args = ("a@example.com", None) if call == "invite" else (USER_ID,)

    with pytest.raises(SupabaseAdminError) as excinfo:
        getattr(client, call)(*args)

    assert "secret-in-body" not in str(excinfo.value)
    assert "a@example.com" not in str(excinfo.value)


def test_network_failure_raises_supabase_admin_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom with secret host")

    with pytest.raises(SupabaseAdminError) as excinfo:
        _client(handler).ban(USER_ID)

    assert "secret host" not in str(excinfo.value)


def test_unexpected_invite_response_raises():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"no": "id"})

    with pytest.raises(SupabaseAdminError):
        _client(handler).invite("a@example.com", None)


def test_get_supabase_admin_is_503_when_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "supabase_secret_key", None)

    with pytest.raises(HTTPException) as excinfo:
        get_supabase_admin()

    assert excinfo.value.status_code == 503
    assert excinfo.value.detail == "User management not configured"


def test_get_supabase_admin_builds_a_client_when_configured(monkeypatch):
    monkeypatch.setattr(settings, "supabase_secret_key", NEW_KEY)

    assert isinstance(get_supabase_admin(), SupabaseAdmin)
