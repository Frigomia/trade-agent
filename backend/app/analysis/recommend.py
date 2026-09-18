from app.config import settings


def synthesize(
    asset_type: str,
    is_held: bool,
    fundamental_score: int | None,
    technical_signal: str,
) -> tuple[str | None, float | None, list[str]]:
    reasoning: list[str] = []
    if fundamental_score is not None:
        reasoning.append(f"Fundamental score {fundamental_score}/100")
    reasoning.append(f"Technical signal: {technical_signal}")

    action: str | None
    if asset_type == "STOCK":
        gated = (
            fundamental_score is not None
            and fundamental_score >= settings.fundamental_buy_threshold
        )
        if gated:
            if is_held:
                action = "ADD" if technical_signal == "OVERSOLD" else "HOLD"
            else:
                action = "BUY" if technical_signal == "OVERSOLD" else "WATCH"
        else:
            if fundamental_score is None:
                action = None
            elif is_held:
                action = "SELL" if fundamental_score < 40 else "TRIM"
            else:
                action = "WATCH" if fundamental_score >= 40 else None
    else:  # ETF
        if is_held:
            if technical_signal == "OVERSOLD":
                action = "ADD"
            elif technical_signal == "WEAK_DOWNTREND":
                action = "TRIM"
            else:
                action = "HOLD"
        else:
            action = "BUY" if technical_signal in ("OVERSOLD", "STRONG_UPTREND") else "WATCH"

    if action is None:
        return None, None, []

    suggested_position_pct: float | None = None
    if action in ("BUY", "ADD"):
        strong_conviction = (fundamental_score is not None and fundamental_score >= 80) or (
            asset_type == "ETF" and technical_signal == "OVERSOLD"
        )
        suggested_position_pct = (
            settings.max_single_position_pct
            if strong_conviction
            else settings.max_single_position_pct / 2
        )

    return action, suggested_position_pct, reasoning
