import asyncio

import pytest

import app.redis_client as redis_client_module
from app import telegram
from app.models import TelegramLink
from tests.auth_support import OTHER_USER_ID, USER_ID


@pytest.fixture()
def configured(monkeypatch):
    monkeypatch.setattr(telegram.settings, "telegram_bot_token", "123:abc")
    monkeypatch.setattr(telegram.settings, "telegram_bot_username", "trade_agent_bot")


def _link(db_session, user_id=USER_ID, chat_id=1001, **kwargs):
    db_session.add(TelegramLink(user_id=user_id, chat_id=chat_id, **kwargs))
    db_session.commit()


def test_not_linked_shows_the_defaults(client, configured):
    body = client.get("/me/telegram").json()
    assert body == {
        "configured": True,
        "linked": False,
        "status": None,
        "digest_enabled": True,
        "moves_enabled": True,
        "move_threshold_pct": 5.0,
        "bot_username": "trade_agent_bot",
    }


def test_without_a_token_the_routes_say_so_plainly(client, monkeypatch):
    monkeypatch.setattr(telegram.settings, "telegram_bot_token", None)
    assert client.get("/me/telegram").json()["configured"] is False
    response = client.post("/me/telegram/link")
    assert response.status_code == 503
    assert response.json()["detail"] == "Telegram is not set up on this server."


def test_link_returns_a_t_me_url_with_a_one_time_code(client, configured):
    body = client.post("/me/telegram/link").json()
    assert body["expires_in"] == telegram.LINK_CODE_SECONDS
    prefix = "https://t.me/trade_agent_bot?start="
    assert body["url"].startswith(prefix) and len(body["url"]) == len(prefix) + 22


def test_link_creation_is_rate_limited(client, configured):
    statuses = [client.post("/me/telegram/link").status_code for _ in range(11)]
    assert statuses[:10] == [200] * 10 and statuses[10] == 429


def test_patch_changes_only_the_fields_sent(client, configured, db_session):
    _link(db_session)
    body = client.patch("/me/telegram", json={"move_threshold_pct": 7.5}).json()
    assert (body["linked"], body["digest_enabled"], body["moves_enabled"]) == (True, True, True)
    assert body["move_threshold_pct"] == 7.5
    body = client.patch("/me/telegram", json={"digest_enabled": False}).json()
    assert body["digest_enabled"] is False and body["move_threshold_pct"] == 7.5


@pytest.mark.parametrize("value", [0, 0.9, 50.1, 100, -5])
def test_the_threshold_must_be_between_1_and_50(client, configured, db_session, value):
    _link(db_session)
    assert client.patch("/me/telegram", json={"move_threshold_pct": value}).status_code == 422


def test_patch_without_a_link_is_404(client, configured):
    assert client.patch("/me/telegram", json={"digest_enabled": False}).status_code == 404


def test_delete_unlinks_and_is_idempotent(client, configured, db_session):
    _link(db_session)
    assert client.delete("/me/telegram").status_code == 204
    assert client.delete("/me/telegram").status_code == 204
    assert client.get("/me/telegram").json()["linked"] is False


def test_another_users_link_is_invisible(client, configured, db_session):
    _link(db_session, user_id=OTHER_USER_ID, chat_id=2002)
    body = client.get("/me/telegram").json()
    assert body["linked"] is False
    assert client.delete("/me/telegram").status_code == 204
    assert db_session.query(TelegramLink).filter_by(user_id=OTHER_USER_ID).count() == 1


def test_the_response_never_contains_the_chat_id(client, configured, db_session):
    _link(db_session, chat_id=987654321)
    assert "987654321" not in client.get("/me/telegram").text


def test_the_routes_require_authentication(anon_client):
    assert anon_client.get("/me/telegram").status_code == 401
    assert anon_client.post("/me/telegram/link").status_code == 401


def test_delete_forgets_the_chat_mapping(client, configured, db_session):
    _link(db_session, chat_id=5005)
    asyncio.run(telegram.remember_chat(5005, USER_ID))
    redis_client_module._redis = None  # asyncio.run closed the loop the singleton was bound to

    assert client.delete("/me/telegram").status_code == 204

    redis_client_module._redis = None  # the request made a new one on the client's own loop
    assert asyncio.run(telegram.user_for_chat(5005)) is None
    redis_client_module._redis = None


def test_a_linked_user_without_a_bot_username_can_still_see_and_remove_the_link(
    client, db_session, monkeypatch
):
    monkeypatch.setattr(telegram.settings, "telegram_bot_token", "123:abc")
    monkeypatch.setattr(telegram.settings, "telegram_bot_username", None)
    _link(db_session)
    body = client.get("/me/telegram").json()
    assert (body["linked"], body["configured"]) == (True, False)
    assert client.delete("/me/telegram").status_code == 204
    assert client.get("/me/telegram").json()["linked"] is False
