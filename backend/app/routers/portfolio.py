from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import Holding, WatchlistItem
from app.schemas import HoldingIn, HoldingOut, WatchlistItemIn, WatchlistItemOut

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


@router.get("/holdings", response_model=list[HoldingOut])
def list_holdings(db: Session = Depends(get_db)) -> list[Holding]:
    return db.query(Holding).filter_by(user_id=settings.default_user_id).all()


@router.post("/holdings", response_model=HoldingOut)
def upsert_holding(payload: HoldingIn, db: Session = Depends(get_db)) -> Holding:
    holding = (
        db.query(Holding)
        .filter_by(user_id=settings.default_user_id, ticker=payload.ticker)
        .one_or_none()
    )
    if holding is None:
        holding = Holding(user_id=settings.default_user_id, **payload.model_dump())
        db.add(holding)
    else:
        for field, value in payload.model_dump().items():
            setattr(holding, field, value)
    db.commit()
    db.refresh(holding)
    return holding


@router.delete("/holdings/{ticker}", status_code=204)
def delete_holding(ticker: str, db: Session = Depends(get_db)) -> None:
    holding = (
        db.query(Holding)
        .filter_by(user_id=settings.default_user_id, ticker=ticker)
        .one_or_none()
    )
    if holding is None:
        raise HTTPException(status_code=404, detail="Holding not found")
    db.delete(holding)
    db.commit()


@router.get("/watchlist", response_model=list[WatchlistItemOut])
def list_watchlist(db: Session = Depends(get_db)) -> list[WatchlistItem]:
    return db.query(WatchlistItem).filter_by(user_id=settings.default_user_id).all()


@router.post("/watchlist", response_model=WatchlistItemOut)
def upsert_watchlist_item(
    payload: WatchlistItemIn, db: Session = Depends(get_db)
) -> WatchlistItem:
    item = (
        db.query(WatchlistItem)
        .filter_by(user_id=settings.default_user_id, ticker=payload.ticker)
        .one_or_none()
    )
    if item is None:
        item = WatchlistItem(user_id=settings.default_user_id, **payload.model_dump())
        db.add(item)
    else:
        for field, value in payload.model_dump().items():
            setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item
