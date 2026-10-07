"""A small Telegram Bot API client, the one-time link codes and the chat-to-user mapping.

httpx puts the request URL in its exception text, and the URL contains the bot token, so nothing
from an httpx exception may travel: every failure becomes a TelegramError with fixed text raised
`from None`. Logs carry exception class names only.
"""

import argparse
import asyncio
import contextlib
import logging
import secrets
import sys
import uuid

import httpx

from app.config import settings
from app.redis_client import get_redis

logger = logging.getLogger(__name__)

# httpx logs "HTTP Request: POST <url>" at INFO after every response, and the URL carries the bot
# token. Jobs call logging.basicConfig(level=INFO), so keep these two quiet from import time.
for _noisy in ("httpx", "httpcore"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

REQUEST_TIMEOUT_SECONDS = 10.0
LINK_CODE_SECONDS = 600


class TelegramError(Exception):
    """A Bot API call failed. The message never carries the token, a URL or Telegram's reply."""


class TelegramBlocked(TelegramError):
    """The person blocked the bot, or the chat no longer exists: stop sending to it."""


class TelegramBot:
    def __init__(self, token: str, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._base = f"https://api.telegram.org/bot{token}"
        self._transport = transport

    async def _post(self, method: str, payload: dict[str, object]) -> None:
        failure: str | None = None
        try:
            async with httpx.AsyncClient(
                timeout=REQUEST_TIMEOUT_SECONDS, transport=self._transport
            ) as client:
                response = await client.post(f"{self._base}/{method}", json=payload)
        except (httpx.HTTPError, httpx.InvalidURL) as exc:
            failure = type(exc).__name__
        if failure is not None:
            # Raised outside the except block so the httpx exception is not left in __context__.
            logger.warning("Telegram %s failed: %s", method, failure)
            raise TelegramError("Could not reach Telegram")
        if response.is_success:
            return
        description = ""
        # A reply that is not JSON (or not an object) just leaves the description empty.
        with contextlib.suppress(ValueError, AttributeError):
            description = str(response.json().get("description", "")).lower()
        # "Blocked" only means something for a message to a chat, not for setWebhook etc.
        chat_gone = response.status_code == 403 or "chat not found" in description
        if method == "sendMessage" and chat_gone:
            raise TelegramBlocked("The chat cannot receive messages")
        raise TelegramError(f"Telegram answered HTTP {response.status_code}")

    async def send_message(self, chat_id: int, text: str) -> None:
        # Plain text: no parse_mode, so nothing in a message can be read as markup.
        await self._post(
            "sendMessage", {"chat_id": chat_id, "text": text, "disable_web_page_preview": True}
        )

    async def set_webhook(self, url: str, secret: str) -> None:
        await self._post(
            "setWebhook", {"url": url, "secret_token": secret, "allowed_updates": ["message"]}
        )


def get_bot() -> TelegramBot | None:
    token = settings.telegram_bot_token
    return TelegramBot(token) if token else None


async def create_link_code(user_id: uuid.UUID) -> str:
    code = secrets.token_urlsafe(16)  # 22 characters, 128 bits; also fits Telegram's /start payload
    await get_redis().set(f"telegram:link:{code}", str(user_id), ex=LINK_CODE_SECONDS)
    return code


async def consume_link_code(code: str) -> uuid.UUID | None:
    """Atomic get-and-delete, so a code links at most once."""
    value = await get_redis().getdel(f"telegram:link:{code}")
    try:
        return uuid.UUID(str(value)) if value else None
    except ValueError:
        return None


async def remember_chat(chat_id: int, user_id: uuid.UUID) -> None:
    await get_redis().set(f"telegram:chat:{chat_id}", str(user_id))


async def user_for_chat(chat_id: int) -> uuid.UUID | None:
    value = await get_redis().get(f"telegram:chat:{chat_id}")
    try:
        return uuid.UUID(str(value)) if value else None
    except ValueError:
        return None


async def forget_chat(chat_id: int) -> None:
    await get_redis().delete(f"telegram:chat:{chat_id}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.telegram")
    sub = parser.add_subparsers(dest="command", required=True)
    hook = sub.add_parser("set-webhook", help="register the webhook with Telegram")
    hook.add_argument("url", help="the public URL of POST /telegram/webhook")
    args = parser.parse_args(argv)
    bot, secret = get_bot(), settings.telegram_webhook_secret
    if bot is None or not secret:
        sys.stderr.write("TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must both be set\n")
        return 1
    try:
        asyncio.run(bot.set_webhook(args.url, secret))
    except TelegramError as exc:
        sys.stderr.write(f"set-webhook failed: {exc}\n")
        return 1
    sys.stdout.write("Webhook registered\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
