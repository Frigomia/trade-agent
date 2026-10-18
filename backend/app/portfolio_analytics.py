"""Load the caller's positions, bounded market data, then delegate the math to pure functions."""

import asyncio
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app import fx
from app.agents import market_data
from app.analysis.portfolio import PositionInput, analyze_portfolio
from app.models import Holding
from app.schemas_discovery import PortfolioExposure

logger = logging.getLogger(__name__)
LOOKUP_CONCURRENCY = 8


async def load_analytics(db: Session, user_id: uuid.UUID) -> PortfolioExposure:
    holdings = [
        PositionInput(row.ticker, row.name, float(row.shares), row.asset_type, row.sector)
        for row in db.query(Holding).filter(Holding.user_id == user_id, Holding.shares > 0).all()
    ]
    # This service only reads. Release its connection before waiting on external providers.
    db.rollback()
    if not holdings:
        return analyze_portfolio([], {}, {}, {}, datetime.now(UTC))
    prices, skipped = await fx.eur_prices({holding.ticker for holding in holdings})
    sem = asyncio.Semaphore(LOOKUP_CONCURRENCY)

    async def details(ticker: str) -> tuple[str, dict[str, float], dict[str, str | None]]:
        history: dict[str, float] = {}
        profile: dict[str, str | None] = {}
        async with sem:
            try:
                history = await market_data.fetch_dated_closes(ticker)
            except Exception as exc:
                logger.warning("Analytics history unavailable (%s)", type(exc).__name__)
            try:
                profile = await market_data.fetch_profile(ticker)
            except Exception as exc:
                logger.warning("Analytics profile unavailable (%s)", type(exc).__name__)
        return ticker, history, profile

    loaded = await asyncio.gather(*(details(ticker) for ticker in sorted(prices)))
    return await asyncio.to_thread(
        analyze_portfolio,
        holdings,
        prices,
        {ticker: history for ticker, history, _ in loaded},
        {ticker: profile for ticker, _, profile in loaded},
        datetime.now(UTC),
        skipped,
    )
