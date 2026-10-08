"""The one place a trade changes a holding. Callers own the transaction: nothing here commits."""

import uuid

from sqlalchemy.orm import Session

from app.models import Holding, Trade
from app.schemas import TradeIn


class TradeRefused(Exception):
    """The trade cannot be applied; the text is safe to show to the person."""


def apply_trade(db: Session, user_id: uuid.UUID, holding: Holding, payload: TradeIn) -> Trade:
    if payload.action == "BUY":
        prior_value = float(holding.shares) * float(holding.cost_basis)
        added_value = payload.shares * payload.price
        total_cost = prior_value + added_value
        holding.shares = float(holding.shares) + payload.shares
        holding.cost_basis = total_cost / float(holding.shares)
    elif payload.action == "SELL":
        if payload.shares > float(holding.shares):
            raise TradeRefused(f"Cannot sell {payload.shares}; holding has {float(holding.shares)}")
        holding.shares = float(holding.shares) - payload.shares
    else:
        raise TradeRefused("action must be BUY or SELL")
    trade = Trade(user_id=user_id, **payload.model_dump())
    db.add(trade)
    return trade
