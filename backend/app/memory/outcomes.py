from app.agents.market_data import fetch_quote_and_history


async def compute_outcome(ticker: str, price_at_recommendation: float) -> float:
    quote = await fetch_quote_and_history(ticker)
    current_price: float = quote["price"]
    return (current_price - price_at_recommendation) / price_at_recommendation
