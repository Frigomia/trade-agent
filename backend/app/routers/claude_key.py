import logging
import re
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
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
# sk-ant- then 13-293 visible ASCII characters (no spaces): 20-300 in all.
KEY_SHAPE = re.compile(r"sk-ant-[!-~]{13,293}")
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
    if not KEY_SHAPE.fullmatch(api_key):
        raise claude_keys.ClaudeKeyRejected("bad_format", BAD_FORMAT)
    await claude_keys.verify_key(api_key)
    await run_in_threadpool(_store, db, user.id, api_key)
    logger.info("Claude key saved for user %s", user.id)
    return ClaudeKeyOut(connected=True, last4=api_key[-4:], needs_attention=False)


def _store(db: Session, user_id: uuid.UUID, api_key: str) -> None:
    blob = claude_keys.encrypt_key(user_id, api_key)
    values = {
        "ciphertext": blob,
        "key_version": claude_keys.KEY_VERSION,
        "last4": api_key[-4:],
        "status": "ok",
    }
    try:
        # One atomic statement: insert, or if the user's row already exists (even one created a
        # moment ago by a second save) overwrite it. Two racing first saves cannot collide.
        statement = pg_insert(UserApiKey).values(user_id=user_id, **values)
        db.execute(
            statement.on_conflict_do_update(
                index_elements=["user_id"], set_={**values, "updated_at": func.now()}
            )
        )
        db.query(AppUser).filter_by(id=user_id).update({"claude_key_state": "ok"})
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise


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
