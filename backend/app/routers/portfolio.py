import math

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.agents.market_data import fetch_quote_and_history
from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.models import Holding, PortfolioSnapshot, Trade, WatchlistItem
from app.schemas import (
    HoldingIn,
    HoldingOut,
    PortfolioSnapshotOut,
    TradeIn,
    TradeOut,
    WatchlistItemIn,
    WatchlistItemOut,
)

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
        for field, value in payload.model_dump().items():
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
    holdings = db.query(Holding).filter_by(user_id=user.id).all()

    total_market_value = 0.0
    total_cost_basis = 0.0
    for holding in holdings:
        quote = await fetch_quote_and_history(holding.ticker)
        price = quote["price"]
        if price is None or not math.isfinite(price):
            raise HTTPException(
                status_code=500,
                detail=f"No current price available for {holding.ticker}",
            )
        total_market_value += float(holding.shares) * price
        total_cost_basis += float(holding.shares) * float(holding.cost_basis)

    snapshot = PortfolioSnapshot(
        user_id=user.id,
        total_market_value=total_market_value,
        total_cost_basis=total_cost_basis,
    )
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot


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
