from statistics import mean

from app.config import settings


def _sma(closes: list[float], window: int) -> float:
    return mean(closes[-window:])


def _rsi_14(closes: list[float]) -> float:
    window = closes[-15:]
    if len(window) < 2:
        return 50.0
    gains = []
    losses = []
    for i in range(1, len(window)):
        change = window[i] - window[i - 1]
        gains.append(max(change, 0.0))
        losses.append(max(-change, 0.0))
    avg_gain = sum(gains) / len(gains)
    avg_loss = sum(losses) / len(losses)
    if avg_loss == 0 and avg_gain == 0:
        return 50.0
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def score_technical(closes: list[float]) -> str:
    if len(closes) < 200:
        return "NEUTRAL"

    rsi = _rsi_14(closes)
    if rsi <= settings.rsi_oversold:
        return "OVERSOLD"

    sma_50 = _sma(closes, 50)
    sma_200 = _sma(closes, 200)
    high = max(closes)
    drawdown = (closes[-1] - high) / high

    if sma_50 > sma_200 and drawdown > -0.05:
        return "STRONG_UPTREND"
    if sma_50 < sma_200 and drawdown < -0.20:
        return "WEAK_DOWNTREND"
    return "NEUTRAL"
