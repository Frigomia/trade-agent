import hmac
import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import db as app_db
from app import telegram
from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.config import settings
from app.models import TelegramLink
from app.rate_limit import rate_limiter
from app.schemas import TelegramLinkOut, TelegramOut, TelegramSettingsIn

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/me/telegram", tags=["telegram"], dependencies=[Depends(get_current_user)]
)

NOT_SET_UP = "Telegram is not set up on this server."
LINK_LIMIT_PER_MINUTE = 10


def _configured() -> bool:
    return bool(settings.telegram_bot_token and settings.telegram_bot_username)


def _out(link: TelegramLink | None) -> TelegramOut:
    configured = _configured()
    username = settings.telegram_bot_username
    if link is None:
        return TelegramOut(configured=configured, linked=False, bot_username=username)
    return TelegramOut(
        configured=configured,
        linked=True,
        status=link.status,  # type: ignore[arg-type]  # the column holds "ok" or "blocked"
        digest_enabled=link.digest_enabled,
        moves_enabled=link.moves_enabled,
        move_threshold_pct=float(link.move_threshold_pct),  # a Numeric column gives a Decimal
        bot_username=username,
    )


def _load(db: Session, user: CurrentUser) -> TelegramLink | None:
    return db.query(TelegramLink).filter_by(user_id=user.id).one_or_none()


@router.get("", response_model=TelegramOut)
def get_telegram(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> TelegramOut:
    return _out(_load(db, user))


@router.post(
    "/link",
    response_model=TelegramLinkOut,
    dependencies=[Depends(rate_limiter("telegram_link", limit=LINK_LIMIT_PER_MINUTE))],
)
async def create_link(user: CurrentUser = Depends(get_current_user)) -> TelegramLinkOut:
    if not _configured():
        raise HTTPException(status_code=503, detail=NOT_SET_UP)
    code = await telegram.create_link_code(user.id)
    return TelegramLinkOut(
        url=f"https://t.me/{settings.telegram_bot_username}?start={code}",
        expires_in=telegram.LINK_CODE_SECONDS,
    )


@router.patch("", response_model=TelegramOut)
def update_telegram(
    payload: TelegramSettingsIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> TelegramOut:
    link = _load(db, user)
    if link is None:
        raise HTTPException(status_code=404, detail="Not connected")
    # Only the fields the caller sent; an explicit null is ignored too.
    for field, value in payload.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(link, field, value)
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise
    db.refresh(link)
    return _out(link)


def _delete(db: Session, link: TelegramLink) -> None:
    db.delete(link)
    db.commit()


@router.delete("", status_code=204)
async def delete_telegram(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> Response:
    link = await run_in_threadpool(_load, db, user)
    if link is not None:
        chat_id = link.chat_id
        try:
            await run_in_threadpool(_delete, db, link)
        except SQLAlchemyError:
            await run_in_threadpool(db.rollback)
            raise
        await telegram.forget_chat(chat_id)
    return Response(status_code=204)


CONNECTED = (
    "Connected. You will get a short message on weekday mornings when there is something to "
    "look at. Send /stop to disconnect."
)
EXPIRED = "That link has expired. Open Account in the app and press Connect Telegram again."
TAKEN = "This chat is already connected to another account."
BARE_START = "Open the app, go to Account and press Connect Telegram."
STOPPED = "Disconnected. You will not get any more messages."
NOT_CONNECTED = (
    "This chat is not connected. If you still get messages, disconnect in the app under Account."
)
UNKNOWN = "I only understand /start and /stop."

# Public: Telegram calls it, so there is no user login. The secret header is the only check.
webhook_router = APIRouter(tags=["telegram"])


def _secret_ok(received: str | None) -> bool:
    expected = settings.telegram_webhook_secret
    if not (expected and received):
        return False
    try:
        # Bytes, because compare_digest raises TypeError on non-ASCII str (headers are latin-1).
        return hmac.compare_digest(received.encode("utf-8"), expected.encode("utf-8"))
    except UnicodeError:
        return False


async def _reply(chat_id: int, text: str) -> None:
    bot = telegram.get_bot()
    if bot is None:
        return
    try:
        await bot.send_message(chat_id, text)
    except telegram.TelegramError as exc:
        logger.warning("Telegram reply failed (%s)", type(exc).__name__)


def _link_chat(user_id: uuid.UUID, chat_id: int) -> tuple[bool, int | None]:
    """(linked, previous chat id). Not linked when the chat belongs to another account."""
    previous: int | None = None
    with app_db.scoped_session(user_id) as db:
        link = db.query(TelegramLink).filter_by(user_id=user_id).one_or_none()
        if link is None:
            db.add(TelegramLink(user_id=user_id, chat_id=chat_id))
        else:
            previous = link.chat_id
            link.chat_id, link.status = chat_id, "ok"  # the settings are kept
        try:
            db.commit()
        except IntegrityError:
            # A user_id collision (two chats linking one user at once) is answered with TAKEN too;
            # accepted, it needs two live codes.
            db.rollback()
            return False, None
    return True, previous


def _unlink(user_id: uuid.UUID, chat_id: int) -> bool:
    """True when this chat's row was deleted; False when there is none (e.g. an old chat)."""
    with app_db.scoped_session(user_id) as db:
        deleted = db.query(TelegramLink).filter_by(user_id=user_id, chat_id=chat_id).delete()
        db.commit()
    return deleted > 0


async def _stop(chat_id: int) -> None:
    user_id = await telegram.user_for_chat(chat_id)
    # No row for this chat means a stale mapping: forget it, say not connected.
    if user_id is not None and await run_in_threadpool(_unlink, user_id, chat_id):
        await telegram.forget_chat(chat_id)
        await _reply(chat_id, STOPPED)
        return
    if user_id is not None:
        await telegram.forget_chat(chat_id)
    await _reply(chat_id, NOT_CONNECTED)


async def _dispatch(chat_id: int, text: str) -> None:
    command, _, argument = text.strip().partition(" ")
    command = command.split("@")[0]  # "/start@botname" in some clients
    code = argument.strip()
    if command == "/start" and code:
        user_id = await telegram.consume_link_code(code)
        if user_id is None:
            await _reply(chat_id, EXPIRED)
            return
        linked, previous = await run_in_threadpool(_link_chat, user_id, chat_id)
        if not linked:
            await _reply(chat_id, TAKEN)
            return
        if previous is not None and previous != chat_id:
            await telegram.forget_chat(previous)
        await telegram.remember_chat(chat_id, user_id)
        await _reply(chat_id, CONNECTED)
    elif command == "/start":
        await _reply(chat_id, BARE_START)
    elif command == "/stop":
        await _stop(chat_id)
    else:
        await _reply(chat_id, UNKNOWN)


@webhook_router.post("/telegram/webhook")
async def telegram_webhook(
    request: Request, x_telegram_bot_api_secret_token: str | None = Header(default=None)
) -> dict[str, bool]:
    if not _secret_ok(x_telegram_bot_api_secret_token):
        raise HTTPException(status_code=401, detail="Unauthorized")
    # Telegram retries on any non-2xx, so from here on the answer is always 200.
    try:
        update: Any = await request.json()
    except ValueError:
        return {"ok": True}
    message = update.get("message") if isinstance(update, dict) else None
    chat = message.get("chat") if isinstance(message, dict) else None
    text = message.get("text") if isinstance(message, dict) else None
    if not (isinstance(chat, dict) and chat.get("type") == "private" and isinstance(text, str)):
        return {"ok": True}
    chat_id = chat.get("id")
    if not isinstance(chat_id, int) or isinstance(chat_id, bool):
        return {"ok": True}
    try:
        await _dispatch(chat_id, text)
    except Exception as exc:  # noqa: BLE001  Telegram retries non-2xx; log the class only
        logger.warning("Telegram webhook failed (%s)", type(exc).__name__)
    return {"ok": True}
