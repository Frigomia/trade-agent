"""The morning Telegram message: new automatic recommendations plus tickers that moved a lot.

Each message is built inside the person's own scoped session and contains only tickers, actions and
percentages. A per-person per-day marker keeps a re-run from sending a second message.
"""

import asyncio
import logging
import uuid
from datetime import datetime

from app import db as app_db
from app.agents.jobs import default_ticker_infos
from app.agents.market_data import fetch_quote_and_history
from app.config import settings
from app.models import AppUser, Recommendation, TelegramLink
from app.redis_client import get_redis
from app.telegram import TelegramBlocked, TelegramBot, TelegramError

logger = logging.getLogger(__name__)

MAX_LISTED = 10
MARKER_SECONDS = 90000  # outlives the UTC day so a late retry cannot send twice
QUOTE_CONCURRENCY = 5
FOOTER = "Advisory only. Nothing is sent to a broker."


def _listed(items: list[str]) -> str:
    shown = ", ".join(items[:MAX_LISTED])
    return shown + (f", +{len(items) - MAX_LISTED} more" if len(items) > MAX_LISTED else "")


def build_message(
    new_recs: list[tuple[str, str]], moves: list[tuple[str, float]], app_url: str | None
) -> str | None:
    lines: list[str] = []
    if new_recs:
        lines.append(f"{len(new_recs)} new: {_listed([f'{t} {a}' for t, a in new_recs])}")
    if moves:
        ordered = sorted(moves, key=lambda m: abs(m[1]), reverse=True)
        lines.append("Moved: " + _listed([f"{t} {c:+.1f}%" for t, c in ordered]))
    if not lines:
        return None
    if app_url:
        lines.append(f"Open Today: {app_url.rstrip('/')}/today")
    lines.append(FOOTER)
    return "\n".join(lines)


async def _moves(tickers: list[str], threshold: float) -> list[tuple[str, float]]:
    semaphore = asyncio.Semaphore(QUOTE_CONCURRENCY)

    async def one(ticker: str) -> tuple[str, float] | None:
        async with semaphore:
            try:
                closes = (await fetch_quote_and_history(ticker)).get("closes") or []
            except Exception as exc:  # a failing lookup only drops that ticker from the message
                logger.warning("Notify: quote failed for %s (%s)", ticker, type(exc).__name__)
                return None
        if len(closes) < 2 or not closes[-2]:
            return None
        change = (closes[-1] - closes[-2]) / closes[-2] * 100
        return (ticker, change) if abs(change) >= threshold else None

    # dict.fromkeys drops duplicate tickers but keeps the order
    found = await asyncio.gather(*(one(t) for t in dict.fromkeys(tickers)))
    return [m for m in found if m is not None]


async def notify_user(user_id: uuid.UUID, now: datetime, bot: TelegramBot) -> str:
    """ "sent" | "skipped" | "blocked" | "failed". The chat id and the message exist only here."""
    today = datetime(now.year, now.month, now.day)  # naive UTC, like created_at
    with app_db.scoped_session(user_id) as db:
        link = db.query(TelegramLink).filter_by(user_id=user_id).one_or_none()
        user = db.get(AppUser, user_id)
        if link is None or link.status != "ok" or user is None or user.status != "active":
            return "skipped"
        chat_id, digest, moves_on = link.chat_id, link.digest_enabled, link.moves_enabled
        threshold = float(link.move_threshold_pct)
        new_recs: list[tuple[str, str]] = []
        if digest:
            rows = (
                db.query(Recommendation.ticker, Recommendation.action)
                .filter(
                    Recommendation.user_id == user_id,
                    Recommendation.source == "scheduled",
                    Recommendation.status == "PENDING",
                    Recommendation.created_at >= today,
                )
                .order_by(Recommendation.id)
                .all()
            )
            new_recs = [(t, a) for t, a in rows]
        tickers = (
            [i["ticker"] for i in default_ticker_infos(db, user_id, open_only=True)]
            if moves_on
            else []
        )
    moved = await _moves(tickers, threshold) if tickers else []
    text = build_message(new_recs, moved, settings.app_url)
    if text is None:
        return "skipped"
    marker = f"telegram:sent:{user_id}:{now.strftime('%Y-%m-%d')}"
    redis = get_redis()
    if not await redis.set(marker, "1", nx=True, ex=MARKER_SECONDS):
        return "skipped"
    try:
        await bot.send_message(chat_id, text)
    except TelegramBlocked:
        await redis.delete(marker)
        with app_db.scoped_session(user_id) as db:
            db.query(TelegramLink).filter_by(user_id=user_id).update({"status": "blocked"})
            db.commit()
        return "blocked"
    except TelegramError:
        await redis.delete(marker)  # nothing was delivered, so a retry may still send
        return "failed"
    return "sent"
