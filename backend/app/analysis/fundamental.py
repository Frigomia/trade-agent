def score_fundamentals(metrics: dict[str, float | None]) -> int:
    score = 0

    peg = metrics.get("peg_ratio")
    if peg is not None:
        if peg <= 1.0:
            score += 25
        elif peg <= 2.0:
            score += 15

    roe = metrics.get("roe")
    if roe is not None:
        if roe >= 0.20:
            score += 25
        elif roe >= 0.10:
            score += 15
        elif roe >= 0.0:
            score += 5

    debt_to_equity = metrics.get("debt_to_equity")
    if debt_to_equity is not None:
        if debt_to_equity <= 0.5:
            score += 20
        elif debt_to_equity <= 1.5:
            score += 10

    revenue_growth = metrics.get("revenue_growth")
    if revenue_growth is not None:
        if revenue_growth >= 0.15:
            score += 15
        elif revenue_growth >= 0.05:
            score += 10
        elif revenue_growth >= 0.0:
            score += 5

    profit_margin = metrics.get("profit_margin")
    if profit_margin is not None:
        if profit_margin >= 0.15:
            score += 15
        elif profit_margin >= 0.05:
            score += 8

    return score
