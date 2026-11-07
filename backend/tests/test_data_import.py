import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from decimal import Decimal
from threading import Barrier
from unittest.mock import patch

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import DataError

from app import rls
from app.data_import import (
    AI_OUTPUT_TABLES,
    DATA_LABELS,
    DATA_TABLES,
    RESTORED_TABLES,
    SETTINGS_TABLES,
    ImportRefused,
    require_empty_account,
    restore_data,
)
from app.db import Base, open_user_session
from app.models import (
    ContributionPlan,
    ContributionPlanLine,
    Holding,
    InvestmentPreferences,
    PortfolioSnapshot,
    RecurringInvestment,
    RecurringOccurrence,
    Trade,
    WatchlistItem,
)
from app.schemas_import import ImportFile
from app.user_data import delete_user_data
from tests.auth_support import ROW_FACTORIES, USER_ID, add_app_user
from tests.test_schemas_import import seed_one_of_everything


def test_every_user_table_is_classified():
    # Fails when a new user table ships without being classified as data, AI output or settings.
    groups = [set(DATA_TABLES), set(AI_OUTPUT_TABLES), set(SETTINGS_TABLES)]
    assert set().union(*groups) == set(rls.USER_TABLES)
    assert sum(len(group) for group in groups) == len(rls.USER_TABLES)  # no overlap


def test_restored_tables_are_known():
    assert set(RESTORED_TABLES) == set(DATA_TABLES) | {"investment_preferences"}


def test_a_fresh_account_is_empty(db_session):
    add_app_user(db_session)
    require_empty_account(db_session, USER_ID)


def test_settings_do_not_count_as_data(db_session):
    add_app_user(db_session)
    for table in SETTINGS_TABLES:
        db_session.add(ROW_FACTORIES[table](USER_ID))
    db_session.commit()
    require_empty_account(db_session, USER_ID)


@pytest.mark.parametrize("table", AI_OUTPUT_TABLES)
def test_ai_output_does_not_block_an_import(db_session, table):
    add_app_user(db_session)
    db_session.add(ROW_FACTORIES[table](USER_ID))
    db_session.commit()
    require_empty_account(db_session, USER_ID)


@pytest.mark.parametrize("table", DATA_TABLES)
def test_each_data_table_makes_the_account_non_empty(db_session, table):
    add_app_user(db_session)
    db_session.add(ROW_FACTORIES[table](USER_ID))
    db_session.commit()

    with pytest.raises(ImportRefused) as refused:
        require_empty_account(db_session, USER_ID)

    assert refused.value.status_code == 409
    assert "already has data" in refused.value.message
    assert DATA_LABELS[table] in refused.value.message


FILE_USER_ID = "00000000-0000-0000-0000-0000000000ff"


def _file(**overrides) -> ImportFile:
    data = {
        "holdings": [
            {
                "id": 41,
                "user_id": FILE_USER_ID,
                "ticker": "VWCE.DE",
                "name": "Vanguard All-World",
                "asset_type": "ETF",
                "shares": 10,
                "cost_basis": 1000,
                "first_purchase_date": "2024-01-02",
                "target_weight": 0.6,
                "sector": "Diversified",
                "isin": "IE00BK5BQT80",
            }
        ],
        "watchlist_items": [
            {
                "id": 7,
                "ticker": "ASML.AS",
                "asset_type": "STOCK",
                "note": "wait",
                "target_price_low": 600,
                "target_price_high": 700,
                "name": "ASML",
                "source": "today",
                "created_at": "2026-03-04T05:06:07",
            }
        ],
        "trades": [
            {
                "id": 9,
                "date": "2024-01-02",
                "ticker": "VWCE.DE",
                "action": "BUY",
                "shares": 1,
                "price": 100,
            },
            {
                "id": 12,
                "date": "2024-02-02",
                "ticker": "VWCE.DE",
                "action": "BUY",
                "shares": 2,
                "price": 110,
            },
        ],
        "portfolio_snapshots": [
            {
                "id": 3,
                "created_at": "2025-05-06T07:08:09",
                "total_market_value": 1234.5,
                "total_cost_basis": 1000,
                "cost_basis_complete": False,
            }
        ],
        "investment_preferences": {
            "risk_tolerance": "moderate",
            "sector_avoid_list": ["Energy"],
            "notes": "long term",
            "auto_analysis": True,
            "auto_discovery": True,
            "monthly_contribution": 250,
            "drift_threshold_pct": 8,
        },
    }
    data.update(overrides)
    return ImportFile.model_validate(data)


def _count(db, model) -> int:
    return db.scalar(select(func.count()).select_from(model))


def _all_restored_tables_empty(db) -> bool:
    return all(_count(db, Base.metadata.tables[name]) == 0 for name in RESTORED_TABLES)


def test_restores_holdings_watchlist_trades_and_snapshots(db_session):
    add_app_user(db_session)

    result = restore_data(db_session, USER_ID, _file(), dry_run=False)

    assert result.dry_run is False
    assert result.restored == {
        "holdings": 1,
        "watchlist_items": 1,
        "trades": 2,
        "contribution_plans": 0,
        "recurring_investments": 0,
        "recurring_occurrences": 0,
        "portfolio_snapshots": 1,
        "investment_preferences": 1,
    }
    assert result.next_steps == ["Connect Claude again.", "Connect Telegram again."]
    holding = db_session.scalars(select(Holding)).one()
    assert (holding.user_id, holding.ticker, holding.name, holding.asset_type) == (
        USER_ID,
        "VWCE.DE",
        "Vanguard All-World",
        "ETF",
    )
    assert holding.first_purchase_date == date(2024, 1, 2)
    assert holding.isin == "IE00BK5BQT80"
    assert float(holding.target_weight) == 0.6
    item = db_session.scalars(select(WatchlistItem)).one()
    assert (item.user_id, item.ticker, item.source, item.name) == (
        USER_ID,
        "ASML.AS",
        "today",
        "ASML",
    )
    assert item.created_at == datetime(2026, 3, 4, 5, 6, 7)
    assert (float(item.target_price_low), float(item.target_price_high)) == (600, 700)
    trades = db_session.scalars(select(Trade).order_by(Trade.date)).all()
    assert [(t.user_id, t.action, float(t.shares), float(t.price)) for t in trades] == [
        (USER_ID, "BUY", 1, 100),
        (USER_ID, "BUY", 2, 110),
    ]
    snap = db_session.scalars(select(PortfolioSnapshot)).one()
    assert snap.created_at == datetime(2025, 5, 6, 7, 8, 9)
    assert (float(snap.total_market_value), snap.cost_basis_complete) == (1234.5, False)


def test_the_file_user_id_and_ids_are_ignored(db_session):
    add_app_user(db_session)

    restore_data(db_session, USER_ID, _file(), dry_run=False)

    for model in (Holding, WatchlistItem, Trade, PortfolioSnapshot):
        rows = db_session.scalars(select(model)).all()
        assert rows
        assert {r.user_id for r in rows} == {USER_ID}
    assert {t.id for t in db_session.scalars(select(Trade))}.isdisjoint({9, 12})


def test_holdings_and_trades_are_copied_not_replayed(db_session):
    add_app_user(db_session)
    # The two trades would imply 3 shares; the holding says 10, and the holding is kept as it is.
    restore_data(db_session, USER_ID, _file(), dry_run=False)

    holding = db_session.scalars(select(Holding)).one()
    assert float(holding.shares) == 10
    assert float(holding.cost_basis) == 1000
    assert _count(db_session, Trade) == 2


def test_preferences_restored_with_automatic_runs_off(db_session):
    add_app_user(db_session)

    result = restore_data(db_session, USER_ID, _file(), dry_run=False)

    prefs = db_session.scalars(select(InvestmentPreferences)).one()
    assert prefs.user_id == USER_ID
    assert (prefs.auto_analysis, prefs.auto_discovery) == (False, False)
    assert (prefs.risk_tolerance, prefs.sector_avoid_list, prefs.notes) == (
        "moderate",
        ["Energy"],
        "long term",
    )
    assert (prefs.monthly_contribution, float(prefs.drift_threshold_pct)) == (Decimal("250"), 8)
    assert result.skipped == [
        "Automatic analysis and automatic discovery were left off. "
        "Turn them on again in Preferences if you want them."
    ]


def test_preferences_without_switches_on_add_no_skipped_note(db_session):
    add_app_user(db_session)
    file = _file(investment_preferences={"risk_tolerance": "moderate"})

    result = restore_data(db_session, USER_ID, file, dry_run=False)

    assert result.skipped == []
    prefs = db_session.scalars(select(InvestmentPreferences)).one()
    assert float(prefs.drift_threshold_pct) == 5.0


def test_existing_preferences_are_kept(db_session):
    add_app_user(db_session)
    db_session.add(
        InvestmentPreferences(user_id=USER_ID, risk_tolerance="aggressive", notes="mine")
    )
    db_session.commit()

    result = restore_data(db_session, USER_ID, _file(), dry_run=False)

    prefs = db_session.scalars(select(InvestmentPreferences)).one()
    assert (prefs.risk_tolerance, prefs.notes) == ("aggressive", "mine")
    assert result.restored["investment_preferences"] == 0
    assert result.skipped == ["Your current preferences were kept."]


def test_a_dry_run_writes_nothing_and_returns_the_counts(db_session):
    add_app_user(db_session)

    result = restore_data(db_session, USER_ID, _file(), dry_run=True)

    assert result.dry_run is True
    assert result.restored["trades"] == 2
    assert result.restored["holdings"] == 1
    assert _all_restored_tables_empty(db_session)


def test_a_failure_part_way_leaves_the_account_empty(db_session):
    add_app_user(db_session)

    with (
        patch("app.data_import._restore_snapshots", side_effect=RuntimeError("boom")),
        pytest.raises(RuntimeError),
    ):
        restore_data(db_session, USER_ID, _file(), dry_run=False)

    assert _all_restored_tables_empty(db_session)


def test_a_non_empty_account_is_refused_before_any_write(db_session):
    add_app_user(db_session)
    db_session.add(ROW_FACTORIES["trades"](USER_ID))
    db_session.commit()

    with pytest.raises(ImportRefused) as refused:
        restore_data(db_session, USER_ID, _file(), dry_run=False)

    assert refused.value.status_code == 409
    assert _count(db_session, Holding) == 0
    assert _count(db_session, InvestmentPreferences) == 0


def test_restore_logs_only_counts(db_session, caplog):
    add_app_user(db_session)

    with caplog.at_level(logging.INFO, logger="app.data_import"):
        restore_data(db_session, USER_ID, _file(), dry_run=False)

    lines = [r.getMessage() for r in caplog.records if r.name == "app.data_import"]
    assert len(lines) == 1
    assert "trades=2" in lines[0]
    assert "VWCE" not in lines[0]
    assert str(USER_ID) not in lines[0]


def _linked_file() -> ImportFile:
    """Two trades, two saved plans (one line placed on trade 9), an active and a paused recurring
    plan, and a confirmed (trade 12), a scheduled and a skipped occurrence."""
    line = {
        "ticker": "VWCE.DE",
        "name": "Vanguard All-World",
        "amount_eur": 100,
        "shares": 1,
        "price_eur": 100,
        "currency": "EUR",
        "rate": 1,
        "reason": "underweight",
    }
    return _file(
        contribution_plans=[
            {
                "id": 77,
                "created_at": "2026-04-05T06:07:08",
                "amount_eur": 500,
                "whole_shares": True,
                "total_before_eur": 1000,
                "leftover_eur": 2.5,
                "notes": ["a note"],
                "left_out": [{"ticker": "X", "name": "X Co", "kind": "stock", "reason": "no data"}],
                "lines": [
                    {**line, "placed_trade_id": 9, "placed_at": "2026-04-06T01:02:03"},
                    {**line, "ticker": "ASML.AS", "weight_before": 0.1, "target_weight": 0.2},
                ],
            },
            {
                "id": 5,
                "amount_eur": 50,
                "whole_shares": False,
                "total_before_eur": 0,
                "leftover_eur": 0,
                "lines": [line],
            },
        ],
        recurring_investments=[
            {
                "id": 30,
                "name": "Employer plan",
                "ticker": "VWCE.DE",
                "asset_type": "ETF",
                "amount": 400,
                "currency": "EUR",
                "start_date": "2026-01-31",
                "next_date": "2026-04-30",
                "status": "active",
            },
            {
                "id": 31,
                "name": "Old plan",
                "ticker": "ASML.AS",
                "asset_type": "STOCK",
                "amount": 50,
                "currency": "EUR",
                "start_date": "2025-05-15",
                "status": "paused",
            },
        ],
        recurring_occurrences=[
            {
                "plan_id": 30,
                "scheduled_date": "2026-03-31",
                "ticker": "VWCE.DE",
                "asset_type": "ETF",
                "amount": 400,
                "currency": "EUR",
                "status": "confirmed",
                "trade_id": 12,
            },
            {
                "plan_id": 30,
                "scheduled_date": "2026-02-28",
                "ticker": "VWCE.DE",
                "asset_type": "ETF",
                "amount": 400,
                "currency": "EUR",
                "status": "scheduled",
            },
            {
                "plan_id": 31,
                "scheduled_date": "2026-02-28",
                "ticker": "ASML.AS",
                "asset_type": "STOCK",
                "amount": 50,
                "currency": "EUR",
                "status": "skipped",
            },
        ],
    )


def _trade_id(db, shares: float) -> int:
    return db.scalars(select(Trade.id).where(Trade.shares == shares)).one()


def test_plans_and_their_lines_are_restored_with_new_ids(db_session):
    add_app_user(db_session)

    result = restore_data(db_session, USER_ID, _linked_file(), dry_run=False)

    assert result.restored["contribution_plans"] == 2
    plans = db_session.scalars(select(ContributionPlan).order_by(ContributionPlan.id)).all()
    assert {p.user_id for p in plans} == {USER_ID}
    assert {p.id for p in plans}.isdisjoint({77, 5})
    big = next(p for p in plans if p.whole_shares)
    assert big.created_at == datetime(2026, 4, 5, 6, 7, 8)
    assert (float(big.amount_eur), float(big.total_before_eur), float(big.leftover_eur)) == (
        500,
        1000,
        2.5,
    )
    assert big.notes == ["a note"]
    assert big.left_out == [{"ticker": "X", "name": "X Co", "kind": "stock", "reason": "no data"}]
    lines = db_session.scalars(select(ContributionPlanLine)).all()
    assert len(lines) == 3  # counted with their plans, no separate key
    assert {ln.user_id for ln in lines} == {USER_ID}
    by_plan = {p.id: [ln for ln in lines if ln.plan_id == p.id] for p in plans}
    assert sorted(len(v) for v in by_plan.values()) == [1, 2]
    assert sorted(ln.ticker for ln in by_plan[big.id]) == ["ASML.AS", "VWCE.DE"]
    weighted = next(ln for ln in by_plan[big.id] if ln.ticker == "ASML.AS")
    assert (float(weighted.weight_before), float(weighted.target_weight)) == (0.1, 0.2)


def test_a_placed_line_points_at_the_new_trade(db_session):
    add_app_user(db_session)

    restore_data(db_session, USER_ID, _linked_file(), dry_run=False)

    placed = db_session.scalars(
        select(ContributionPlanLine).where(ContributionPlanLine.placed_trade_id.isnot(None))
    ).one()
    assert placed.placed_trade_id == _trade_id(db_session, 1)  # file trade 9, shares 1
    assert placed.placed_trade_id not in (9, 12)
    assert placed.placed_at == datetime(2026, 4, 6, 1, 2, 3)
    unplaced = db_session.scalars(
        select(ContributionPlanLine).where(ContributionPlanLine.placed_trade_id.is_(None))
    ).all()
    assert len(unplaced) == 2
    assert all(ln.placed_at is None for ln in unplaced)


def test_recurring_plans_and_occurrences_are_restored_and_linked(db_session):
    add_app_user(db_session)

    result = restore_data(db_session, USER_ID, _linked_file(), dry_run=False)

    assert result.restored["recurring_investments"] == 2
    assert result.restored["recurring_occurrences"] == 3
    plans = {p.name: p for p in db_session.scalars(select(RecurringInvestment))}
    assert {p.user_id for p in plans.values()} == {USER_ID}
    assert {p.id for p in plans.values()}.isdisjoint({30, 31})
    active, paused = plans["Employer plan"], plans["Old plan"]
    assert (active.status, active.next_date, active.start_date) == (
        "active",
        date(2026, 4, 30),
        date(2026, 1, 31),
    )
    # the export blanks the next date of a plan that is not active; it is stored as the start date
    assert (paused.status, paused.next_date) == ("paused", date(2025, 5, 15))
    occurrences = db_session.scalars(select(RecurringOccurrence)).all()
    assert {o.user_id for o in occurrences} == {USER_ID}
    assert sorted((o.plan_id == active.id, o.status) for o in occurrences) == [
        (False, "skipped"),
        (True, "confirmed"),
        (True, "scheduled"),
    ]


def test_a_confirmed_occurrence_points_at_the_new_trade(db_session):
    add_app_user(db_session)

    restore_data(db_session, USER_ID, _linked_file(), dry_run=False)

    confirmed = db_session.scalars(
        select(RecurringOccurrence).where(RecurringOccurrence.status == "confirmed")
    ).one()
    assert confirmed.trade_id == _trade_id(db_session, 2)  # file trade 12, shares 2
    assert confirmed.trade_id not in (9, 12)
    others = db_session.scalars(
        select(RecurringOccurrence).where(RecurringOccurrence.status != "confirmed")
    ).all()
    assert all(o.trade_id is None for o in others)


def test_no_occurrences_are_generated(db_session):
    add_app_user(db_session)
    file = _linked_file()  # the active plan's next date is long past on any test day

    restore_data(db_session, USER_ID, file, dry_run=False)

    assert _count(db_session, RecurringOccurrence) == len(file.recurring_occurrences)
    assert _count(db_session, RecurringInvestment) == len(file.recurring_investments)


def test_the_database_rules_hold_after_restore(db_session):
    add_app_user(db_session)

    restore_data(db_session, USER_ID, _linked_file(), dry_run=False)

    occ = RecurringOccurrence
    assert _count(db_session, occ) == 3
    broken = select(func.count()).where((occ.status == "confirmed") != occ.trade_id.isnot(None))
    assert db_session.scalar(broken) == 0  # confirmed if and only if a trade is attached
    pairs = db_session.execute(
        select(occ.plan_id, occ.scheduled_date).group_by(occ.plan_id, occ.scheduled_date)
    ).all()
    assert len(pairs) == 3  # one occurrence per plan and date
    trade_links = db_session.scalars(select(occ.trade_id).where(occ.trade_id.isnot(None))).all()
    assert len(trade_links) == len(set(trade_links))  # one trade per occurrence


def test_a_link_missing_from_the_file_rolls_everything_back(db_session):
    add_app_user(db_session)
    file = _linked_file()
    file.recurring_occurrences[0].trade_id = 999  # the schema checks this; the importer must too

    with pytest.raises(KeyError):
        restore_data(db_session, USER_ID, file, dry_run=False)

    assert _all_restored_tables_empty(db_session)


def _without_ids(rows: list[dict]) -> list[dict]:
    return [{k: v for k, v in row.items() if k not in ("id", "user_id")} for row in rows]


def _comparable(body: dict) -> dict:
    """The export with the ids removed and each link replaced by what it points at."""
    trade_of = {t["id"]: (t["date"], t["ticker"], t["shares"]) for t in body["trades"]}
    plan_of = {p["id"]: p["name"] for p in body["recurring_investments"]}
    return {
        "holdings": _without_ids(body["holdings"]),
        "watchlist_items": _without_ids(body["watchlist_items"]),
        "trades": sorted(_without_ids(body["trades"]), key=lambda t: (t["date"], t["ticker"])),
        "portfolio_snapshots": _without_ids(body["portfolio_snapshots"]),
        "contribution_plans": [
            {
                **{k: v for k, v in p.items() if k not in ("id", "lines")},
                "lines": [
                    {
                        **{k: v for k, v in ln.items() if k not in ("id", "placed_trade_id")},
                        "placed_trade": trade_of.get(ln["placed_trade_id"]),
                    }
                    for ln in p["lines"]
                ],
            }
            for p in body["contribution_plans"]
        ],
        "recurring_investments": _without_ids(body["recurring_investments"]),
        "recurring_occurrences": [
            {
                **{k: v for k, v in o.items() if k not in ("id", "user_id", "plan_id", "trade_id")},
                "plan": plan_of[o["plan_id"]],
                "trade": trade_of.get(o["trade_id"]),
            }
            for o in body["recurring_occurrences"]
        ],
        "investment_preferences": body["investment_preferences"],
    }


def _add_variety(db) -> None:
    """On top of one-of-everything: a second trade a second plan's line is placed on, a plan with
    notes and left-out entries, and a paused recurring plan with a skipped occurrence."""
    other = Trade(
        user_id=USER_ID, date=date(2024, 3, 3), ticker="MSFT", action="BUY", shares=3, price=7
    )
    plan = ContributionPlan(
        user_id=USER_ID,
        amount_eur=250,
        whole_shares=True,
        total_before_eur=10,
        leftover_eur=1.5,
        notes=["be patient"],
        left_out=[{"ticker": "X", "name": "X Co", "kind": "stock", "reason": "no data"}],
    )
    paused = ROW_FACTORIES["recurring_investments"](USER_ID)
    paused.name, paused.status = "Paused plan", "paused"
    db.add_all([other, plan, paused])
    db.flush()
    line = ROW_FACTORIES["contribution_plan_lines"](USER_ID)
    line.plan_id, line.placed_trade_id, line.placed_at = plan.id, other.id, datetime(2024, 3, 4)
    skipped = ROW_FACTORIES["recurring_occurrences"](USER_ID)
    skipped.plan_id, skipped.status = paused.id, "skipped"
    db.add_all([line, skipped])
    db.commit()


def test_export_import_export_matches(client, db_session, app_session_local):
    seed_one_of_everything(db_session)
    _add_variety(db_session)
    first = client.get("/me/export").json()
    assert len(first["recurring_occurrences"]) == 2 and len(first["contribution_plans"]) == 2
    assert all(first[name] for name in AI_OUTPUT_TABLES)  # there is AI output to leave behind
    delete_user_data(app_session_local, USER_ID)

    with open_user_session(app_session_local, USER_ID) as db:
        restore_data(db, USER_ID, ImportFile.model_validate(first), dry_run=False)
    second = client.get("/me/export").json()

    assert _comparable(second) == _comparable(first)
    for name in AI_OUTPUT_TABLES:
        assert second[name] == []


def test_two_simultaneous_imports_restore_exactly_once(db_session, app_session_local):
    add_app_user(db_session)
    file = _file()
    start = Barrier(2, timeout=10)

    def attempt() -> int:
        with open_user_session(app_session_local, USER_ID) as db:
            start.wait()
            try:
                restore_data(db, USER_ID, file, dry_run=False)
            except ImportRefused as refused:
                return refused.status_code
            return 200

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = sorted(pool.map(lambda _: attempt(), range(2)))

    assert results == [200, 409]
    assert _count(db_session, Holding) == 1


def test_an_account_that_is_not_active_is_refused_before_any_write(db_session):
    add_app_user(db_session, status="disabled")

    with pytest.raises(ImportRefused) as refused:
        restore_data(db_session, USER_ID, _file(), dry_run=False)

    assert (refused.value.status_code, refused.value.message) == (
        403,
        "This account is not active.",
    )
    assert _all_restored_tables_empty(db_session)


def test_a_user_with_no_account_row_is_refused(db_session):
    with pytest.raises(ImportRefused) as refused:
        restore_data(db_session, USER_ID, _file(), dry_run=False)

    assert refused.value.status_code == 403
    assert _all_restored_tables_empty(db_session)


def test_a_value_the_column_cannot_hold_is_the_same_generic_422(db_session, caplog):
    add_app_user(db_session)
    broken = DataError("INSERT INTO t", {"v": "secret-value"}, Exception("secret detail"))

    with (
        patch("app.data_import._restore_holdings", side_effect=broken),
        caplog.at_level(logging.DEBUG),
        pytest.raises(ImportRefused) as refused,
    ):
        restore_data(db_session, USER_ID, _file(), dry_run=False)

    assert refused.value.status_code == 422
    assert "secret" not in refused.value.message
    assert "secret" not in caplog.text
    assert _all_restored_tables_empty(db_session)


def test_the_refusal_names_every_kind_that_blocks(db_session):
    add_app_user(db_session)
    for table in ("trades", "portfolio_snapshots"):
        db_session.add(ROW_FACTORIES[table](USER_ID))
    db_session.commit()

    with pytest.raises(ImportRefused) as refused:
        require_empty_account(db_session, USER_ID)

    assert "trades, saved daily values" in refused.value.message
