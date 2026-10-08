"""The one place a trade changes a holding. Callers own the transaction: nothing here commits."""

import uuid
from decimal import ROUND_HALF_EVEN, Decimal

from sqlalchemy.orm import Session

from app.models import Holding, Trade
from app.schemas import TradeIn

# Trade.shares and Trade.price are Numeric(18,6): 6 decimals, at most 12 digits before the point.
STORED_STEP = Decimal("0.000001")
STORED_MAX = Decimal("999999999999.999999")
TOO_LARGE = "Those numbers are too large to store."


class TradeRefused(Exception):
    """The trade cannot be applied; the text is safe to show to the person."""


def _as_stored(value: float) -> float:
    """The value the Numeric(18,6) column will hold, so the cost basis uses the same number."""
    # Decimal(str(...)) keeps the digits the person typed, not the float's binary tail.
    exact = Decimal(str(value))
    if exact > STORED_MAX:
        raise TradeRefused(TOO_LARGE)
    return float(exact.quantize(STORED_STEP, ROUND_HALF_EVEN))


def apply_trade(db: Session, user_id: uuid.UUID, holding: Holding, payload: TradeIn) -> Trade:
    shares = _as_stored(payload.shares)
    price = _as_stored(payload.price)
    if payload.action == "BUY":
        prior_value = float(holding.shares) * float(holding.cost_basis)
        added_value = shares * price
        total_cost = prior_value + added_value
        holding.shares = float(holding.shares) + shares
        holding.cost_basis = total_cost / float(holding.shares)
    else:  # SELL (TradeIn.action is BUY or SELL)
        if shares > float(holding.shares):
            raise TradeRefused(f"Cannot sell {shares}; holding has {float(holding.shares)}")
        holding.shares = float(holding.shares) - shares
    # model_copy(update=...) is a new TradeIn with the rounded numbers; the payload is unchanged.
    stored = payload.model_copy(update={"shares": shares, "price": price})
    trade = Trade(user_id=user_id, **stored.model_dump())
    db.add(trade)
    return trade
