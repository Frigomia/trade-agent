"""Portfolio snapshots: what the portfolio is worth right now, recorded as one row.

Used by POST /portfolio/snapshot and by the scheduled job (app/scheduled.py).
"""

import math
import uuid

from sqlalchemy.orm import Session

from app.agents.market_data import fetch_quote_and_history
from app.db import lock_and_check_active
from app.models import Holding, PortfolioSnapshot


class PriceUnavailable(Exception):
    """A holding has no usable current price, so no honest total can be recorded."""

    def __init__(self, ticker: str) -> None:
        super().__init__(f"No current price available for {ticker}")
        self.ticker = ticker


async def record_snapshot(db: Session, user_id: uuid.UUID) -> PortfolioSnapshot | None:
    """Records one snapshot; None (nothing written) when the account was removed or disabled."""
    holdings = db.query(Holding).filter_by(user_id=user_id).all()

    total_market_value = 0.0
    total_cost_basis = 0.0
    for holding in holdings:
        if float(holding.shares) == 0:
            continue  # fully sold: not priced, matching /portfolio/summary
        quote = await fetch_quote_and_history(holding.ticker)
        price = quote["price"]
        # A partial total would be misleading, so any missing price aborts the whole snapshot.
        if price is None or not math.isfinite(price):
            raise PriceUnavailable(holding.ticker)
        total_market_value += float(holding.shares) * price
        total_cost_basis += float(holding.shares) * float(holding.cost_basis)

    # Last step before the write (after the slow quote fetches): take the user's lock and re-check.
    if not lock_and_check_active(db, user_id):
        db.rollback()  # release the lock
        return None
    snapshot = PortfolioSnapshot(
        user_id=user_id,
        total_market_value=total_market_value,
        total_cost_basis=total_cost_basis,
    )
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot
