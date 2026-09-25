import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.agents.chat import run_chat
from app.config import settings
from app.db import get_db
from app.models import ChatMessage
from app.schemas import ChatIn, ChatOut

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=ChatOut)
async def chat(payload: ChatIn, db: Session = Depends(get_db)) -> ChatOut:
    if not settings.anthropic_api_key:
        raise HTTPException(status_code=503, detail="Chat not configured")

    history = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.user_id == settings.default_user_id,
            ChatMessage.session_id == payload.session_id,
        )
        .order_by(ChatMessage.created_at)
        .all()
    )

    user_row = ChatMessage(
        user_id=settings.default_user_id,
        session_id=payload.session_id,
        role="user",
        content=payload.message,
    )
    db.add(user_row)
    try:
        db.commit()
    except Exception:
        logger.exception("Failed to persist user chat message")
        db.rollback()
        raise

    reply = await run_chat(db, payload.session_id, payload.message, history=history)

    assistant_row = ChatMessage(
        user_id=settings.default_user_id,
        session_id=payload.session_id,
        role="assistant",
        content=reply,
    )
    db.add(assistant_row)
    try:
        db.commit()
    except Exception:
        logger.exception("Failed to persist assistant chat message")
        db.rollback()
        raise

    return ChatOut(session_id=payload.session_id, message=reply)
