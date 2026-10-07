import asyncio
import contextlib
import logging
import uuid

import httpx
import pytest

from app import telegram
from app.redis_client import get_redis

TOKEN = "123456:SECRET-token-value"


def _bot(handler):
    return telegram.TelegramBot(TOKEN, transport=httpx.MockTransport(handler))


def test_send_message_posts_plain_text_to_the_bot_api():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["json"] = request.read().decode()
        return httpx.Response(200, json={"ok": True, "result": {}})

    asyncio.run(_bot(handler).send_message(42, "hello"))
    assert seen["url"] == f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    assert '"chat_id":42' in seen["json"].replace(" ", "") and "parse_mode" not in seen["json"]


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(
            403, json={"ok": False, "description": "Forbidden: bot was blocked by the user"}
        ),
        httpx.Response(400, json={"ok": False, "description": "Bad Request: chat not found"}),
    ],
)
def test_a_blocked_or_missing_chat_raises_telegram_blocked(response):
    with pytest.raises(telegram.TelegramBlocked):
        asyncio.run(_bot(lambda request: response).send_message(42, "hi"))


@pytest.mark.parametrize("status", [429, 500, 502])
def test_other_failures_raise_telegram_error_not_blocked(status):
    with pytest.raises(telegram.TelegramError) as caught:
        asyncio.run(_bot(lambda request: httpx.Response(status, json={})).send_message(42, "hi"))
    assert not isinstance(caught.value, telegram.TelegramBlocked)


UNCERTAIN = [httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout, httpx.ReadError]
UNCERTAIN += [httpx.WriteError, httpx.RemoteProtocolError]
CERTAIN = [httpx.ConnectError, httpx.ConnectTimeout]


@pytest.mark.parametrize("error", UNCERTAIN)
def test_a_failure_after_the_request_may_have_left_is_uncertain(error):
    def handler(request: httpx.Request) -> httpx.Response:
        raise error("boom " + str(request.url))

    with pytest.raises(telegram.TelegramUncertain):
        asyncio.run(_bot(handler).send_message(42, "hi"))


@pytest.mark.parametrize("error", CERTAIN)
def test_a_failure_before_anything_was_sent_is_a_plain_error(error):
    def handler(request: httpx.Request) -> httpx.Response:
        raise error("boom " + str(request.url))

    with pytest.raises(telegram.TelegramError) as caught:
        asyncio.run(_bot(handler).send_message(42, "hi"))
    assert not isinstance(caught.value, telegram.TelegramUncertain)


@pytest.mark.parametrize("error", [*UNCERTAIN, *CERTAIN])
def test_the_token_never_travels_in_an_error_even_when_httpx_raises(caplog, error):
    def handler(request: httpx.Request) -> httpx.Response:
        raise error("boom connecting to " + str(request.url))

    with caplog.at_level(logging.DEBUG), pytest.raises(telegram.TelegramError) as caught:
        asyncio.run(_bot(handler).send_message(42, "hi"))
    assert TOKEN not in str(caught.value) and TOKEN not in repr(caught.value)
    assert TOKEN not in caplog.text
    assert caught.value.__cause__ is None and caught.value.__context__ is None


def test_get_bot_is_none_without_a_token(monkeypatch):
    monkeypatch.setattr(telegram.settings, "telegram_bot_token", None)
    assert telegram.get_bot() is None
    monkeypatch.setattr(telegram.settings, "telegram_bot_token", TOKEN)
    assert telegram.get_bot() is not None


def _run(coro):
    # Each asyncio.run is its own event loop and the cached Redis client is bound to one.
    import app.redis_client as redis_client_module

    try:
        return asyncio.run(coro)
    finally:
        redis_client_module._redis = None


def test_a_link_code_works_once_and_expires():
    user_id = uuid.uuid4()
    code = _run(telegram.create_link_code(user_id))
    assert len(code) == 22
    assert _run(get_redis().ttl(f"telegram:link:{code}")) in range(
        1, telegram.LINK_CODE_SECONDS + 1
    )
    assert _run(telegram.consume_link_code(code)) == user_id
    assert _run(telegram.consume_link_code(code)) is None  # used once
    assert _run(telegram.consume_link_code("nope-not-a-code-xx")) is None


def test_chat_mapping_round_trip():
    user_id = uuid.uuid4()
    _run(telegram.remember_chat(555, user_id))
    assert _run(telegram.user_for_chat(555)) == user_id
    _run(telegram.forget_chat(555))
    assert _run(telegram.user_for_chat(555)) is None


@pytest.mark.parametrize("status", [200, 500, 403])
@pytest.mark.parametrize("httpx_level", [logging.NOTSET, logging.INFO, logging.DEBUG])
def test_the_token_is_not_logged_on_any_response(caplog, status, httpx_level):
    # Start from a logger level that would let httpx log the URL, then apply the module's setting.
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(httpx_level)
    telegram._quiet_http_loggers()
    handler = lambda request: httpx.Response(status, json={"ok": status == 200})  # noqa: E731
    bot = telegram.TelegramBot(TOKEN, transport=httpx.MockTransport(handler))
    with caplog.at_level(logging.DEBUG), contextlib.suppress(telegram.TelegramError):
        asyncio.run(bot.send_message(42, "hi"))
    assert TOKEN not in caplog.text


def test_a_403_only_means_blocked_for_send_message():
    bot = _bot(lambda request: httpx.Response(403, json={"description": "Forbidden"}))
    with pytest.raises(telegram.TelegramError) as caught:
        asyncio.run(bot.set_webhook("https://example.com/hook", "s"))
    assert not isinstance(caught.value, telegram.TelegramBlocked)
    bot = _bot(lambda request: httpx.Response(400, json={"description": "chat not found"}))
    with pytest.raises(telegram.TelegramError) as caught:
        asyncio.run(bot.set_webhook("https://example.com/hook", "s"))
    assert not isinstance(caught.value, telegram.TelegramBlocked)


def test_an_invalid_url_is_a_telegram_error_without_the_token():
    bad = "1\x002:TOKEN"  # a control character makes httpx raise InvalidURL
    with pytest.raises(telegram.TelegramError) as caught:
        asyncio.run(telegram.TelegramBot(bad).send_message(42, "hi"))
    assert "TOKEN" not in str(caught.value) and caught.value.__context__ is None


@pytest.mark.parametrize("body", [b"<html>nope</html>", b'["a", "list"]'])
def test_an_unparseable_error_reply_is_a_plain_telegram_error(body):
    bot = _bot(lambda request: httpx.Response(502, content=body))
    with pytest.raises(telegram.TelegramError) as caught:
        asyncio.run(bot.send_message(42, "hi"))
    assert not isinstance(caught.value, telegram.TelegramBlocked)
    assert str(caught.value) == "Telegram answered HTTP 502"


def test_cli_without_settings_exits_1(monkeypatch, capsys):
    monkeypatch.setattr(telegram.settings, "telegram_bot_token", None)
    monkeypatch.setattr(telegram.settings, "telegram_webhook_secret", None)
    assert telegram.main(["set-webhook", "https://example.com/hook"]) == 1
    assert "must both be set" in capsys.readouterr().err


def test_cli_failure_exits_1_and_prints_no_secret(monkeypatch, capsys):
    monkeypatch.setattr(telegram.settings, "telegram_bot_token", TOKEN)
    monkeypatch.setattr(telegram.settings, "telegram_webhook_secret", "the-webhook-secret")
    monkeypatch.setattr(
        telegram,
        "get_bot",
        lambda: _bot(lambda request: httpx.Response(401, json={"description": "Unauthorized"})),
    )
    assert telegram.main(["set-webhook", "https://example.com/hook"]) == 1
    out = capsys.readouterr()
    assert "set-webhook failed" in out.err
    for text in (out.out, out.err):
        assert TOKEN not in text and "the-webhook-secret" not in text


def test_cli_success_prints_no_secret(monkeypatch, capsys):
    monkeypatch.setattr(telegram.settings, "telegram_bot_token", TOKEN)
    monkeypatch.setattr(telegram.settings, "telegram_webhook_secret", "the-webhook-secret")
    monkeypatch.setattr(
        telegram, "get_bot", lambda: _bot(lambda request: httpx.Response(200, json={"ok": True}))
    )
    assert telegram.main(["set-webhook", "https://example.com/hook"]) == 0
    out = capsys.readouterr()
    assert "Webhook registered" in out.out
    for text in (out.out, out.err):
        assert TOKEN not in text and "the-webhook-secret" not in text
