import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import claude_keys
from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.models import AppUser, UserApiKey
from app.rate_limit import rate_limiter

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/me/claude-key", tags=["claude-key"], dependencies=[Depends(get_current_user)]
)

SAVE_LIMIT_PER_MINUTE = 10  # the save route must not become a way to test stolen keys
KEY_PREFIX = "sk-ant-"
KEY_MIN_LENGTH = 20
KEY_MAX_LENGTH = 300
BAD_FORMAT = (
    "That does not look like an Anthropic API key. It starts with sk-ant- and has no spaces."
)


class ClaudeKeyIn(BaseModel):
    # No length or pattern constraints here: a failed pydantic check echoes the input in the 422
    # body, and this input is a secret. The shape is checked by hand below.
    api_key: str


class ClaudeKeyOut(BaseModel):
    connected: bool
    last4: str | None
    needs_attention: bool


def _out(row: UserApiKey | None) -> ClaudeKeyOut:
    if row is None:
        return ClaudeKeyOut(connected=False, last4=None, needs_attention=False)
    return ClaudeKeyOut(
        connected=True, last4=row.last4, needs_attention=row.status == "needs_attention"
    )


@router.get("", response_model=ClaudeKeyOut)
def get_key(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> ClaudeKeyOut:
    return _out(db.query(UserApiKey).filter_by(user_id=user.id).one_or_none())


@router.put(
    "",
    response_model=ClaudeKeyOut,
    dependencies=[Depends(rate_limiter("claude_key_save", limit=SAVE_LIMIT_PER_MINUTE))],
)
async def save_key(
    payload: ClaudeKeyIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> ClaudeKeyOut:
    api_key = payload.api_key.strip()
    well_formed = (
        KEY_MIN_LENGTH <= len(api_key) <= KEY_MAX_LENGTH
        and api_key.startswith(KEY_PREFIX)
        and api_key.isascii()
        and api_key.isprintable()
        and " " not in api_key
    )
    if not well_formed:
        raise HTTPException(status_code=422, detail={"message": BAD_FORMAT, "code": "bad_format"})
    try:
        await claude_keys.verify_key(api_key)
    except claude_keys.ClaudeKeyRejected as rejected:
        raise HTTPException(
            status_code=rejected.http_status,
            detail={"message": rejected.message, "code": rejected.code},
        ) from None
    row = await run_in_threadpool(_store, db, user.id, api_key)
    logger.info("Claude key saved for user %s", user.id)
    return _out(row)


def _store(db: Session, user_id: uuid.UUID, api_key: str) -> UserApiKey:
    blob = claude_keys.encrypt_key(user_id, api_key)
    row = db.query(UserApiKey).filter_by(user_id=user_id).one_or_none()
    if row is None:
        row = UserApiKey(user_id=user_id, ciphertext=blob, key_version=claude_keys.KEY_VERSION)
        db.add(row)
    row.ciphertext = blob
    row.key_version = claude_keys.KEY_VERSION
    row.last4 = api_key[-4:]
    row.status = "ok"
    try:
        db.query(AppUser).filter_by(id=user_id).update({"claude_key_state": "ok"})
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise
    db.refresh(row)
    return row


@router.delete("", status_code=204)
def delete_key(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> None:
    try:
        db.query(UserApiKey).filter_by(user_id=user.id).delete()
        db.query(AppUser).filter_by(id=user.id).update({"claude_key_state": "none"})
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise
    logger.info("Claude key removed for user %s", user.id)
