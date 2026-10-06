import logging
from unittest.mock import MagicMock, patch

import anthropic
import httpx
import pytest

from app.models import AppUser, UserApiKey
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user, auth_headers

KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"
OTHER_KEY = "sk-ant-api03-zyxwvutsrqponmlkjihgfedcba9876543210"


def _status_error(cls, status: int):
    request = httpx.Request("GET", "https://api.anthropic.com/v1/models")
    return cls("nope", response=httpx.Response(status, request=request), body=None)


@pytest.fixture()
def anthropic_ok():
    """Anthropic accepts every key; yields the constructor mock to show what it was given."""
    with patch("app.claude_keys.Anthropic") as constructor:
        constructor.return_value = MagicMock()
        yield constructor


def _put(client, key=KEY, **kwargs):
    return client.put("/me/claude-key", json={"api_key": key}, **kwargs)


def test_nothing_is_connected_at_first(client_no_key):
    response = client_no_key.get("/me/claude-key")

    assert response.status_code == 200
    assert response.json() == {"connected": False, "last4": None, "needs_attention": False}


def test_saving_a_key_stores_only_ciphertext_and_reports_the_last_four(
    client_no_key, db_session, anthropic_ok
):
    response = _put(client_no_key)

    assert response.status_code == 200
    assert response.json() == {"connected": True, "last4": KEY[-4:], "needs_attention": False}
    assert KEY not in response.text
    anthropic_ok.assert_called_once()
    assert anthropic_ok.call_args.kwargs["api_key"] == KEY
    row = db_session.query(UserApiKey).one()
    assert row.user_id == USER_ID
    assert KEY.encode() not in row.ciphertext
    assert row.last4 == KEY[-4:]
    assert row.status == "ok"
    assert db_session.get(AppUser, USER_ID).claude_key_state == "ok"


def test_the_key_is_checked_with_one_free_call_before_it_is_stored(client_no_key, anthropic_ok):
    _put(client_no_key)

    anthropic_ok.return_value.models.list.assert_called_once_with(limit=1)


def test_pasted_whitespace_around_the_key_is_stripped(client_no_key, db_session, anthropic_ok):
    response = _put(client_no_key, key=f"  {KEY}\n")

    assert response.status_code == 200
    assert anthropic_ok.call_args.kwargs["api_key"] == KEY


@pytest.mark.parametrize(
    "bad",
    ["", "hello", "sk-ant-short", "sk-ant-" + "a" * 400, "sk-ant-api03-abc def" + "x" * 30],
    ids=["empty", "no-prefix", "too-short", "too-long", "inner-space"],
)
def test_a_badly_shaped_key_is_rejected_without_echoing_it_or_calling_anthropic(
    client_no_key, db_session, anthropic_ok, bad
):
    response = _put(client_no_key, key=bad)

    assert response.status_code == 422
    if len(bad) > 8:
        assert bad not in response.text
    anthropic_ok.assert_not_called()
    assert db_session.query(UserApiKey).count() == 0


def test_a_key_anthropic_rejects_is_not_stored(client_no_key, db_session, anthropic_ok):
    anthropic_ok.return_value.models.list.side_effect = _status_error(
        anthropic.AuthenticationError, 401
    )

    response = _put(client_no_key)

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_key"
    assert KEY not in response.text
    assert db_session.query(UserApiKey).count() == 0
    assert db_session.get(AppUser, USER_ID).claude_key_state == "none"


def test_a_key_without_access_is_reported_calmly(client_no_key, db_session, anthropic_ok):
    anthropic_ok.return_value.models.list.side_effect = _status_error(
        anthropic.PermissionDeniedError, 403
    )

    response = _put(client_no_key)

    assert response.status_code == 422
    assert response.json()["code"] == "key_not_usable"
    assert db_session.query(UserApiKey).count() == 0


def test_anthropic_being_unreachable_is_a_502_and_stores_nothing(
    client_no_key, db_session, anthropic_ok
):
    anthropic_ok.return_value.models.list.side_effect = anthropic.APIConnectionError(
        request=httpx.Request("GET", "https://api.anthropic.com/v1/models")
    )

    response = _put(client_no_key)

    assert response.status_code == 502
    assert response.json()["code"] == "anthropic_unreachable"
    assert db_session.query(UserApiKey).count() == 0


def test_saving_again_replaces_the_key(client_no_key, db_session, anthropic_ok):
    _put(client_no_key)
    db_session.query(UserApiKey).update({"status": "needs_attention"})
    db_session.query(AppUser).update({"claude_key_state": "needs_attention"})
    db_session.commit()

    response = _put(client_no_key, key=OTHER_KEY)

    assert response.json() == {"connected": True, "last4": OTHER_KEY[-4:], "needs_attention": False}
    db_session.expire_all()
    assert db_session.query(UserApiKey).count() == 1
    assert db_session.query(UserApiKey).one().status == "ok"
    assert db_session.get(AppUser, USER_ID).claude_key_state == "ok"


def test_a_flagged_key_reports_needs_attention(client_no_key, db_session, anthropic_ok):
    _put(client_no_key)
    db_session.query(UserApiKey).update({"status": "needs_attention"})
    db_session.commit()

    response = client_no_key.get("/me/claude-key")

    assert response.json() == {"connected": True, "last4": KEY[-4:], "needs_attention": True}


def test_removing_the_key_deletes_it_and_is_safe_to_repeat(client_no_key, db_session, anthropic_ok):
    _put(client_no_key)

    assert client_no_key.delete("/me/claude-key").status_code == 204
    assert client_no_key.delete("/me/claude-key").status_code == 204

    assert db_session.query(UserApiKey).count() == 0
    db_session.expire_all()
    assert db_session.get(AppUser, USER_ID).claude_key_state == "none"
    assert client_no_key.get("/me/claude-key").json()["connected"] is False


def test_another_user_cannot_see_the_key(client_no_key, db_session, anthropic_ok):
    add_app_user(db_session, OTHER_USER_ID)
    _put(client_no_key)

    other = client_no_key.get("/me/claude-key", headers=auth_headers(OTHER_USER_ID))

    assert other.json() == {"connected": False, "last4": None, "needs_attention": False}


def test_another_user_deleting_does_not_touch_the_row(client_no_key, db_session, anthropic_ok):
    add_app_user(db_session, OTHER_USER_ID)
    _put(client_no_key)

    client_no_key.delete("/me/claude-key", headers=auth_headers(OTHER_USER_ID))

    assert db_session.query(UserApiKey).count() == 1


def test_saving_is_limited_to_ten_a_minute(client_no_key, anthropic_ok):
    for _ in range(10):
        assert _put(client_no_key, key="bad").status_code == 422

    assert _put(client_no_key, key="bad").status_code == 429


def test_the_routes_require_authentication(anon_client):
    assert anon_client.get("/me/claude-key").status_code == 401
    assert anon_client.put("/me/claude-key", json={"api_key": KEY}).status_code == 401
    assert anon_client.delete("/me/claude-key").status_code == 401


def test_the_key_never_appears_in_the_logs(client_no_key, anthropic_ok, caplog):
    caplog.set_level(logging.DEBUG)

    _put(client_no_key)
    anthropic_ok.return_value.models.list.side_effect = _status_error(
        anthropic.AuthenticationError, 401
    )
    _put(client_no_key, key=OTHER_KEY)
    client_no_key.delete("/me/claude-key")

    assert KEY not in caplog.text
    assert OTHER_KEY not in caplog.text
