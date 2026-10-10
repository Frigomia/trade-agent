"""The morning Telegram message: new automatic recommendations plus tickers that moved a lot.

Each message is built inside the person's own scoped session and contains only tickers, actions and
percentages. A per-person per-day marker keeps a re-run from sending a second message.
"""

import asyncio
import logging
import uuid
from datetime import date, datetime

from app import db as app_db
from app.agents.jobs import default_ticker_infos
from app.agents.market_data import fetch_quote_and_history
from app.config import settings
from app.models import AppUser, Holding, Recommendation, TelegramLink, WatchlistItem
from app.redis_client import get_redis
from app.telegram import TelegramBlocked, TelegramBot, TelegramError, TelegramUncertain

logger = logging.getLogger(__name__)

MAX_LISTED = 10
MARKER_SECONDS = 90000  # outlives the UTC day so a late retry cannot send twice
QUOTE_CONCURRENCY = 5
FOOTER = "Advisory only. Nothing is sent to a broker."


def _bullets(items: list[str]) -> list[str]:
    shown = [f"• {item}" for item in items[:MAX_LISTED]]
    return shown + ([f"• +{len(items) - MAX_LISTED} more"] if len(items) > MAX_LISTED else [])


def is_first_weekday(day: date) -> bool:
    """The first Monday-to-Friday day of its month: the 1st, or the Monday of the 2nd or 3rd when
    the month starts on a weekend."""
    return day.weekday() < 5 and (day.day == 1 or (day.weekday() == 0 and day.day <= 3))


def build_message(
    new_recs: list[tuple[str, str]],
    moves: list[tuple[str, float]],
    app_url: str | None,
    reminder: bool = False,
) -> str | None:
    """Plain text, one item per line, sections separated by a blank line. No markup, so nothing in
    it can be read as formatting."""
    sections: list[list[str]] = []
    if new_recs:
        noun = "recommendation" if len(new_recs) == 1 else "recommendations"
        sections.append(
            [f"📋 {len(new_recs)} new {noun}"] + _bullets([f"{t}  {a}" for t, a in new_recs])
        )
    if moves:
        ordered = sorted(moves, key=lambda m: abs(m[1]), reverse=True)
        sections.append(
            ["📈 Moved"]
            + _bullets([f"{t}  {'▲' if c >= 0 else '▼'} {abs(c):.1f}%" for t, c in ordered])
        )
    if reminder:  # no amounts or tickers: just a nudge
        where = "" if app_url else " in the app"
        sections.append([f"🗓 Time to plan this month's contribution{where}."])
    if not sections:
        return None
    if app_url:
        base = app_url.rstrip("/")
        links = [f"Today:  {base}/today"]
        if reminder:
            links.append(f"Plan:   {base}/portfolio/plan")
        sections.append(links)
    sections.append([FOOTER])
    return "\n\n".join("\n".join(section) for section in sections)


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
        # rounded so a move of exactly the threshold is not lost to float error
        return (ticker, change) if round(abs(change), 6) >= threshold else None

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
        tickers: list[str] = []
        if moves_on:
            tickers = [i["ticker"] for i in default_ticker_infos(db, user_id, open_only=True)]
        remind = False
        if link.plan_reminder_enabled and is_first_weekday(now.date()):
            # only worth a nudge when some holding or watchlist item has a target weight
            for model in (Holding, WatchlistItem):
                has_target = (
                    db.query(model.id)
                    .filter(
                        model.user_id == user_id,
                        model.target_weight.isnot(None),
                        model.target_weight > 0,
                    )
                    .first()
                )
                remind = remind or has_target is not None
    moved = await _moves(tickers, threshold) if tickers else []
    text = build_message(new_recs, moved, settings.app_url, reminder=remind)
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
            # Only the chat that failed: the person may have relinked to a new chat meanwhile.
            db.query(TelegramLink).filter_by(user_id=user_id, chat_id=chat_id).update(
                {"status": "blocked"}
            )
            db.commit()
        return "blocked"
    except TelegramUncertain:
        # A timeout or a dropped connection: Telegram may have delivered it. Keep the marker so a
        # re-run the same day cannot send a second message.
        return "failed"
    except TelegramError:
        await redis.delete(marker)  # nothing was delivered, so a retry may still send
        return "failed"
    return "sent"
