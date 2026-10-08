"""Builds, saves and reads contribution plans. The calculation is app/planner.py; this module loads
the person's rows, prices them (app/fx.py) and turns the result into API shapes. Advice only:
nothing here talks to a broker."""

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import DataError, SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import planner
from app.db import lock_user_for_insert
from app.fx import eur_prices
from app.models import (
    ContributionPlan,
    ContributionPlanLine,
    Holding,
    InvestmentPreferences,
    Recommendation,
    WatchlistItem,
)
from app.schemas import (
    DriftItemOut,
    PlaceIn,
    PlanIn,
    PlanLineOut,
    PlanOut,
    PlanSummaryOut,
    TradeIn,
)
from app.trades import TradeRefused, apply_trade

MAX_PLANS = 120
MAX_HOLDINGS = 100  # the same cap as the holdings route


def _load(
    db: Session, user_id: uuid.UUID
) -> tuple[
    list[tuple[str, str, Decimal, float | None]],  # holdings: ticker, name, shares, target
    list[tuple[str, float | None]],  # watchlist: ticker, target
    dict[str, str],  # ticker -> newest pending call
]:
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
    held_rows = {ticker: (name, shares) for ticker, name, shares, _target in holdings}
    for ticker, name, shares, held_target in holdings:
        if held_target and held_target > 0:
            targets[ticker] = (name, shares, Decimal(str(held_target)))
    for ticker, watch_target in watch:
        if watch_target and watch_target > 0 and ticker not in targets:
            # A holding without a target takes the watchlist target; its real shares count.
            name, shares = held_rows.get(ticker, (ticker, Decimal(0)))
            targets[ticker] = (name, shares, Decimal(str(watch_target)))
    for ticker, _name, shares, _target in holdings:
        if shares > 0 and ticker not in targets:
            untargeted += 1
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
    if targets and not candidates:  # an outage: say so rather than "no target yet"
        notes.append(
            "No ticker with a target could be priced right now. Try again in a few minutes."
        )
        result = planner.Plan([], [], Decimal(0), payload.amount)
    else:
        result = planner.build_plan(candidates, payload.amount, whole_shares=payload.whole_shares)
    return PlanOut(
        amount_eur=float(payload.amount),
        whole_shares=payload.whole_shares,
        total_before_eur=float(result.total_before),
        leftover_eur=float(result.leftover),
        lines=[PlanLineOut.model_validate(line, from_attributes=True) for line in result.lines],
        notes=notes + result.notes,
    )


def _load_drift(
    db: Session, user_id: uuid.UUID
) -> tuple[list[tuple[str, str, Decimal, float | None]], float]:
    holdings = db.query(Holding).filter_by(user_id=user_id).all()
    pref = db.query(InvestmentPreferences).filter_by(user_id=user_id).one_or_none()
    return (
        [(h.ticker, h.name, Decimal(str(h.shares)), h.target_weight) for h in holdings],
        pref.drift_threshold_pct if pref else 5.0,
    )


async def drift(db: Session, user_id: uuid.UUID) -> list[DriftItemOut]:
    """Targeted open holdings whose weight is beyond the person's own drift threshold."""
    holdings, threshold = await run_in_threadpool(_load_drift, db, user_id)
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
        lock_user_for_insert(db, user_id)  # two parallel saves cannot both pass the cap
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
    except DataError:  # a number too large for its column (an absurd holding size or price)
        db.rollback()
        raise HTTPException(422, "This plan is too large to store.") from None
    except (SQLAlchemyError, HTTPException):
        db.rollback()
        raise
    # Read it back so the answer shows exactly what was stored (the columns round the numbers).
    saved = load(db, user_id, row.id)
    if saved is None:
        raise RuntimeError("A plan that was just saved could not be read back.")
    return saved


def _isins(db: Session, user_id: uuid.UUID) -> dict[str, str]:
    """ticker -> ISIN, the holding's winning over the watchlist item's; only the person's rows."""
    found: dict[str, str] = {}
    for model in (WatchlistItem, Holding):  # holdings last, so they win
        rows = db.query(model.ticker, model.isin).filter(
            model.user_id == user_id, model.isin.isnot(None)
        )
        found.update({ticker: isin for ticker, isin in rows if isin is not None})
    return found


def _out(
    row: ContributionPlan, lines: list[ContributionPlanLine], isins: dict[str, str]
) -> PlanOut:
    return PlanOut(
        id=row.id,
        created_at=row.created_at,
        amount_eur=float(row.amount_eur),
        whole_shares=row.whole_shares,
        total_before_eur=float(row.total_before_eur),
        leftover_eur=float(row.leftover_eur),
        lines=[
            PlanLineOut.model_validate(ln, from_attributes=True).model_copy(
                update={"isin": isins.get(ln.ticker)}
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
    return _out(row, lines, _isins(db, user_id))


def load_all(db: Session, user_id: uuid.UUID) -> list[PlanOut]:
    """Every saved plan, newest first: one query for the plans and one for all their lines."""
    rows = (
        db.query(ContributionPlan)
        .filter_by(user_id=user_id)
        .order_by(ContributionPlan.id.desc())
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
    isins = _isins(db, user_id)  # once, not per plan
    return [_out(r, by_plan.get(r.id, []), isins) for r in rows]


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


def place_line(
    db: Session, user_id: uuid.UUID, plan_id: int, line_id: int, payload: PlaceIn
) -> PlanLineOut:
    """Records that the person placed this line's order in their broker: creates the holding when
    it is new, logs a BUY through the shared trade code, stamps the line. One transaction."""
    try:
        lock_user_for_insert(db, user_id)  # a double click or a second tab cannot place it twice
        line = (
            db.query(ContributionPlanLine)
            .filter_by(id=line_id, plan_id=plan_id, user_id=user_id)
            .one_or_none()
        )
        if line is None:
            raise HTTPException(404, "Plan line not found")
        if line.placed_at is not None:
            raise HTTPException(409, "This line is already recorded as placed.")
        holding = db.query(Holding).filter_by(user_id=user_id, ticker=line.ticker).one_or_none()
        if holding is None:
            if payload.asset_type is None:
                raise HTTPException(422, "asset_type is required for a new position.")
            if db.query(Holding).filter_by(user_id=user_id).count() >= MAX_HOLDINGS:
                raise HTTPException(
                    409,
                    f"You can keep up to {MAX_HOLDINGS} holdings. Remove one first.",
                )
            holding = Holding(
                user_id=user_id,
                ticker=line.ticker,
                name=line.name,
                asset_type=payload.asset_type,
                shares=0,
                cost_basis=0,
                first_purchase_date=payload.date,
            )
            db.add(holding)
        trade = apply_trade(
            db,
            user_id,
            holding,
            TradeIn(
                date=payload.date,
                ticker=line.ticker,
                action="BUY",
                shares=payload.shares,
                price=payload.price,
            ),
        )
        db.flush()  # assigns trade.id
        line.placed_at = datetime.now(UTC).replace(tzinfo=None)
        line.placed_trade_id = trade.id
        db.commit()
    except TradeRefused as exc:
        db.rollback()
        raise HTTPException(422, str(exc)) from None
    except DataError:
        db.rollback()
        raise HTTPException(422, "Those numbers are too large to store.") from None
    except (SQLAlchemyError, HTTPException):
        db.rollback()
        raise
    db.refresh(line)
    return PlanLineOut.model_validate(line, from_attributes=True).model_copy(
        update={"isin": _isins(db, user_id).get(line.ticker)}
    )
