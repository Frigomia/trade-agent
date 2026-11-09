"""What replaced a superseded discovery idea, or why it was withdrawn.

Read-only lookups for GET /analysis/recommendations/{id}; nothing here writes.
"""

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models import CompanyAnalysis, Recommendation, ScanRun
from app.schemas import WithdrawalOut


def successor_id(db: Session, rec: Recommendation) -> int | None:
    """The newest discovery idea for the same company saved after this one, in any status."""
    if rec.status != "SUPERSEDED" or rec.source != "discovery":
        return None
    newest = (
        db.query(Recommendation.id)
        .filter(
            Recommendation.user_id == rec.user_id,
            Recommendation.ticker == rec.ticker,
            Recommendation.source == "discovery",
            Recommendation.idea.is_not(None),
            Recommendation.id > rec.id,
        )
        .order_by(Recommendation.id.desc())
        .first()
    )
    return newest[0] if newest is not None else None


def _dicts(value: object) -> list[dict[str, Any]]:
    """The dict elements of a stored JSON list; anything malformed counts as absent, because a
    read-only lookup must never fail the page over a bad stored element."""
    return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []


def withdrawal_for(db: Session, rec: Recommendation) -> WithdrawalOut | None:
    """Why a superseded idea with no successor was withdrawn; None for any other row.

    Looks for saved evidence newer than the idea and takes the latest. With none, the answer is a
    generic "not compelling" without a date: the system never invents a reason.
    """
    if rec.status != "SUPERSEDED" or rec.source != "discovery":
        return None
    # (a) and (c): the newest scan after the idea that excluded the company as invalidated, and
    # the newest that set it aside. ponytail: JSON is filtered in Python; one user has a few
    # scans a week, so add a SQL JSON filter only if scans ever pile up.
    # Each answer comes with its date, so choosing the newest never compares a missing one.
    invalidated: tuple[datetime, WithdrawalOut] | None = None
    set_aside: tuple[datetime, WithdrawalOut] | None = None
    scans = (
        db.query(ScanRun)
        .filter(ScanRun.user_id == rec.user_id, ScanRun.created_at > rec.created_at)
        .order_by(ScanRun.created_at.desc())
    )
    for scan in scans:
        if invalidated is None:
            for entry in _dicts(scan.excluded):
                is_it = entry.get("ticker") == rec.ticker
                if is_it and entry.get("reason") == "thesis_invalidated":
                    invalidated = (
                        scan.created_at,
                        WithdrawalOut(
                            kind="invalidated",
                            reason=entry.get("explanation") or None,
                            as_of=scan.created_at,
                        ),
                    )
                    break
        if set_aside is None:
            summary = scan.coverage_summary
            ideas = _dicts(summary.get("set_aside_ideas") if isinstance(summary, dict) else None)
            if any(i.get("ticker") == rec.ticker for i in ideas):
                set_aside = (
                    scan.created_at,
                    WithdrawalOut(kind="not_compelling", reason=None, as_of=scan.created_at),
                )
        if invalidated is not None and set_aside is not None:
            break

    # (b): the newest researched "no opportunity" answer for the company.
    analysis = (
        db.query(CompanyAnalysis)
        .filter(
            CompanyAnalysis.user_id == rec.user_id,
            CompanyAnalysis.ticker == rec.ticker,
            CompanyAnalysis.status == "no_opportunity",
            CompanyAnalysis.researched.is_(True),
            CompanyAnalysis.created_at > rec.created_at,
        )
        .order_by(CompanyAnalysis.created_at.desc())
        .first()
    )
    researched: tuple[datetime, WithdrawalOut] | None = None
    if analysis is not None:
        analysed_at = analysis.finished_at or analysis.created_at
        researched = (
            analysed_at,
            WithdrawalOut(kind="not_compelling", reason=analysis.reason, as_of=analysed_at),
        )

    # In tie order (a, b, c); max() keeps the first of equal dates.
    candidates = [c for c in (invalidated, researched, set_aside) if c is not None]
    if not candidates:
        return WithdrawalOut(kind="not_compelling", reason=None, as_of=None)
    return max(candidates, key=lambda c: c[0])[1]
