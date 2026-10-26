"""Discover: the person's watchlist as a browsable list, with what the app already knows about each
company (its quote, research status and one-line reading). Reads are free; only an explicit
Analyze request starts single-company research. Nothing places a trade."""

import asyncio
import logging
import math
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Literal, Self
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import claude_keys, usage
from app.agents.market_data import fetch_profile, fetch_quote_and_history
from app.agents.news import _get_client
from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.db import lock_user_for_insert
from app.discovery.company import CompanyDataUnavailable
from app.discovery.company_jobs import CompanyUnavailable, company_state, start_company
from app.discovery.jobs import DiscoveryAlreadyRunning
from app.fx import minor_unit, quoted_currency
from app.http_headers import no_store
from app.limits import cap_message
from app.models import Holding, Recommendation, WatchlistItem
from app.price_history import HistoryUnavailable, load_price_history
from app.rate_limit import rate_limiter
from app.schemas import (
    CompanyAnalysisOut,
    HistoryRange,
    Note,
    PriceHistoryOut,
    TargetPrice,
    Ticker,
    WatchlistItemIn,
    WatchlistItemOut,
    check_price_range,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/discover",
    tags=["discover"],
    dependencies=[Depends(get_current_user), Depends(no_store)],
)

MAX_DISCOVER = 100  # the same cap as the watchlist it is built on
LIST_LIMIT_PER_MINUTE = 30  # per user: the list fans out to cached quotes
ADD_LIMIT_PER_MINUTE = 60  # per user: adds and re-adds (Undo)
EDIT_LIMIT_PER_MINUTE = 60  # per user: edits of a company's targets and note
STORED_PRICE_STEP = Decimal("0.000001")  # the column's scale, Numeric(18,6)
MAX_STORED_PRICE = Decimal("999999999999")  # and its 12 integer digits
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
    # A saved discovery report or a completed, researched company outcome.
    status: Literal["analyzed", "none"]
    insight: str | None  # the idea's one-line reading, only when analyzed
    report_id: int | None  # the idea's id, to open its report
    # The person holds shares of it. Its weight target then lives on the holding, not here.
    owned: bool
    analysis: CompanyAnalysisOut | None = None


class DiscoverOut(BaseModel):
    items: list[DiscoverItemOut]
    # What could not be looked up, so a missing price is not read as "no change".
    missing: list[Literal["prices"]]


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
    return await quoted_currency(item.ticker, item.currency, sem)


def _owned(db: Session, user_id: UUID, ticker: str | None = None) -> set[str]:
    """The tickers held with shares (a sold-out one is not owned), or just `ticker` if it is."""
    rows = db.query(Holding.ticker).filter(Holding.user_id == user_id, Holding.shares > 0)
    if ticker is not None:
        rows = rows.filter(Holding.ticker == ticker)
    return {found for (found,) in rows}


def _item_out(
    item: WatchlistItemOut,
    found: tuple[int, str | None] | None,
    currency: str | None,
    quote: Quote | None,
    owned: bool,
) -> DiscoverItemOut:
    """One company as the list shows it: prices and price targets in the major currency unit."""
    major, unit = minor_unit(currency)
    low, high = item.target_price_low, item.target_price_high
    price = change = as_of = None
    stale = True
    if quote is not None:
        raw_price, change, as_of, stale = quote
        price = float(Decimal(str(raw_price)) * unit)
    return DiscoverItemOut(
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
        owned=owned,
    )


def _company_states(
    db: Session, user_id: UUID, tickers: list[str]
) -> dict[str, CompanyAnalysisOut]:
    from app.models import CompanyAnalysis

    newest = (
        db.query(func.max(CompanyAnalysis.id))
        .filter(CompanyAnalysis.user_id == user_id, CompanyAnalysis.ticker.in_(tickers))
        .group_by(CompanyAnalysis.ticker)
        .scalar_subquery()
    )
    return {
        row.ticker: CompanyAnalysisOut.model_validate(row)
        for row in db.query(CompanyAnalysis).filter(CompanyAnalysis.id.in_(newest))
    }


def _attach_state(item: DiscoverItemOut, state: CompanyAnalysisOut | None) -> None:
    item.analysis = state
    if state is not None and state.researched and item.report_id is None:
        item.status = "analyzed"
        item.insight = state.reason
        item.report_id = state.report_id


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
    owned = _owned(db, user.id)
    company_states = _company_states(db, user.id, [i.ticker for i in items]) if items else {}
    rows = [(WatchlistItemOut.model_validate(i), analysis.get(i.ticker)) for i in items]
    db.close()  # everything is copied out: release the connection before waiting on quotes
    sem = asyncio.Semaphore(LOOKUP_CONCURRENCY)
    quotes, currencies = await asyncio.gather(
        asyncio.gather(*(_quote(item.ticker, sem) for item, _ in rows)),
        # A company added without a known currency (a failed profile, or the older watchlist
        # route) gets it read now, cached, so a London price is not shown as if it were pounds.
        asyncio.gather(*(_currency(item, sem) for item, _ in rows)),
    )
    out = [
        _item_out(item, found, currency, quote, item.ticker in owned)
        for (item, found), quote, currency in zip(rows, quotes, currencies, strict=True)
    ]
    for item in out:
        _attach_state(item, company_states.get(item.ticker))
    return DiscoverOut(items=out, missing=["prices"] if any(q is None for q in quotes) else [])


class CompanyOverviewOut(BaseModel):
    company: DiscoverItemOut
    sector: str | None
    industry: str | None
    country: str | None
    missing: list[Literal["prices", "profile"]]


def _saved_company(db: Session, user_id: UUID, ticker: str) -> WatchlistItemOut:
    row = db.query(WatchlistItem).filter_by(user_id=user_id, ticker=ticker).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Not in your Discover list")
    return WatchlistItemOut.model_validate(row)


@router.get(
    "/{ticker}/overview",
    response_model=CompanyOverviewOut,
    dependencies=[Depends(rate_limiter("company_overview", limit=LIST_LIMIT_PER_MINUTE))],
)
async def company_overview(
    ticker: Ticker,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> CompanyOverviewOut:
    item = _saved_company(db, user.id, ticker)
    found = _analysis(db, user.id, [ticker]).get(ticker)
    owned = ticker in _owned(db, user.id, ticker)
    db.close()

    async def profile() -> dict[str, str | None]:
        try:
            return await fetch_profile(ticker)
        except Exception as exc:
            logger.warning("Company profile unavailable (%s)", type(exc).__name__)
            return {}

    facts, quote = await asyncio.gather(profile(), _quote(ticker, asyncio.Semaphore(1)))
    currency = item.currency or facts.get("currency")
    company = _item_out(item, found, currency, quote, owned)
    _attach_state(company, await company_state(user.id, ticker))
    company.name = company.name or facts.get("name")
    company.exchange = company.exchange or facts.get("exchange")
    missing: list[Literal["prices", "profile"]] = []
    if quote is None:
        missing.append("prices")
    if not facts:
        missing.append("profile")
    return CompanyOverviewOut(
        company=company,
        sector=facts.get("sector"),
        industry=facts.get("industry"),
        country=facts.get("country"),
        missing=missing,
    )


@router.get(
    "/{ticker}/history",
    response_model=PriceHistoryOut,
    dependencies=[Depends(rate_limiter("idea_history", limit=LIST_LIMIT_PER_MINUTE))],
)
async def company_history(
    ticker: Ticker,
    range_: HistoryRange = Query("1m", alias="range"),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> PriceHistoryOut:
    item = _saved_company(db, user.id, ticker)
    db.close()
    # The shared reader verifies the live quote unit; it never guesses a pence/pound series.
    major, _ = minor_unit(item.currency)
    try:
        return await load_price_history(ticker, range_, major)
    except HistoryUnavailable:
        raise HTTPException(status_code=502, detail="Price history is unavailable") from None


@router.post(
    "/{ticker}/analyze",
    status_code=202,
    response_model=CompanyAnalysisOut,
    dependencies=[Depends(rate_limiter("discovery_run", limit=2))],
)
async def analyze_company(
    ticker: Ticker,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
    defaults: usage.LimitDefaults = Depends(usage.get_limit_defaults),
) -> CompanyAnalysisOut:
    _saved_company(db, user.id, ticker)
    if _analysis(db, user.id, [ticker]).get(ticker):
        raise HTTPException(status_code=409, detail="A saved report is already available.")
    client = await run_in_threadpool(claude_keys.resolve_client, db, user.id, user.role)
    db.close()
    uses_saved_key = client is not None
    if client is None:
        if user.role != "admin":
            raise claude_keys.ClaudeKeyRequired()
        client = _get_client()
        if client is None:
            raise claude_keys.ClaudeKeyRequired()
    try:
        return await start_company(
            user.id,
            ticker,
            client,
            usage.effective_limit(user, "analysis_run", defaults),
            uses_saved_key,
        )
    except DiscoveryAlreadyRunning:
        raise HTTPException(
            status_code=409, detail="An analysis is already running. Wait for it to finish."
        ) from None
    except (CompanyDataUnavailable, TimeoutError):
        raise HTTPException(
            status_code=503, detail="Research data is unavailable. No monthly run was used."
        ) from None
    except (CompanyUnavailable, usage.RunClaimLost):
        raise HTTPException(
            status_code=409,
            detail="Research or usage settlement is unavailable. Refresh before retrying.",
        ) from None


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
) -> WatchlistItemOut:
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
    # The answer is copied out while the row is still locked: after the commit a removal waiting on
    # it can win, and reading the row then would fail although the add succeeded.
    db.flush()
    out = WatchlistItemOut.model_validate(item)
    db.commit()
    return out


class DiscoverEditIn(BaseModel):
    """What an edit may change. Only the fields sent change; an explicit null clears one. The price
    range is in the major currency unit, the unit the list shows it in."""

    model_config = ConfigDict(extra="forbid")

    note: Note | None = None
    target_weight: float | None = Field(default=None, ge=0, le=1)
    target_price_low: TargetPrice | None = None
    target_price_high: TargetPrice | None = None

    @model_validator(mode="after")
    def _range_is_both_ends_in_order(self) -> Self:
        check_price_range(self.target_price_low, self.target_price_high, self.model_fields_set)
        return self


def _stored_price(shown: float | None, unit: Decimal) -> float | None:
    """A price as the column keeps it (the quote's own unit) from the major unit it is shown in."""
    if shown is None:
        return None
    stored = Decimal(str(shown)) / unit
    if stored > MAX_STORED_PRICE:
        raise HTTPException(status_code=422, detail="That price is too large.")
    return float(stored.quantize(STORED_PRICE_STEP))


@router.patch(
    "/{ticker}",
    response_model=DiscoverItemOut,
    dependencies=[Depends(rate_limiter("discover_edit", limit=EDIT_LIMIT_PER_MINUTE))],
)
async def edit_discover_item(
    ticker: Ticker,
    payload: DiscoverEditIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> DiscoverItemOut:
    """Changes a saved company's note, weight target and price range. The range goes in and comes
    back in the major currency unit, as in the list (pounds, not pence). It never adds a company:
    one that is not in the list is a 404. The quote is not looked up here, so the price fields of
    the answer are empty; the list has them."""
    found_row = db.query(WatchlistItem).filter_by(user_id=user.id, ticker=ticker).one_or_none()
    if found_row is None:
        raise HTTPException(status_code=404, detail="Not in your Discover list")
    current = WatchlistItemOut.model_validate(found_row)
    db.rollback()  # copied out: release the connection while the provider is asked
    # The provider is asked (cached) outside the row lock: the unit decides what the range means.
    currency = await _currency(current, asyncio.Semaphore(1))
    sets_range = payload.target_price_low is not None  # the range comes as a pair
    if sets_range and currency is None:
        # Guessing the unit would store a London range 100 times too small.
        raise HTTPException(
            status_code=503, detail="Its currency could not be read right now. Try again."
        )
    _, unit = minor_unit(currency)

    # Locked so a removal racing this edit waits for it, and a removed company is a 404, not a 500.
    row = (
        db.query(WatchlistItem)
        .filter_by(user_id=user.id, ticker=ticker)
        .populate_existing()
        .with_for_update()
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Not in your Discover list")
    if row.currency:  # stored since the first read: it wins over the provider's answer
        currency = row.currency
        _, unit = minor_unit(currency)
    owned = ticker in _owned(db, user.id, ticker)
    sent = payload.model_fields_set
    if owned and payload.target_weight is not None:
        # Clearing a saved weight stays allowed: the plan falls back to it for a holding with none.
        raise HTTPException(
            status_code=409, detail="You own this company: set its target on the holding."
        )
    if "note" in sent:
        row.note = (payload.note or "").strip() or None
    if "target_weight" in sent:
        row.target_weight = payload.target_weight
    if "target_price_low" in sent:
        row.target_price_low = _stored_price(payload.target_price_low, unit)
        row.target_price_high = _stored_price(payload.target_price_high, unit)
        if sets_range and row.currency is None and currency and len(currency) <= 10:
            row.currency = currency  # the unit the range was converted with, kept with it
    # The whole answer is built while the row is still locked: after the commit a removal waiting
    # on it can win, and reading the row then would fail although the edit succeeded.
    db.flush()
    answer = _item_out(
        WatchlistItemOut.model_validate(row),
        _analysis(db, user.id, [ticker]).get(ticker),
        currency,
        None,
        owned,
    )
    db.commit()
    return answer
