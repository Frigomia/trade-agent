import json
import logging
import re
import uuid

from sqlalchemy.orm import Session

from app.memory.embeddings import embed_text
from app.memory.similarity import find_similar
from app.models import ChatMessage, InvestmentPreferences

logger = logging.getLogger(__name__)

CHAT_HISTORY_LIMIT = 5
CHAT_MESSAGE_DISPLAY_LIMIT = 500
SIMILAR_RECOMMENDATIONS_LIMIT = 3


def _quote(text: str) -> str:
    """User-written text as one JSON-quoted line, so it can carry no newline and therefore cannot
    fake a `## ...` section heading (or any other line-structured instruction) in the prompt."""
    return json.dumps(text, ensure_ascii=False)


def _build_preferences_section(db: Session, user_id: uuid.UUID) -> str:
    try:
        pref = db.query(InvestmentPreferences).filter_by(user_id=user_id).one_or_none()
        if pref is None:
            return "No stated investment preferences."

        parts = []
        if pref.risk_tolerance:
            parts.append(f"Risk tolerance: {pref.risk_tolerance}")
        if pref.sector_avoid_list:
            avoid = ", ".join(_quote(sector) for sector in pref.sector_avoid_list)
            parts.append(f"Avoid sectors: {avoid}")
        if pref.notes:
            parts.append(f"Notes: {_quote(pref.notes)}")
        return "\n".join(parts) if parts else "No stated investment preferences."
    except Exception:
        logger.exception("Investment preferences lookup failed")
        return "Preferences unavailable."


async def _build_memory_section(
    db: Session, user_id: uuid.UUID, ticker: str, asset_type: str, action: str, reasoning: list[str]
) -> str:
    situation = f"{ticker} ({asset_type}): {action}. {'; '.join(reasoning)}."
    try:
        embedding = await embed_text(situation)
        similar = find_similar(db, user_id, embedding, top_k=SIMILAR_RECOMMENDATIONS_LIMIT)
    except Exception:
        logger.exception("Long-term memory lookup failed for %s", ticker)
        similar = []

    if not similar:
        return "No similar past recommendations found."

    lines = []
    for rec in similar:
        rec_reasoning = "; ".join(rec.reasoning)
        line = f"- {rec.ticker}: {rec.action}. {rec_reasoning}"
        if rec.outcome_forward_return_pct is not None:
            line += f" (outcome: {float(rec.outcome_forward_return_pct):+.2%})"
        lines.append(line)
    return "\n".join(lines)


def _build_session_memory_section(db: Session, user_id: uuid.UUID, ticker: str) -> str:
    try:
        # Only the user's own words are first-party; assistant replies can carry
        # unlabeled web-derived text (the chat agent has web_search) and would be
        # pasted into news_agent's prompt with no untrusted-data framing.
        # The regex requires a non-alphanumeric boundary (or string start/end) on
        # both sides so short tickers like "V" don't match inside "value"/"have";
        # "." is excluded from the boundary class so "BRK.B" still matches as a
        # whole unit against surrounding text.
        ticker_pattern = rf"(^|[^A-Za-z0-9.]){re.escape(ticker)}($|[^A-Za-z0-9])"
        messages = (
            db.query(ChatMessage)
            .filter(
                ChatMessage.user_id == user_id,
                ChatMessage.role == "user",
                ChatMessage.content.op("~*")(ticker_pattern),
            )
            .order_by(ChatMessage.created_at.desc())
            .limit(CHAT_HISTORY_LIMIT)
            .all()
        )
        if not messages:
            return "No relevant chat history."

        lines = [f"- {m.role}: {_quote(m.content[:CHAT_MESSAGE_DISPLAY_LIMIT])}" for m in messages]
        return "\n".join(lines)
    except Exception:
        logger.exception("Session memory lookup failed for %s", ticker)
        return "Chat history unavailable."


async def build_context(
    db: Session,
    user_id: uuid.UUID,
    ticker: str,
    asset_type: str,
    action: str,
    reasoning: list[str],
) -> str:
    preferences_text = _build_preferences_section(db, user_id)
    memory_text = await _build_memory_section(db, user_id, ticker, asset_type, action, reasoning)
    session_text = _build_session_memory_section(db, user_id, ticker)

    return (
        f"## Investment preferences\n{preferences_text}\n\n"
        f"## Similar past recommendations\n{memory_text}\n\n"
        f"## Relevant chat history\n{session_text}"
    )
