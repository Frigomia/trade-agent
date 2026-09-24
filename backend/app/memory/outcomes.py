from datetime import date, timedelta

from app.agents.market_data import fetch_price_history


async def compute_outcome(
    ticker: str, price_at_recommendation: float, created_at: date, lookback_days: int
) -> float:
    end = created_at + timedelta(days=lookback_days)
    closes = await fetch_price_history(ticker, created_at, end)
    if not closes:
        raise ValueError(f"No price history for {ticker} between {created_at} and {end}")
    outcome_price = closes[-1]
    return (outcome_price - price_at_recommendation) / price_at_recommendation
