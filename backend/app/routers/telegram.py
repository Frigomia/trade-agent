import logging

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

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
