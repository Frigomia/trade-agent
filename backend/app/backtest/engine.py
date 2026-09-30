from dataclasses import dataclass

from app.analysis import recommend, technical

STARTING_CAPITAL = 10_000.0
HIT_RATE_LOOKAHEAD_DAYS = 20
# Matches agents/market_data.fetch_quote_and_history's period="1y" lookback,
# so the backtest's drawdown/SMA calculations see the same window shape the
# live path does -- an unbounded expanding window makes `max(closes)` an
# all-time high instead of a trailing one, silently testing a different
# strategy than what runs in production.
LIVE_LOOKBACK_DAYS = 252
# Stored curves are downsampled so a 30-year run does not put ~7,500 points per line in a row.
MAX_CURVE_POINTS = 250


@dataclass
class BacktestMetrics:
    final_value: float
    buy_and_hold_value: float
    excess_return_pct: float
    hit_rate_by_signal: dict[str, dict[str, float]]
    equity_curve: dict[str, list[float]] | None = None


def downsample(values: list[float], max_points: int = MAX_CURVE_POINTS) -> list[float]:
    """Evenly spaced points, always keeping the first and last, rounded to 2 decimals.

    A list that already fits is returned unchanged (only rounded). Requires max_points >= 2.
    """
    if len(values) <= max_points:
        return [round(v, 2) for v in values]
    last = len(values) - 1
    # Consecutive picks are more than 1 apart (len > max_points), so their rounded indices differ.
    picks = [round(i * last / (max_points - 1)) for i in range(max_points)]
    return [round(values[i], 2) for i in picks]


def simulate(closes: list[float]) -> BacktestMetrics:
    cash = STARTING_CAPITAL
    shares = 0.0
    is_held = False
    forward_returns_by_signal: dict[str, list[float]] = {}
    strategy_values: list[float] = []
    buy_and_hold_values: list[float] = []

    for i in range(len(closes)):
        window = closes[max(0, i + 1 - LIVE_LOOKBACK_DAYS) : i + 1]
        signal = technical.score_technical(window)
        action, suggested_position_pct, _ = recommend.synthesize(
            asset_type="ETF",
            is_held=is_held,
            fundamental_score=None,
            technical_signal=signal,
        )
        price = closes[i]

        if action in ("BUY", "ADD") and suggested_position_pct is not None:
            # Portion of the original notional, capped by remaining cash so
            # repeated BUY/ADD signals can never overdraw.
            invest = min(suggested_position_pct * STARTING_CAPITAL, cash)
            shares += invest / price
            cash -= invest
            is_held = True
        elif action == "TRIM":
            # synthesize() doesn't return a magnitude for TRIM -- simulator
            # convention: sell half the current position.
            proceeds = shares * 0.5 * price
            shares *= 0.5
            cash += proceeds

        strategy_values.append(cash + shares * price)
        buy_and_hold_values.append(STARTING_CAPITAL / closes[0] * price)

        if signal != "NEUTRAL" and i + HIT_RATE_LOOKAHEAD_DAYS < len(closes):
            forward_return = (closes[i + HIT_RATE_LOOKAHEAD_DAYS] - price) / price
            forward_returns_by_signal.setdefault(signal, []).append(forward_return)

    final_value = cash + shares * closes[-1]
    buy_and_hold_value = STARTING_CAPITAL / closes[0] * closes[-1]
    excess_return_pct = (final_value - buy_and_hold_value) / buy_and_hold_value

    hit_rate_by_signal = {
        signal: {
            "count": float(len(returns)),
            "avg_forward_return_pct": sum(returns) / len(returns),
            "hit_rate": sum(1 for r in returns if r > 0) / len(returns),
        }
        for signal, returns in forward_returns_by_signal.items()
    }

    return BacktestMetrics(
        final_value=final_value,
        buy_and_hold_value=buy_and_hold_value,
        excess_return_pct=excess_return_pct,
        hit_rate_by_signal=hit_rate_by_signal,
        equity_curve={
            "strategy": downsample(strategy_values),
            "buy_and_hold": downsample(buy_and_hold_values),
        },
    )
