import asyncio
import logging
import uuid
from unittest.mock import patch

import pytest

import app.redis_client as redis_client_module
from app import telegram
from app.models import TelegramLink
from app.redis_client import get_redis
from app.routers import telegram as telegram_routes
from app.routers.telegram import CONNECTED, EXPIRED, NOT_CONNECTED, STOPPED, TAKEN
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user

SECRET = "s3cret-value"
HEADERS = {"X-Telegram-Bot-Api-Secret-Token": SECRET}


def run(coro):
    # Each asyncio.run (and the TestClient's portal) has its own loop, so the cached Redis client
    # must be dropped before and after.
    redis_client_module._redis = None
    try:
        return asyncio.run(coro)
    finally:
        redis_client_module._redis = None


def redis_cmd(name, *args, **kwargs):
    async def go():
        return await getattr(get_redis(), name)(*args, **kwargs)

    return run(go())


def _update(text, chat_id=555, chat_type="private"):
    return {"update_id": 1, "message": {"chat": {"id": chat_id, "type": chat_type}, "text": text}}


class FakeBot:
    def __init__(self):
        self.sent = []

    async def send_message(self, chat_id, text):
        self.sent.append((chat_id, text))


@pytest.fixture()
def hook(anon_client, monkeypatch, app_session_local, db_session):
    add_app_user(db_session, USER_ID)
    add_app_user(db_session, OTHER_USER_ID)
    bot = FakeBot()
    monkeypatch.setattr(telegram_routes.settings, "telegram_webhook_secret", SECRET)
    monkeypatch.setattr(telegram_routes.telegram, "get_bot", lambda: bot)
    with patch("app.db.SessionLocal", app_session_local):
        yield anon_client, bot


def test_a_missing_or_wrong_secret_is_401(hook):
    client, bot = hook
    assert client.post("/telegram/webhook", json=_update("/start x")).status_code == 401
    bad = {"X-Telegram-Bot-Api-Secret-Token": "wrong"}
    assert (
        client.post("/telegram/webhook", json=_update("/start x"), headers=bad).status_code == 401
    )
    assert bot.sent == []


def test_an_unset_secret_rejects_everything(hook, monkeypatch):
    client, _ = hook
    monkeypatch.setattr(telegram_routes.settings, "telegram_webhook_secret", None)
    assert (
        client.post("/telegram/webhook", json=_update("/stop"), headers=HEADERS).status_code == 401
    )


def test_start_with_a_valid_code_links_the_chat(hook, db_session):
    client, bot = hook
    code = run(telegram.create_link_code(USER_ID))
    r = client.post(
        "/telegram/webhook", json=_update(f"/start {code}", chat_id=777), headers=HEADERS
    )
    assert r.status_code == 200 and r.json() == {"ok": True}
    link = db_session.query(TelegramLink).filter_by(user_id=USER_ID).one()
    assert (link.chat_id, link.status) == (777, "ok")
    assert bot.sent == [(777, CONNECTED)]
    assert run(telegram.user_for_chat(777)) == USER_ID


def test_a_code_works_only_once_and_an_unknown_one_not_at_all(hook, db_session):
    client, bot = hook
    code = run(telegram.create_link_code(USER_ID))
    client.post("/telegram/webhook", json=_update(f"/start {code}", chat_id=777), headers=HEADERS)
    client.post("/telegram/webhook", json=_update(f"/start {code}", chat_id=888), headers=HEADERS)
    client.post(
        "/telegram/webhook",
        json=_update("/start nope-nope-nope-nope-x", chat_id=999),
        headers=HEADERS,
    )
    assert db_session.query(TelegramLink).count() == 1
    assert [t for _, t in bot.sent[1:]] == [EXPIRED, EXPIRED]


def test_a_chat_already_linked_to_someone_else_is_refused_and_the_code_is_spent(hook, db_session):
    client, bot = hook
    db_session.add(TelegramLink(user_id=OTHER_USER_ID, chat_id=777))
    db_session.commit()
    code = run(telegram.create_link_code(USER_ID))
    client.post("/telegram/webhook", json=_update(f"/start {code}", chat_id=777), headers=HEADERS)
    assert bot.sent == [(777, TAKEN)]
    assert db_session.query(TelegramLink).filter_by(user_id=USER_ID).count() == 0
    assert run(telegram.consume_link_code(code)) is None


def test_start_again_from_a_new_chat_replaces_the_chat_and_clears_blocked(hook, db_session):
    client, bot = hook
    db_session.add(
        TelegramLink(user_id=USER_ID, chat_id=111, status="blocked", digest_enabled=False)
    )
    db_session.commit()
    code = run(telegram.create_link_code(USER_ID))
    client.post("/telegram/webhook", json=_update(f"/start {code}", chat_id=222), headers=HEADERS)
    db_session.expire_all()
    link = db_session.query(TelegramLink).filter_by(user_id=USER_ID).one()
    assert (link.chat_id, link.status, link.digest_enabled) == (222, "ok", False)  # settings kept


def test_stop_unlinks_a_known_chat_and_answers_politely_to_an_unknown_one(hook, db_session):
    client, bot = hook
    db_session.add(TelegramLink(user_id=USER_ID, chat_id=777))
    db_session.commit()
    run(telegram.remember_chat(777, USER_ID))
    client.post("/telegram/webhook", json=_update("/stop", chat_id=777), headers=HEADERS)
    assert db_session.query(TelegramLink).count() == 0
    client.post("/telegram/webhook", json=_update("/stop", chat_id=31337), headers=HEADERS)
    assert [t for _, t in bot.sent] == [STOPPED, NOT_CONNECTED]
    assert run(telegram.user_for_chat(777)) is None


def test_stop_with_a_stale_mapping_forgets_it_and_says_not_connected(hook, db_session):
    client, bot = hook
    run(telegram.remember_chat(777, USER_ID))  # no row behind it
    client.post("/telegram/webhook", json=_update("/stop", chat_id=777), headers=HEADERS)
    assert [t for _, t in bot.sent] == [NOT_CONNECTED]
    assert run(telegram.user_for_chat(777)) is None


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"update_id": 1},
        {"message": {"chat": {"id": 1, "type": "group"}, "text": "/start x"}},
        {"message": {"chat": {"id": 1, "type": "private"}}},
        {"edited_message": {}},
        ["not", "an", "object"],
    ],
)
def test_other_updates_are_acknowledged_and_ignored(hook, body):
    client, bot = hook
    assert client.post("/telegram/webhook", json=body, headers=HEADERS).status_code == 200
    assert bot.sent == []


def test_not_json_is_acknowledged_without_crashing(hook):
    client, _ = hook
    r = client.post(
        "/telegram/webhook", content=b"not json", headers={**HEADERS, "content-type": "text/plain"}
    )
    assert r.status_code == 200


def test_a_failing_reply_does_not_fail_the_webhook(hook):
    client, bot = hook

    async def boom(chat_id, text):
        raise telegram.TelegramError("x")

    bot.send_message = boom
    r = client.post("/telegram/webhook", json=_update("hello"), headers=HEADERS)
    assert r.status_code == 200


def test_a_non_ascii_secret_header_is_401_not_500(hook, caplog):
    client, bot = hook
    with caplog.at_level(logging.ERROR):
        r = client.post(
            "/telegram/webhook",
            content=b"{}",
            headers=[
                (b"x-telegram-bot-api-secret-token", b"\xe9"),
                (b"content-type", b"application/json"),
            ],
        )
    assert r.status_code == 401
    assert "ERROR" not in caplog.text and bot.sent == []


def test_stop_from_an_old_chat_keeps_the_current_link(hook, db_session):
    client, bot = hook
    for chat in (111, 222):
        code = run(telegram.create_link_code(USER_ID))
        client.post(
            "/telegram/webhook", json=_update(f"/start {code}", chat_id=chat), headers=HEADERS
        )
    assert run(telegram.user_for_chat(111)) is None  # forgotten at the relink
    run(telegram.remember_chat(111, USER_ID))  # a leftover mapping, as after a failed cleanup
    redis_cmd("delete", "telegram:reply:111")  # the reply limit would swallow the answer
    client.post("/telegram/webhook", json=_update("/stop", chat_id=111), headers=HEADERS)
    assert db_session.query(TelegramLink).filter_by(user_id=USER_ID).one().chat_id == 222
    assert bot.sent[-1] == (111, NOT_CONNECTED)
    assert run(telegram.user_for_chat(111)) is None
    assert run(telegram.user_for_chat(222)) == USER_ID


def test_a_redis_failure_is_acknowledged_and_logs_no_content(hook, monkeypatch, caplog):
    client, _ = hook
    code = run(telegram.create_link_code(USER_ID))

    async def boom(chat_id, user_id):
        raise RuntimeError(f"detail {code}")

    monkeypatch.setattr(telegram_routes.telegram, "remember_chat", boom)
    with caplog.at_level(logging.DEBUG):
        r = client.post(
            "/telegram/webhook", json=_update(f"/start {code}", chat_id=4242), headers=HEADERS
        )
    assert r.status_code == 200
    assert "RuntimeError" in caplog.text
    assert code not in caplog.text and "4242" not in caplog.text


def test_a_database_failure_is_acknowledged_and_logs_no_content(hook, monkeypatch, caplog):
    client, _ = hook
    code = run(telegram.create_link_code(USER_ID))

    def boom(user_id, chat_id):
        raise RuntimeError(f"detail {code}")

    monkeypatch.setattr(telegram_routes, "_link_chat", boom)
    with caplog.at_level(logging.DEBUG):
        r = client.post(
            "/telegram/webhook", json=_update(f"/start {code}", chat_id=4242), headers=HEADERS
        )
    assert r.status_code == 200
    assert "RuntimeError" in caplog.text
    assert code not in caplog.text and "4242" not in caplog.text


def test_the_webhook_never_logs_the_secret_the_code_the_chat_or_the_text(hook, caplog):
    client, bot = hook

    async def boom(chat_id, text):
        raise telegram.TelegramError("x")

    bot.send_message = boom  # so the reply-failed warning is in the log too
    code = run(telegram.create_link_code(USER_ID))
    with caplog.at_level(logging.DEBUG):
        client.post(
            "/telegram/webhook", json=_update(f"/start {code}", chat_id=4242), headers=HEADERS
        )
        client.post(
            "/telegram/webhook", json=_update("private words", chat_id=4242), headers=HEADERS
        )
    assert "Telegram reply failed" in caplog.text
    for sensitive in (SECRET, code, "4242", "private words"):
        assert sensitive not in caplog.text


def test_a_code_cannot_link_a_removed_a_disabled_or_an_invited_account(hook, db_session):
    client, bot = hook
    gone_id = uuid.uuid4()  # a user row that no longer exists
    disabled_id, invited_id = uuid.uuid4(), uuid.uuid4()
    add_app_user(db_session, disabled_id, status="disabled")
    add_app_user(db_session, invited_id, status="invited")
    for n, user_id in enumerate((gone_id, disabled_id, invited_id)):
        code = run(telegram.create_link_code(user_id))
        chat = 700 + n
        client.post(
            "/telegram/webhook", json=_update(f"/start {code}", chat_id=chat), headers=HEADERS
        )
        assert bot.sent[-1] == (chat, EXPIRED)
        assert run(telegram.user_for_chat(chat)) is None
    assert db_session.query(TelegramLink).count() == 0


def test_a_failing_cleanup_of_the_old_chat_still_connects_the_new_one(hook, db_session):
    client, bot = hook
    db_session.add(TelegramLink(user_id=USER_ID, chat_id=111))
    db_session.commit()
    run(telegram.remember_chat(111, USER_ID))
    code = run(telegram.create_link_code(USER_ID))

    async def broken_forget(chat_id):
        raise ConnectionError("redis down")

    with patch("app.telegram.forget_chat", broken_forget):
        client.post(
            "/telegram/webhook", json=_update(f"/start {code}", chat_id=222), headers=HEADERS
        )
    assert bot.sent == [(222, CONNECTED)]
    assert run(telegram.user_for_chat(222)) == USER_ID
    db_session.expire_all()
    assert db_session.query(TelegramLink).filter_by(user_id=USER_ID).one().chat_id == 222


def test_the_bot_answers_a_chat_at_most_once_every_two_seconds(hook):
    client, bot = hook
    for _ in range(3):
        client.post("/telegram/webhook", json=_update("hello", chat_id=500), headers=HEADERS)
    client.post("/telegram/webhook", json=_update("hello", chat_id=501), headers=HEADERS)
    assert [c for c, _ in bot.sent] == [500, 501]
    assert 0 < redis_cmd("ttl", "telegram:reply:500") <= 2


def test_a_link_code_still_links_when_the_reply_is_suppressed(hook, db_session):
    client, bot = hook
    redis_cmd("set", "telegram:reply:777", "1", ex=2)
    code = run(telegram.create_link_code(USER_ID))
    client.post("/telegram/webhook", json=_update(f"/start {code}", chat_id=777), headers=HEADERS)
    assert bot.sent == []
    assert db_session.query(TelegramLink).filter_by(user_id=USER_ID).one().chat_id == 777
    assert run(telegram.user_for_chat(777)) == USER_ID
