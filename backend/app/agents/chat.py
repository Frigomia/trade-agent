from sqlalchemy.orm import Session

from app.config import settings
from app.models import Holding, Recommendation, WatchlistItem

RECENT_RECOMMENDATIONS_LIMIT = 10


async def build_portfolio_context(db: Session) -> str:
    holdings = (
        db.query(Holding).filter(Holding.user_id == settings.default_user_id).all()
    )
    watchlist = (
        db.query(WatchlistItem)
        .filter(WatchlistItem.user_id == settings.default_user_id)
        .all()
    )
    recent_recs = (
        db.query(Recommendation)
        .filter(Recommendation.user_id == settings.default_user_id)
        .order_by(Recommendation.created_at.desc())
        .limit(RECENT_RECOMMENDATIONS_LIMIT)
        .all()
    )

    lines = ["## Holdings"]
    if holdings:
        for h in holdings:
            weight = f"{h.target_weight:.0%}" if h.target_weight is not None else "unset"
            lines.append(f"- {h.ticker}: {h.shares} shares, cost basis {h.cost_basis}, target weight {weight}")
    else:
        lines.append("No holdings.")

    lines.append("\n## Watchlist")
    if watchlist:
        for w in watchlist:
            lines.append(f"- {w.ticker} ({w.asset_type})")
    else:
        lines.append("No watchlist items.")

    lines.append("\n## Recent recommendations")
    if recent_recs:
        for r in recent_recs:
            reasoning = "; ".join(r.reasoning)
            lines.append(f"- {r.ticker}: {r.action}. {reasoning}")
    else:
        lines.append("No recent recommendations.")

    return "\n".join(lines)
