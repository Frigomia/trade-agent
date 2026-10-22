"""Discover: the person's watchlist as a browsable list, with what the app already knows about each
company (its quote, whether a scan researched it, and the one-line reading). Reads only saved data
and cached quotes; nothing here starts research, and nothing places a trade."""

import asyncio
import logging
import math
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.agents.market_data import fetch_currency, fetch_profile, fetch_quote_and_history
from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.db import lock_user_for_insert
from app.fx import SUBUNITS
from app.http_headers import no_store
from app.limits import cap_message
from app.models import Recommendation, WatchlistItem
from app.rate_limit import rate_limiter
from app.schemas import WatchlistItemIn, WatchlistItemOut

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/discover",
    tags=["discover"],
    dependencies=[Depends(get_current_user), Depends(no_store)],
)

MAX_DISCOVER = 100  # the same cap as the watchlist it is built on
LIST_LIMIT_PER_MINUTE = 30  # per user: the list fans out to cached quotes
ADD_LIMIT_PER_MINUTE = 60  # per user: adds and re-adds (Undo)
LOOKUP_CONCURRENCY = 8
# The profile fields stored on the item, with the width of their columns.
PROFILE_FIELDS = {"name": 200, "exchange": 60, "currency": 10}


class DiscoverItemOut(BaseModel):
    ticker: str
    asset_type: Literal["ETF", "STOCK"]
    name: str | None  # None until it was resolved: show the ticker
    exchange: str | None
    currency: str | None  # the major unit (GBP, not GBp) the price is in
    source: Literal["manual", "today"]
    added_at: datetime | None  # None for items added before Discover existed
    note: str | None
    target_weight: float | None
    target_price_low: float | None
    target_price_high: float | None
    price: float | None  # in `currency`; None when there is no usable quote
    change_pct: float | None  # last close against the one before, in percent
    price_as_of: date | None
    stale: bool
    # "analyzed": a scan researched it and saved an idea. Never started from here.
    status: Literal["analyzed", "none"]
    insight: str | None  # the idea's one-line reading, only when analyzed
    report_id: int | None  # the idea's id, to open its report


class DiscoverOut(BaseModel):
    items: list[DiscoverItemOut]
    # What could not be looked up, so a missing price is not read as "no change".
    missing: list[Literal["prices"]]


def _minor_unit(currency: str | None) -> tuple[str | None, Decimal]:
    """The major currency and the factor from the quoted unit (GBp to GBP is 0.01)."""
    if not currency:
        return None, Decimal(1)
    major, unit = SUBUNITS.get(currency, (currency, Decimal(1)))
    return major, unit


Quote = tuple[float, float | None, date | None, bool]


async def _quote(ticker: str, sem: asyncio.Semaphore) -> Quote | None:
    """(price, daily change in percent, its date, stale) from the cached quote, or None."""
    try:
        async with sem:
            data = await fetch_quote_and_history(ticker)
    except Exception as exc:
        logger.warning("Discover quote failed for %s: %s", ticker, type(exc).__name__)
        return None
    price = data.get("price")
    if price is None or not math.isfinite(price):
        return None
    closes = [c for c in data.get("closes") or [] if math.isfinite(c)]
    change = None
    if len(closes) >= 2 and closes[-2]:
        change = (closes[-1] - closes[-2]) / closes[-2] * 100
    raw_date = data.get("as_of")
    try:
        as_of = date.fromisoformat(raw_date) if isinstance(raw_date, str) else None
    except ValueError:
        as_of = None
    return float(price), change, as_of, bool(data.get("stale", True))


async def _currency(item: WatchlistItemOut, sem: asyncio.Semaphore) -> str | None:
    """The currency the company is quoted in: stored, else the provider's (cached), else unknown."""
    if item.currency:
        return item.currency
    try:
        async with sem:
            return await fetch_currency(item.ticker)
    except Exception as exc:
        logger.warning("Discover currency failed for %s: %s", item.ticker, type(exc).__name__)
        return None


def _analysis(db: Session, user_id: UUID, tickers: list[str]) -> dict[str, tuple[int, str | None]]:
    """Each ticker's latest saved discovery idea: its id and one-line reading."""
    # The newest idea per ticker is the one with the highest id (ids only grow), so only those rows
    # are read, not every scan's history.
    newest = (
        db.query(func.max(Recommendation.id))
        .filter(
            Recommendation.user_id == user_id,
            Recommendation.source == "discovery",
            Recommendation.idea.is_not(None),
            Recommendation.ticker.in_(tickers),
        )
        .group_by(Recommendation.ticker)
        .scalar_subquery()
    )
    rows = db.query(
        Recommendation.id, Recommendation.ticker, Recommendation.idea["headline"].as_string()
    ).filter(Recommendation.id.in_(newest))
    return {ticker: (rec_id, headline or None) for rec_id, ticker, headline in rows}


@router.get(
    "",
    response_model=DiscoverOut,
    dependencies=[Depends(rate_limiter("discover", limit=LIST_LIMIT_PER_MINUTE))],
)
async def list_discover(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> DiscoverOut:
    items = (
        db.query(WatchlistItem)
        .filter_by(user_id=user.id)
        .order_by(WatchlistItem.created_at.desc().nulls_last(), WatchlistItem.ticker)
        .all()
    )
    analysis = _analysis(db, user.id, [i.ticker for i in items]) if items else {}
    rows = [(WatchlistItemOut.model_validate(i), analysis.get(i.ticker)) for i in items]
    db.close()  # everything is copied out: release the connection before waiting on quotes
    sem = asyncio.Semaphore(LOOKUP_CONCURRENCY)
    quotes, currencies = await asyncio.gather(
        asyncio.gather(*(_quote(item.ticker, sem) for item, _ in rows)),
        # A company added without a known currency (a failed profile, or the older watchlist
        # route) gets it read now, cached, so a London price is not shown as if it were pounds.
        asyncio.gather(*(_currency(item, sem) for item, _ in rows)),
    )
    out: list[DiscoverItemOut] = []
    for (item, found), quote, currency in zip(rows, quotes, currencies, strict=True):
        major, unit = _minor_unit(currency)
        low, high = item.target_price_low, item.target_price_high
        price = change = as_of = None
        stale = True
        if quote is not None:
            raw_price, change, as_of, stale = quote
            price = float(Decimal(str(raw_price)) * unit)
        out.append(
            DiscoverItemOut(
                ticker=item.ticker,
                asset_type=item.asset_type,
                name=item.name,
                exchange=item.exchange,
                currency=major,
                source=item.source,
                added_at=item.created_at,
                note=item.note,
                target_weight=item.target_weight,
                # In the same unit as the price, so the two can be compared.
                target_price_low=float(Decimal(str(low)) * unit) if low is not None else None,
                target_price_high=float(Decimal(str(high)) * unit) if high is not None else None,
                price=price,
                change_pct=change,
                price_as_of=as_of,
                stale=stale,
                status="analyzed" if found else "none",
                insight=found[1] if found else None,
                report_id=found[0] if found else None,
            )
        )
    return DiscoverOut(items=out, missing=["prices"] if any(q is None for q in quotes) else [])


class DiscoverAddIn(WatchlistItemIn):
    # An Undo re-adds with the note and targets the person had set; a new add sends none.
    source: Literal["manual", "today"] = "manual"


@router.post(
    "",
    response_model=WatchlistItemOut,
    dependencies=[Depends(rate_limiter("discover_add", limit=ADD_LIMIT_PER_MINUTE))],
)
async def add_to_discover(
    payload: DiscoverAddIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> WatchlistItem:
    """Adds a company to the list, filling in its name, exchange and currency from the provider's
    profile (never from the request). A company already in the list is returned as it is, with any
    of those fields it was missing filled in; its source and date are kept."""
    try:
        profile = await fetch_profile(payload.ticker)
    except Exception as exc:
        logger.warning("Discover profile failed for %s: %s", payload.ticker, type(exc).__name__)
        profile = {}
    # The lock comes before the existence check, so a double click or an Undo racing a retry waits
    # for the first add to commit and then finds it, instead of failing on the unique ticker.
    lock_user_for_insert(db, user.id)
    item = db.query(WatchlistItem).filter_by(user_id=user.id, ticker=payload.ticker).one_or_none()
    if item is None:
        if db.query(WatchlistItem).filter_by(user_id=user.id).count() >= MAX_DISCOVER:
            raise HTTPException(status_code=409, detail=cap_message("companies", MAX_DISCOVER))
        item = WatchlistItem(
            user_id=user.id,
            created_at=datetime.now(UTC).replace(tzinfo=None),  # naive UTC, like every timestamp
            **payload.model_dump(),
        )
        db.add(item)
    for field, width in PROFILE_FIELDS.items():
        text = profile.get(field)
        # The provider's text is bounded to the column here: a longer one is cut (a name) or ignored
        # (a currency code that long is not a code), so it can never fail the insert.
        if not isinstance(text, str) or not text.strip():
            continue  # a cached value of the wrong type is not stored
        if getattr(item, field) is None and (field != "currency" or len(text) <= width):
            setattr(item, field, text[:width])
    db.commit()
    db.refresh(item)
    return item
