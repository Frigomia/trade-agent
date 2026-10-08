"""Builds, saves and reads contribution plans. The calculation is app/planner.py; this module loads
the person's rows, prices them (app/fx.py) and turns the result into API shapes. Advice only:
nothing here talks to a broker."""

import uuid
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import planner
from app.fx import eur_prices
from app.models import (
    ContributionPlan,
    ContributionPlanLine,
    Holding,
    InvestmentPreferences,
    Recommendation,
    WatchlistItem,
)
from app.schemas import DriftItemOut, PlanIn, PlanLineOut, PlanOut, PlanSummaryOut

DISCLAIMER = "Advisory only. Nothing is sent to a broker."
MAX_PLANS = 120
MAX_AMOUNT = 1_000_000
REASON_TEXT = {
    "new_position": "A new position that starts at 0 %",
    "underweight": "Below its target weight",
    "favoured": "Below its target, and its newest call is ADD or BUY",
    "remainder": "Extra money shared by target weight",
}

# holdings (ticker, name, shares, target), watchlist (ticker, target), ticker -> newest call
_Loaded = tuple[
    list[tuple[str, str, Decimal, float | None]],
    list[tuple[str, float | None]],
    dict[str, str],
]


def _load(db: Session, user_id: uuid.UUID) -> _Loaded:
    holdings = db.query(Holding).filter_by(user_id=user_id).all()
    watch = db.query(WatchlistItem).filter_by(user_id=user_id).all()
    targeted = {h.ticker for h in holdings if h.target_weight} | {
        w.ticker for w in watch if w.target_weight
    }
    calls: dict[str, str] = {}
    rows = (
        db.query(Recommendation.ticker, Recommendation.action)
        .filter(
            Recommendation.user_id == user_id,
            Recommendation.status == "PENDING",
            Recommendation.ticker.in_(targeted or [""]),
        )
        .order_by(Recommendation.created_at.desc(), Recommendation.id.desc())
        .all()
    )
    for ticker, action in rows:  # newest first: keep the first one per ticker
        calls.setdefault(ticker, action)
    return (
        [(h.ticker, h.name, Decimal(str(h.shares)), h.target_weight) for h in holdings],
        [(w.ticker, w.target_weight) for w in watch],
        calls,
    )


async def compute(db: Session, user_id: uuid.UUID, payload: PlanIn) -> PlanOut:
    """Builds the plan from the person's own rows; saves nothing."""
    holdings, watch, calls = await run_in_threadpool(_load, db, user_id)
    # Release the connection before the (possibly slow) price lookups. The session keeps its
    # user scope (session.info) and starts a new scoped transaction if it is used again.
    db.close()

    notes: list[str] = []
    targets: dict[str, tuple[str, Decimal, Decimal]] = {}  # ticker -> (name, shares, target)
    untargeted = 0
    for ticker, name, shares, held_target in holdings:
        if held_target and held_target > 0:
            targets[ticker] = (name, shares, Decimal(str(held_target)))
        elif shares > 0:
            untargeted += 1
    for ticker, watch_target in watch:
        if watch_target and watch_target > 0 and ticker not in targets:
            targets[ticker] = (ticker, Decimal(0), Decimal(str(watch_target)))
    if untargeted:
        one = untargeted == 1
        notes.append(
            f"{untargeted} {'holding has' if one else 'holdings have'} no target weight "
            f"and {'is' if one else 'are'} left out of the plan."
        )

    prices, skipped = await eur_prices(set(targets))
    notes += [skipped[t] for t in sorted(skipped)]

    candidates = []
    for ticker, (name, shares, weight) in targets.items():
        price = prices.get(ticker)
        if price is None:
            continue
        candidates.append(
            planner.Candidate(
                ticker=ticker,
                name=name,
                held=shares > 0,
                current_value=shares * price.price_eur,
                target=weight,
                price_eur=price.price_eur,
                currency=price.currency,
                rate=price.rate,
                call=calls.get(ticker),
            )
        )
    result = planner.build_plan(
        candidates, Decimal(str(payload.amount)), whole_shares=payload.whole_shares
    )
    return PlanOut(
        amount_eur=payload.amount,
        whole_shares=payload.whole_shares,
        total_before_eur=float(result.total_before),
        leftover_eur=float(result.leftover),
        lines=[
            PlanLineOut(
                ticker=line.ticker,
                name=line.name,
                amount_eur=float(line.amount_eur),
                shares=float(line.shares),
                price_eur=float(line.price_eur),
                currency=line.currency,
                rate=float(line.rate),
                weight_before=None if line.weight_before is None else float(line.weight_before),
                weight_after=None if line.weight_after is None else float(line.weight_after),
                reason=line.reason,
                reason_text=REASON_TEXT[line.reason],
            )
            for line in result.lines
        ],
        notes=notes + result.notes,
    )


def _load_drift(db: Session, user_id: uuid.UUID) -> tuple[_Loaded, float]:
    pref = db.query(InvestmentPreferences).filter_by(user_id=user_id).one_or_none()
    return _load(db, user_id), pref.drift_threshold_pct if pref else 5.0


async def drift(db: Session, user_id: uuid.UUID) -> list[DriftItemOut]:
    """Targeted open holdings whose weight is beyond the person's own drift threshold."""
    (holdings, _watch, _calls), threshold = await run_in_threadpool(_load_drift, db, user_id)
    db.close()  # release the connection before the price lookups, as compute() does
    targets = {
        t: (name, shares, Decimal(str(target)))
        for t, name, shares, target in holdings
        if shares > 0 and target and target > 0
    }
    prices, _skipped = await eur_prices(set(targets))
    candidates = [
        planner.Candidate(
            ticker=t,
            name=name,
            held=True,
            current_value=shares * prices[t].price_eur,
            target=target,
            price_eur=prices[t].price_eur,
            currency=prices[t].currency,
            rate=prices[t].rate,
        )
        for t, (name, shares, target) in targets.items()
        if t in prices
    ]
    return [
        DriftItemOut(
            ticker=i.ticker,
            name=i.name,
            weight=float(i.weight),
            target=float(i.target),
            points=float(i.points),
        )
        for i in planner.drift_items(candidates, Decimal(str(threshold)))
    ]


def save(db: Session, user_id: uuid.UUID, plan: PlanOut) -> PlanOut:
    """Stores a plan the server just computed, with its lines, in one transaction."""
    try:
        count = db.query(func.count(ContributionPlan.id)).filter_by(user_id=user_id).scalar()
        if (count or 0) >= MAX_PLANS:
            raise HTTPException(
                409,
                f"You can keep up to {MAX_PLANS} saved plans. Delete one before saving another.",
            )
        row = ContributionPlan(
            user_id=user_id,
            amount_eur=plan.amount_eur,
            whole_shares=plan.whole_shares,
            total_before_eur=plan.total_before_eur,
            leftover_eur=plan.leftover_eur,
            notes=plan.notes,
        )
        db.add(row)
        db.flush()  # assigns row.id for the lines
        db.add_all(
            ContributionPlanLine(
                user_id=user_id,
                plan_id=row.id,
                ticker=line.ticker,
                name=line.name,
                amount_eur=line.amount_eur,
                shares=line.shares,
                price_eur=line.price_eur,
                currency=line.currency,
                rate=line.rate,
                weight_before=line.weight_before,
                weight_after=line.weight_after,
                reason=line.reason,
            )
            for line in plan.lines
        )
        db.commit()
    except (SQLAlchemyError, HTTPException):
        db.rollback()
        raise
    # Read it back so the answer shows exactly what was stored (the columns round the numbers).
    saved = load(db, user_id, row.id)
    assert saved is not None
    return saved


def _out(row: ContributionPlan, lines: list[ContributionPlanLine]) -> PlanOut:
    return PlanOut(
        id=row.id,
        created_at=row.created_at,
        amount_eur=float(row.amount_eur),
        whole_shares=row.whole_shares,
        total_before_eur=float(row.total_before_eur),
        leftover_eur=float(row.leftover_eur),
        lines=[
            PlanLineOut(
                ticker=ln.ticker,
                name=ln.name,
                amount_eur=float(ln.amount_eur),
                shares=float(ln.shares),
                price_eur=float(ln.price_eur),
                currency=ln.currency,
                rate=float(ln.rate),
                weight_before=None if ln.weight_before is None else float(ln.weight_before),
                weight_after=None if ln.weight_after is None else float(ln.weight_after),
                reason=ln.reason,
                reason_text=REASON_TEXT.get(ln.reason, ""),
            )
            for ln in lines
        ],
        notes=list(row.notes or []),
    )


def load(db: Session, user_id: uuid.UUID, plan_id: int) -> PlanOut | None:
    row = db.query(ContributionPlan).filter_by(id=plan_id, user_id=user_id).one_or_none()
    if row is None:
        return None
    lines = (
        db.query(ContributionPlanLine)
        .filter_by(plan_id=plan_id, user_id=user_id)
        .order_by(ContributionPlanLine.id)
        .all()
    )
    return _out(row, lines)


def load_all(db: Session, user_id: uuid.UUID) -> list[PlanOut]:
    """Every saved plan, newest first: one query for the plans and one for all their lines."""
    rows = (
        db.query(ContributionPlan)
        .filter_by(user_id=user_id)
        .order_by(ContributionPlan.id.desc())
        .limit(MAX_PLANS)
        .all()
    )
    by_plan: dict[int, list[ContributionPlanLine]] = {}
    lines = (
        db.query(ContributionPlanLine)
        .filter(
            ContributionPlanLine.user_id == user_id,
            ContributionPlanLine.plan_id.in_([r.id for r in rows] or [0]),
        )
        .order_by(ContributionPlanLine.id)
        .all()
    )
    for line in lines:
        by_plan.setdefault(line.plan_id, []).append(line)
    return [_out(r, by_plan.get(r.id, [])) for r in rows]


def list_summaries(db: Session, user_id: uuid.UUID) -> list[PlanSummaryOut]:
    counts = dict(
        db.query(ContributionPlanLine.plan_id, func.count(ContributionPlanLine.id))
        .filter(ContributionPlanLine.user_id == user_id)
        .group_by(ContributionPlanLine.plan_id)
        .all()
    )
    rows = (
        db.query(ContributionPlan)
        .filter_by(user_id=user_id)
        .order_by(ContributionPlan.id.desc())
        .all()
    )
    return [
        PlanSummaryOut(
            id=r.id,
            created_at=r.created_at,
            amount_eur=float(r.amount_eur),
            line_count=counts.get(r.id, 0),
        )
        for r in rows
    ]


def delete(db: Session, user_id: uuid.UUID, plan_id: int) -> bool:
    """Removes the lines, then the plan, in one transaction. False when it is not the caller's."""
    try:
        row = db.query(ContributionPlan).filter_by(id=plan_id, user_id=user_id).one_or_none()
        if row is None:
            return False
        db.query(ContributionPlanLine).filter_by(plan_id=plan_id, user_id=user_id).delete()
        db.delete(row)
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise
    return True
