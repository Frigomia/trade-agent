import asyncio
import logging
import math

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import DataError
from sqlalchemy.orm import Session

from app.agents.market_data import fetch_quote_and_history
from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.db import lock_user_for_insert
from app.http_headers import no_store
from app.limits import MAX_HOLDINGS, cap_message
from app.models import Holding, PortfolioSnapshot, Trade, WatchlistItem
from app.rate_limit import rate_limiter
from app.schemas import (
    HoldingIn,
    HoldingOut,
    HoldingSummaryOut,
    IsinIn,
    IsinOut,
    PortfolioSnapshotOut,
    PortfolioSummaryOut,
    TradeIn,
    TradeOut,
    WatchlistItemIn,
    WatchlistItemOut,
    WatchlistSummaryOut,
)
from app.snapshots import record_snapshot
from app.trades import TOO_LARGE, TradeRefused, apply_trade

logger = logging.getLogger(__name__)

# The router-level dependency makes authentication run before anything else on every route,
# even one whose handler forgets to ask for the user.
router = APIRouter(
    prefix="/portfolio",
    tags=["portfolio"],
    dependencies=[Depends(get_current_user), Depends(no_store)],
)

# Every row can become a paid analysis run or a live quote fetch, so a user's lists are bounded.
MAX_WATCHLIST = 100
WRITE_LIMIT_PER_MINUTE = 60  # per user, per route: the holdings/watchlist upserts
QUOTE_LIMIT_PER_MINUTE = 30  # per user, per route: these routes fan out to yfinance


@router.get("/holdings", response_model=list[HoldingOut])
def list_holdings(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> list[Holding]:
    return db.query(Holding).filter_by(user_id=user.id).all()


@router.put(
    "/instruments/{ticker}/isin",
    response_model=IsinOut,
    dependencies=[Depends(rate_limiter("portfolio_isin", limit=WRITE_LIMIT_PER_MINUTE))],
)
def set_isin(
    ticker: str,
    payload: IsinIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> IsinOut:
    """Sets (or clears) the ISIN on the person's holding and/or watchlist row for this ticker.
    A dedicated route: the holdings upsert replaces the whole record and would wipe it."""
    symbol = ticker.upper()
    holding = db.query(Holding).filter_by(user_id=user.id, ticker=symbol).one_or_none()
    item = db.query(WatchlistItem).filter_by(user_id=user.id, ticker=symbol).one_or_none()
    if holding is None and item is None:
        raise HTTPException(status_code=404, detail="No holding or watchlist item for that ticker")
    for row in (holding, item):
        if row is not None:
            row.isin = payload.isin
    db.commit()
    return IsinOut(ticker=symbol, isin=payload.isin)


@router.post(
    "/holdings",
    response_model=HoldingOut,
    dependencies=[Depends(rate_limiter("portfolio_holdings", limit=WRITE_LIMIT_PER_MINUTE))],
)
def upsert_holding(
    payload: HoldingIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> Holding:
    # Lock first, before the lookup: a plan-line placement creating this same ticker takes the same
    # lock, so it cannot insert between this lookup and the insert below (a unique-key error).
    lock_user_for_insert(db, user.id)
    holding = db.query(Holding).filter_by(user_id=user.id, ticker=payload.ticker).one_or_none()
    if holding is None:
        if db.query(Holding).filter_by(user_id=user.id).count() >= MAX_HOLDINGS:
            raise HTTPException(status_code=409, detail=cap_message("holdings", MAX_HOLDINGS))
        holding = Holding(user_id=user.id, **payload.model_dump())
        db.add(holding)
    else:
        for field, value in payload.model_dump().items():
            setattr(holding, field, value)
    db.commit()
    db.refresh(holding)
    return holding


@router.delete("/holdings/{ticker}", status_code=204)
def delete_holding(
    ticker: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> None:
    holding = db.query(Holding).filter_by(user_id=user.id, ticker=ticker).one_or_none()
    if holding is None:
        raise HTTPException(status_code=404, detail="Holding not found")
    db.delete(holding)
    db.commit()


@router.get("/watchlist", response_model=list[WatchlistItemOut])
def list_watchlist(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> list[WatchlistItem]:
    return db.query(WatchlistItem).filter_by(user_id=user.id).all()


@router.post(
    "/watchlist",
    response_model=WatchlistItemOut,
    dependencies=[Depends(rate_limiter("portfolio_watchlist", limit=WRITE_LIMIT_PER_MINUTE))],
)
def upsert_watchlist_item(
    payload: WatchlistItemIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> WatchlistItem:
    item = db.query(WatchlistItem).filter_by(user_id=user.id, ticker=payload.ticker).one_or_none()
    if item is None:
        lock_user_for_insert(db, user.id)
        if db.query(WatchlistItem).filter_by(user_id=user.id).count() >= MAX_WATCHLIST:
            raise HTTPException(
                status_code=409, detail=cap_message("watchlist items", MAX_WATCHLIST)
            )
        item = WatchlistItem(user_id=user.id, **payload.model_dump())
        db.add(item)
    else:
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete(
    "/watchlist/{ticker}",
    status_code=204,
    dependencies=[
        Depends(rate_limiter("portfolio_watchlist_delete", limit=WRITE_LIMIT_PER_MINUTE))
    ],
)
def delete_watchlist_item(
    ticker: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> None:
    item = db.query(WatchlistItem).filter_by(user_id=user.id, ticker=ticker.upper()).one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Watchlist item not found")
    db.delete(item)
    db.commit()


@router.post(
    "/trades",
    response_model=TradeOut,
    dependencies=[Depends(rate_limiter("portfolio_trades", limit=WRITE_LIMIT_PER_MINUTE))],
)
def log_trade(
    payload: TradeIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> Trade:
    # Same per-person lock as placing a plan line, so two writes to one holding cannot interleave.
    lock_user_for_insert(db, user.id)
    holding = db.query(Holding).filter_by(user_id=user.id, ticker=payload.ticker).one_or_none()
    if holding is None:
        raise HTTPException(
            status_code=404,
            detail=f"No holding for {payload.ticker}; add it via POST /portfolio/holdings first",
        )

    try:
        trade = apply_trade(db, user.id, holding, payload)
        db.commit()
    except TradeRefused as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except DataError:
        # A total past Numeric(18,6), such as the holding's share count: refused at the commit.
        db.rollback()
        raise HTTPException(status_code=422, detail=TOO_LARGE) from None
    db.refresh(trade)
    return trade


@router.post(
    "/snapshot",
    response_model=PortfolioSnapshotOut,
    dependencies=[Depends(rate_limiter("portfolio_snapshot", limit=QUOTE_LIMIT_PER_MINUTE))],
)
async def create_snapshot(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> PortfolioSnapshot:
    return await record_snapshot(db, user.id)


@router.get("/snapshots", response_model=list[PortfolioSnapshotOut])
def list_snapshots(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> list[PortfolioSnapshot]:
    return (
        db.query(PortfolioSnapshot)
        .filter_by(user_id=user.id)
        .order_by(PortfolioSnapshot.created_at, PortfolioSnapshot.id)
        .all()
    )


async def _prices_for(tickers: set[str]) -> dict[str, float | None]:
    """Live price per ticker; None when the fetch fails or returns a non-finite price."""
    ordered = sorted(tickers)

    sem = asyncio.Semaphore(8)  # bound fan-out so unquotable tickers can't saturate the thread pool

    async def one(ticker: str) -> float | None:
        try:
            async with sem:
                data = await fetch_quote_and_history(ticker)
        except Exception as exc:
            logger.warning("Live price fetch failed for %s: %s", ticker, type(exc).__name__)
            return None
        price = data.get("price")
        # NaN/inf would survive the Redis JSON round-trip and then fail response serialization.
        return price if price is not None and math.isfinite(price) else None

    results = await asyncio.gather(*(one(t) for t in ordered))
    return dict(zip(ordered, results, strict=True))


@router.get(
    "/summary",
    response_model=PortfolioSummaryOut,
    dependencies=[Depends(rate_limiter("portfolio_summary", limit=QUOTE_LIMIT_PER_MINUTE))],
)
async def get_summary(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> PortfolioSummaryOut:
    holdings = db.query(Holding).filter_by(user_id=user.id).order_by(Holding.ticker).all()
    watchlist = (
        db.query(WatchlistItem).filter_by(user_id=user.id).order_by(WatchlistItem.ticker).all()
    )
    rows = [HoldingSummaryOut.model_validate(h, from_attributes=True) for h in holdings]
    watch_rows = [WatchlistSummaryOut.model_validate(w, from_attributes=True) for w in watchlist]
    # Everything needed is copied out; release the pooled connection before awaiting quotes, which
    # can take seconds (retries) during a market-data outage.
    db.close()

    open_rows = [r for r in rows if r.shares > 0]  # a fully sold holding stays a row, unpriced
    prices = await _prices_for({r.ticker for r in open_rows} | {w.ticker for w in watch_rows})

    for w in watch_rows:
        w.current_price = prices[w.ticker]

    total_market_value = 0.0
    total_cost_basis = 0.0
    for r in open_rows:
        price = prices[r.ticker]
        if price is None:
            continue
        market_value = r.shares * price
        cost = r.shares * r.cost_basis
        r.current_price = price
        r.market_value = market_value
        r.unrealized_pl = market_value - cost
        r.unrealized_pl_pct = (market_value - cost) / cost * 100 if cost > 0 else None
        total_market_value += market_value
        total_cost_basis += cost

    if total_market_value > 0:
        for r in open_rows:
            if r.market_value is not None:
                r.weight = r.market_value / total_market_value

    total_pl = total_market_value - total_cost_basis
    return PortfolioSummaryOut(
        holdings=rows,
        watchlist=watch_rows,
        total_market_value=total_market_value,
        total_cost_basis=total_cost_basis,
        total_pl=total_pl,
        total_pl_pct=total_pl / total_cost_basis * 100 if total_cost_basis > 0 else None,
        unpriced_count=sum(1 for r in open_rows if r.current_price is None),
    )
