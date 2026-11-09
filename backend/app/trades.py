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


def apply_position(holding: Holding, payload: TradeIn) -> None:
    """Apply ledger arithmetic without committing or creating a trade (also used by corrections)."""
    shares = Decimal(str(_as_stored(payload.shares)))
    price = Decimal(str(_as_stored(payload.price)))
    prior_shares = Decimal(str(holding.shares))
    basis = None if holding.cost_basis is None else Decimal(str(holding.cost_basis))
    if payload.action == "BUY":
        total = prior_shares + shares
        holding.shares = float(total)
        if prior_shares == 0:
            holding.cost_basis = float(price)
            if holding.first_purchase_date is None:
                holding.first_purchase_date = payload.date
        elif basis is not None:
            holding.cost_basis = float((prior_shares * basis + shares * price) / total)
    else:
        if shares > prior_shares:
            raise TradeRefused(f"Cannot sell {shares}; holding has {prior_shares}")
        holding.shares = float(prior_shares - shares)


def apply_trade(db: Session, user_id: uuid.UUID, holding: Holding, payload: TradeIn) -> Trade:
    apply_position(holding, payload)
    shares = _as_stored(payload.shares)
    price = _as_stored(payload.price)
    # model_copy(update=...) is a new TradeIn with the rounded numbers; the payload is unchanged.
    stored = payload.model_copy(update={"shares": shares, "price": price})
    trade = Trade(user_id=user_id, **stored.model_dump())
    db.add(trade)
    return trade
