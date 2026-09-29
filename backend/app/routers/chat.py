import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.agents.chat import run_chat
from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.config import settings
from app.models import ChatMessage
from app.rate_limit import rate_limiter
from app.schemas import ChatIn, ChatOut
from app.usage import check_monthly_usage

logger = logging.getLogger(__name__)

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
        Depends(rate_limiter("chat", limit=20)),
        Depends(check_monthly_usage("chat")),
    ],
)
async def chat(
    payload: ChatIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> ChatOut:
    if not settings.anthropic_api_key:
        raise HTTPException(status_code=503, detail="Chat not configured")

    history = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.user_id == user.id,
            ChatMessage.session_id == payload.session_id,
        )
        .order_by(ChatMessage.created_at)
        .all()
    )

    user_row = ChatMessage(
        user_id=user.id,
        session_id=payload.session_id,
        role="user",
        content=payload.message,
    )
    db.add(user_row)
    _commit_or_raise(db, "Failed to persist user chat message")

    reply = await run_chat(db, user.id, payload.session_id, payload.message, history=history)

    assistant_row = ChatMessage(
        user_id=user.id,
        session_id=payload.session_id,
        role="assistant",
        content=reply,
    )
    db.add(assistant_row)
    _commit_or_raise(db, "Failed to persist assistant chat message")

    return ChatOut(session_id=payload.session_id, message=reply)
