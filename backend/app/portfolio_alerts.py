"""What on a holding is worth a look today: a pending call, upcoming earnings, a big move.

Pure functions over facts already read; the router does the reading (database and quotes) and this
module only decides. Alert text states a fact or a prior call and never carries an amount of money.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from app.schemas import PortfolioAlertOut

MOVE_THRESHOLD_PCT = 5.0  # an absolute move against the purchase cost, in percent
EARNINGS_WINDOW_DAYS = 7
MAX_PER_KIND = 10  # earnings and moves; a waiting decision is never cut


@dataclass(frozen=True)
class HoldingFacts:
    ticker: str
    name: str
    cost_basis: float | None  # per share; None when the purchase cost is unknown
    price: float | None  # live; None when the quote failed
    earnings: date | None


@dataclass(frozen=True)
class PendingCall:
    id: int
    ticker: str
    action: str


def _earnings_text(days: int) -> str:
    if days == 0:
        return "Earnings today"
    return "Earnings tomorrow" if days == 1 else f"Earnings in {days} days"


def build_alerts(
    holdings: Sequence[HoldingFacts], calls: Sequence[PendingCall], today: date
) -> list[PortfolioAlertOut]:
    """Alerts for the holdings: one per pending call, then at most ten earnings and ten moves.

    The order is the order on screen: a decision waiting first, then what is coming (soonest
    first), then what has moved (largest first). Calls are listed once per ticker (the newest;
    `calls` arrive newest first), and none is dropped for the cap.
    """
    names = {h.ticker: h.name for h in holdings}
    newest = {c.ticker: c for c in reversed(calls)}  # later (newer) calls overwrite older ones
    alerts = [
        PortfolioAlertOut(
            ticker=c.ticker,
            name=names.get(c.ticker),
            kind="new_recommendation",
            text=f"New AI recommendation: {c.action}",
            recommendation_id=c.id,
        )
        for c in calls
        if newest[c.ticker] is c
    ]

    coming: list[tuple[int, HoldingFacts]] = []
    for h in holdings:
        if h.earnings is not None and 0 <= (h.earnings - today).days <= EARNINGS_WINDOW_DAYS:
            coming.append(((h.earnings - today).days, h))
    for days, h in sorted(coming, key=lambda c: c[0])[:MAX_PER_KIND]:
        alerts.append(
            PortfolioAlertOut(
                ticker=h.ticker,
                name=h.name,
                kind="earnings_upcoming",
                text=_earnings_text(days),
                when=h.earnings,
            )
        )

    moves: list[tuple[float, HoldingFacts]] = []
    for h in holdings:
        if h.cost_basis is None or h.cost_basis <= 0 or h.price is None:
            continue
        pct = (h.price - h.cost_basis) / h.cost_basis * 100
        if abs(pct) >= MOVE_THRESHOLD_PCT:
            moves.append((pct, h))
    for pct, h in sorted(moves, key=lambda m: -abs(m[0]))[:MAX_PER_KIND]:
        word = "Up" if pct > 0 else "Down"
        text = f"{word} {abs(pct):.1f}% on your purchase cost"
        alerts.append(
            PortfolioAlertOut(ticker=h.ticker, name=h.name, kind="move_since_purchase", text=text)
        )

    return alerts
