import asyncio
import logging
import math

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.agents.market_data import fetch_quote_and_history
from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.models import Holding, PortfolioSnapshot, Trade, WatchlistItem
from app.schemas import (
    HoldingIn,
    HoldingOut,
    HoldingSummaryOut,
    PortfolioSnapshotOut,
    PortfolioSummaryOut,
    TradeIn,
    TradeOut,
    WatchlistItemIn,
    WatchlistItemOut,
    WatchlistSummaryOut,
)
from app.snapshots import record_snapshot

logger = logging.getLogger(__name__)

# The router-level dependency makes authentication run before anything else on every route,
# even one whose handler forgets to ask for the user.
router = APIRouter(
    prefix="/portfolio", tags=["portfolio"], dependencies=[Depends(get_current_user)]
)


@router.get("/holdings", response_model=list[HoldingOut])
def list_holdings(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> list[Holding]:
    return db.query(Holding).filter_by(user_id=user.id).all()


@router.post("/holdings", response_model=HoldingOut)
def upsert_holding(
    payload: HoldingIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> Holding:
    holding = db.query(Holding).filter_by(user_id=user.id, ticker=payload.ticker).one_or_none()
    if holding is None:
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


@router.post("/watchlist", response_model=WatchlistItemOut)
def upsert_watchlist_item(
    payload: WatchlistItemIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> WatchlistItem:
    item = db.query(WatchlistItem).filter_by(user_id=user.id, ticker=payload.ticker).one_or_none()
    if item is None:
        item = WatchlistItem(user_id=user.id, **payload.model_dump())
        db.add(item)
    else:
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.post("/trades", response_model=TradeOut)
def log_trade(
    payload: TradeIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> Trade:
    holding = db.query(Holding).filter_by(user_id=user.id, ticker=payload.ticker).one_or_none()
    if holding is None:
        raise HTTPException(
            status_code=404,
            detail=f"No holding for {payload.ticker}; add it via POST /portfolio/holdings first",
        )

    if payload.action == "BUY":
        prior_value = float(holding.shares) * float(holding.cost_basis)
        added_value = payload.shares * payload.price
        total_cost = prior_value + added_value
        holding.shares = float(holding.shares) + payload.shares
        holding.cost_basis = total_cost / float(holding.shares)
    elif payload.action == "SELL":
        if payload.shares > float(holding.shares):
            raise HTTPException(
                status_code=422,
                detail=f"Cannot sell {payload.shares}; holding has {float(holding.shares)}",
            )
        holding.shares = float(holding.shares) - payload.shares
    else:
        raise HTTPException(status_code=422, detail="action must be BUY or SELL")

    trade = Trade(user_id=user.id, **payload.model_dump())
    db.add(trade)
    db.commit()
    db.refresh(trade)
    return trade


@router.post("/snapshot", response_model=PortfolioSnapshotOut)
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


@router.get("/summary", response_model=PortfolioSummaryOut)
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
