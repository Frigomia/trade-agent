import logging
import uuid

import anthropic
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import claude_keys
from app.agents.chat import run_chat
from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.claude_keys import require_claude_key
from app.config import settings
from app.models import ChatMessage
from app.rate_limit import rate_limiter
from app.schemas import ChatIn, ChatMessageOut, ChatOut
from app.usage import check_monthly_usage

logger = logging.getLogger(__name__)

DEFAULT_SESSION = "main"  # the one ongoing conversation the Chat screen shows
HISTORY_SHOWN = 50
HISTORY_SENT_TO_CLAUDE = 20


def _recent_messages(
    db: Session, user_id: uuid.UUID, session_id: str, limit: int
) -> list[ChatMessage]:
    """The newest `limit` messages of the session, returned oldest first."""
    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.user_id == user_id, ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(limit)
        .all()
    )
    rows.reverse()
    return rows


router = APIRouter(tags=["chat"], dependencies=[Depends(get_current_user)])


def _commit_or_raise(db: Session, log_message: str) -> None:
    try:
        db.commit()
    except Exception:
        logger.exception(log_message)
        db.rollback()
        raise


@router.post(
    "/chat",
    response_model=ChatOut,
    dependencies=[
        Depends(require_claude_key),
        Depends(rate_limiter("chat", limit=20)),
        Depends(check_monthly_usage("chat")),
    ],
)
async def chat(
    payload: ChatIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> ChatOut:
    client = await run_in_threadpool(claude_keys.resolve_client, db, user.id, user.role)
    if client is None and not settings.anthropic_api_key:
        raise HTTPException(status_code=503, detail="Chat not configured")

    # The database work is synchronous, so each step runs in a worker thread to keep the event
    # loop free. The same session is used one step at a time, never concurrently.
    history = await run_in_threadpool(_prepare_chat, db, user.id, payload)
    try:
        reply = await run_chat(
            db, user.id, payload.session_id, payload.message, history=history, client=client
        )
    except anthropic.APIStatusError as exc:
        if client is not None and claude_keys.is_key_problem(exc):
            await run_in_threadpool(claude_keys.mark_needs_attention, user.id)
            raise claude_keys.ClaudeKeyRequired(needs_attention=True) from None
        raise
    await run_in_threadpool(_save_reply, db, user.id, payload.session_id, reply)
    return ChatOut(session_id=payload.session_id, message=reply)


def _prepare_chat(db: Session, user_id: uuid.UUID, payload: ChatIn) -> list[ChatMessage]:
    """Load the history to send, then store the user's message. Returns the history."""
    history = _recent_messages(db, user_id, payload.session_id, HISTORY_SENT_TO_CLAUDE)
    # a failed reply leaves an odd number of rows, so the window can start with an assistant row
    while history and history[0].role == "assistant":
        history.pop(0)

    user_row = ChatMessage(
        user_id=user_id,
        session_id=payload.session_id,
        role="user",
        content=payload.message,
    )
    db.add(user_row)
    _commit_or_raise(db, "Failed to persist user chat message")
    return history


def _save_reply(db: Session, user_id: uuid.UUID, session_id: str, reply: str) -> None:
    db.add(ChatMessage(user_id=user_id, session_id=session_id, role="assistant", content=reply))
    _commit_or_raise(db, "Failed to persist assistant chat message")


@router.get("/chat/messages", response_model=list[ChatMessageOut])
def list_messages(
    session_id: str = Query(DEFAULT_SESSION, max_length=100),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> list[ChatMessage]:
    return _recent_messages(db, user.id, session_id, HISTORY_SHOWN)


@router.delete("/chat/messages", status_code=204)
def clear_messages(
    session_id: str = Query(DEFAULT_SESSION, max_length=100),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> Response:
    db.query(ChatMessage).filter(
        ChatMessage.user_id == user.id, ChatMessage.session_id == session_id
    ).delete()
    _commit_or_raise(db, "Failed to clear chat messages")
    return Response(status_code=204)
