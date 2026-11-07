import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
from threading import Barrier
from unittest.mock import AsyncMock

import pytest

from app import recurring, recurring_market
from app.db import open_user_session
from app.models import Holding, RecurringInvestment, RecurringOccurrence, Trade
from app.recurring_market import Estimate, MarketUnavailable
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user, auth_headers

PATH = "/portfolio/recurring"
PLAN = {
    "name": "SAP SE",
    "ticker": "SAP.DE",
    "asset_type": "STOCK",
    "amount": "400.00",
    "currency": "EUR",
    "start_date": "2026-04-15",
}


@pytest.fixture(autouse=True)
def inputs(monkeypatch):
    monkeypatch.setattr(recurring, "today", lambda: date(2026, 4, 15))
    monkeypatch.setattr(
        recurring_market,
        "instrument",
        AsyncMock(return_value={"exchange": "GER", "currency": "EUR", "name": "SAP SE"}),
    )
    monkeypatch.setattr(
        recurring_market,
        "estimate",
        AsyncMock(
            return_value=Estimate(
                date(2026, 4, 15), Decimal("100"), "EUR", Decimal(1), date(2026, 4, 15)
            )
        ),
    )


def create(client, **over):
    response = client.post(PATH, json=PLAN | over)
    assert response.status_code == 201, response.text
    return response.json()


def process(app_session_local):
    with open_user_session(app_session_local, USER_ID) as db:
        return asyncio.run(recurring.post_due(db, USER_ID))


def test_no_position_until_job_then_post_once(client_no_key, db_session, app_session_local):
    plan = create(client_no_key)
    assert plan["tracking_enabled"]
    assert client_no_key.get(PATH).headers["cache-control"] == "no-store"
    assert db_session.query(Holding).count() == 0
    assert process(app_session_local) == (1, 0)
    assert process(app_session_local) == (0, 0)
    holding = db_session.query(Holding).one()
    assert Decimal(str(holding.shares)) == Decimal(4)
    assert Decimal(str(holding.cost_basis)) == Decimal(100)
    trade = db_session.query(Trade).one()
    assert trade.provenance == "recurring_estimated"
    entry = client_no_key.get(PATH).json()["occurrences"][0]
    assert entry["status"] == "posted" and entry["trade_id"] == trade.id
    assert entry["quote_currency"] == "EUR" and Decimal(entry["shares"]) == 4


def test_eur_usd_etf_uses_fractional_units(
    client_no_key, db_session, app_session_local, monkeypatch
):
    monkeypatch.setattr(
        recurring_market,
        "estimate",
        AsyncMock(
            return_value=Estimate(
                date(2026, 4, 15), Decimal("200"), "USD", Decimal("1.2"), date(2026, 4, 15)
            )
        ),
    )
    create(client_no_key, ticker="CNDX.L", asset_type="ETF", amount="300")
    process(app_session_local)
    assert db_session.query(Holding).one().shares == Decimal("1.8")
    entry = client_no_key.get(PATH).json()["occurrences"][0]
    assert Decimal(entry["amount"]) == 300 and Decimal(entry["fx_rate"]) == Decimal("1.2")


def test_missing_inputs_retry_and_tiny_purchase_never_creates_empty_holding(
    client_no_key, db_session, app_session_local, monkeypatch
):
    create(client_no_key)
    monkeypatch.setattr(
        recurring_market,
        "estimate",
        AsyncMock(side_effect=MarketUnavailable("Waiting for historical FX.")),
    )
    assert process(app_session_local) == (0, 1)
    assert db_session.query(Trade).count() == db_session.query(Holding).count() == 0
    monkeypatch.setattr(
        recurring_market,
        "estimate",
        AsyncMock(
            return_value=Estimate(
                date(2026, 4, 15),
                Decimal("1000000000"),
                "EUR",
                Decimal("0.000001"),
                date(2026, 4, 15),
            )
        ),
    )
    assert process(app_session_local) == (0, 1)
    assert db_session.query(Holding).count() == 0
    monkeypatch.setattr(
        recurring_market,
        "estimate",
        AsyncMock(
            return_value=Estimate(
                date(2026, 4, 15), Decimal(100), "EUR", Decimal(1), date(2026, 4, 15)
            )
        ),
    )
    assert process(app_session_local) == (1, 0)
    assert db_session.query(Trade).count() == 1


def test_backfill_preview_requires_approval_and_refuses_overlap(client_no_key, db_session):
    payload = PLAN | {"start_date": "2026-01-31"}
    preview = client_no_key.post(f"{PATH}/preview", json=payload).json()
    assert preview["catch_up_count"] == 3
    assert preview["first_date"] == "2026-01-31" and preview["last_date"] == "2026-03-31"
    assert client_no_key.post(PATH, json=payload).status_code == 422
    created = client_no_key.post(PATH, json=payload | {"backfill": True})
    assert created.status_code == 201
    db_session.add(
        Holding(
            user_id=USER_ID,
            ticker="SAP.DE",
            name="SAP",
            asset_type="STOCK",
            shares=2,
            cost_basis=50,
        )
    )
    db_session.commit()
    assert client_no_key.post(f"{PATH}/preview", json=payload).json()["conflict"]
    assert client_no_key.post(PATH, json=payload | {"backfill": True}).status_code == 409
    assert db_session.query(Holding).one().shares == 2


def test_lifecycle_edits_future_only_and_multiple_plans(
    client_no_key, app_session_local, monkeypatch
):
    plan = create(client_no_key)
    create(client_no_key, amount="300")  # independent plan for the same instrument
    process(app_session_local)
    old = client_no_key.get(PATH).json()["occurrences"]
    assert len(old) == 2
    edit = client_no_key.put(f"{PATH}/{plan['id']}", json=PLAN | {"amount": "500"})
    assert edit.status_code == 200
    assert edit.json()["next_date"] == "2026-05-15"
    assert (
        client_no_key.patch(f"{PATH}/{plan['id']}/status", json={"status": "paused"}).status_code
        == 200
    )
    monkeypatch.setattr(recurring, "today", lambda: date(2026, 7, 15))
    resumed = client_no_key.patch(f"{PATH}/{plan['id']}/status", json={"status": "active"})
    assert resumed.json()["next_date"] == "2026-08-15"
    assert (
        client_no_key.patch(f"{PATH}/{plan['id']}/status", json={"status": "ended"}).status_code
        == 200
    )
    assert (
        client_no_key.patch(f"{PATH}/{plan['id']}/status", json={"status": "active"}).status_code
        == 409
    )
    assert client_no_key.get(PATH).json()["occurrences"] == old


def test_corrections_voids_and_manual_trades_survive_retries(
    client_no_key, db_session, app_session_local
):
    create(client_no_key)
    process(app_session_local)
    entry = client_no_key.get(PATH).json()["occurrences"][0]
    url = f"{PATH}/occurrences/{entry['id']}/estimate"
    corrected = client_no_key.put(url, json={"date": "2026-04-15", "shares": 3, "price": 120})
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["status"] == "reconciled"
    before_void = client_no_key.get("/me/export").json()
    exported_trade_ids = {t["id"] for t in before_void["trades"]}
    assert all(
        o["trade_id"] is None or o["trade_id"] in exported_trade_ids
        for o in before_void["recurring_occurrences"]
    )
    assert before_void["recurring_occurrences"][0]["trade_id"] == entry["trade_id"]
    assert (
        client_no_key.post(
            "/portfolio/trades",
            json={
                "ticker": "SAP.DE",
                "date": "2026-04-15",
                "action": "BUY",
                "shares": 2,
                "price": 80,
            },
        ).status_code
        == 200
    )
    voided = client_no_key.delete(url)
    assert voided.status_code == 200, voided.text
    db_session.expire_all()
    holding = db_session.query(Holding).one()
    assert holding.shares == 2 and holding.cost_basis == 80
    process(app_session_local)
    assert db_session.query(Trade).count() == 2
    assert db_session.query(Trade).filter_by(provenance="voided").count() == 1
    exported = client_no_key.get("/me/export").json()
    assert all(t["provenance"] != "voided" for t in exported["trades"])
    assert sum(Decimal(str(t["shares"])) for t in exported["trades"]) == holding.shares
    assert exported["recurring_occurrences"][0]["status"] == "voided"
    exported_trade_ids = {t["id"] for t in exported["trades"]}
    assert all(
        o["trade_id"] is None or o["trade_id"] in exported_trade_ids
        for o in exported["recurring_occurrences"]
    )
    audit = exported["recurring_occurrences"][0]
    assert audit["trade_id"] is None
    assert Decimal(audit["shares"]) == 3 and Decimal(audit["price"]) == 120
    # Only the export drops the link; the local audit trail remains complete.
    assert db_session.query(RecurringOccurrence).one().trade_id == entry["trade_id"]
    assert client_no_key.get(PATH).json()["occurrences"][0]["trade_id"] == entry["trade_id"]
    assert (
        client_no_key.patch(
            f"{PATH}/occurrences/{entry['id']}", json={"status": "scheduled"}
        ).status_code
        == 409
    )


def test_correction_refuses_overselling_or_overwritten_position(
    client_no_key, db_session, app_session_local
):
    create(client_no_key)
    process(app_session_local)
    entry = client_no_key.get(PATH).json()["occurrences"][0]
    client_no_key.post(
        "/portfolio/trades",
        json={
            "ticker": "SAP.DE",
            "date": "2026-04-15",
            "action": "SELL",
            "shares": 3,
            "price": 110,
        },
    )
    url = f"{PATH}/occurrences/{entry['id']}/estimate"
    assert client_no_key.delete(url).status_code == 422
    db_session.expire_all()
    assert db_session.query(Holding).one().shares == 1
    assert db_session.query(RecurringOccurrence).one().status == "posted"


def test_ownership_isolation_and_index_refusal(client_no_key, db_session, monkeypatch):
    plan = create(client_no_key)
    add_app_user(db_session, OTHER_USER_ID)
    client_no_key.headers.update(auth_headers(OTHER_USER_ID))
    assert client_no_key.get(PATH).json() == {"plans": [], "occurrences": []}
    assert client_no_key.put(f"{PATH}/{plan['id']}", json=PLAN).status_code == 404
    assert (
        client_no_key.patch(f"{PATH}/{plan['id']}/status", json={"status": "ended"}).status_code
        == 404
    )
    client_no_key.headers.update(auth_headers(USER_ID))
    monkeypatch.setattr(
        recurring_market,
        "instrument",
        AsyncMock(side_effect=MarketUnavailable("Choose a stock or ETF listing.")),
    )
    assert client_no_key.post(PATH, json=PLAN | {"ticker": "^NDX"}).status_code == 422


def test_legacy_records_remain_disabled_until_review(client_no_key, db_session):
    row = RecurringInvestment(
        user_id=USER_ID,
        name="Legacy",
        ticker="SAP.DE",
        asset_type="STOCK",
        source="Preserved source",
        amount=400,
        currency="RUB",
        start_date=date(2026, 1, 1),
        next_date=date(2026, 5, 1),
        status="active",
        tracking_enabled=False,
    )
    db_session.add(row)
    db_session.flush()
    db_session.add(
        RecurringOccurrence(
            user_id=USER_ID,
            plan_id=row.id,
            scheduled_date=date(2026, 4, 1),
            ticker="SAP.DE",
            asset_type="STOCK",
            amount=400,
            currency="EUR",
            status="scheduled",
        )
    )
    db_session.commit()
    # Old plans accepted arbitrary three-letter labels; stricter writes must not break their export.
    assert client_no_key.get(PATH).status_code == 200
    assert client_no_key.get("/me/export").status_code == 200
    response = client_no_key.put(f"{PATH}/{row.id}", json=PLAN)
    assert response.status_code == 200, response.text
    assert response.json()["tracking_enabled"]
    db_session.expire_all()
    assert db_session.query(RecurringInvestment).one().source == "Preserved source"
    assert db_session.query(RecurringOccurrence).one().status == "skipped"
    assert db_session.query(Trade).count() == 0


def test_correction_preserves_a_manually_edited_purchase_date(
    client_no_key, db_session, app_session_local
):
    create(client_no_key)
    process(app_session_local)
    holding = db_session.query(Holding).one()
    holding.first_purchase_date = date(2026, 4, 1)
    db_session.commit()
    occurrence = client_no_key.get(PATH).json()["occurrences"][0]
    response = client_no_key.put(
        f"{PATH}/occurrences/{occurrence['id']}/estimate",
        json={"date": "2026-04-15", "shares": 4, "price": 100},
    )
    assert response.status_code == 409
    db_session.expire_all()
    assert db_session.query(Holding).one().first_purchase_date == date(2026, 4, 1)


def test_concurrent_workers_post_once(client_no_key, db_session, app_session_local):
    create(client_no_key)
    barrier = Barrier(2)

    def run():
        barrier.wait()
        return process(app_session_local)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: run(), range(2)))
    assert sum(posted for posted, _ in results) == 1
    db_session.expire_all()
    assert db_session.query(Trade).count() == 1
    assert db_session.query(Holding).one().shares == 4


def test_correction_replays_database_rounding_after_every_purchase(
    client_no_key, db_session, app_session_local, monkeypatch
):
    plan = create(
        client_no_key, start_date="2026-01-15", amount="100", currency="USD", backfill=True
    )
    with open_user_session(app_session_local, USER_ID) as db:
        rows = (
            db.query(RecurringOccurrence)
            .filter_by(plan_id=plan["id"])
            .order_by(RecurringOccurrence.scheduled_date)
            .all()
        )
        rows[3].status = "skipped"
        db.commit()
    values = {
        date(2026, 1, 15): (Decimal("0.18"), Decimal("93.26")),
        date(2026, 2, 15): (Decimal("0.98"), Decimal("10.34")),
        date(2026, 3, 15): (Decimal("0.33"), Decimal("19.32")),
    }

    async def quote(ticker, asset_type, scheduled, currency, earliest, **kwargs):
        shares, price = values[scheduled]
        return Estimate(scheduled, price, "EUR", shares * price / 100, scheduled)

    monkeypatch.setattr(recurring_market, "estimate", quote)
    process(app_session_local)
    db_session.expire_all()
    assert db_session.query(Holding).one().cost_basis == Decimal("22.346041")
    entries = client_no_key.get(PATH).json()["occurrences"]
    posted = [e for e in entries if e["status"] == "posted"]
    last = posted[0]
    response = client_no_key.put(
        f"{PATH}/occurrences/{last['id']}/estimate",
        json={
            "date": last["trade_date"],
            "shares": float(last["shares"]),
            "price": float(last["price"]),
        },
    )
    assert response.status_code == 200, response.text


@pytest.mark.parametrize("status", ["paused", "ended"])
def test_pause_stop_preserves_unpriced_due_purchases(
    client_no_key, db_session, app_session_local, monkeypatch, status
):
    plan = create(client_no_key)
    monkeypatch.setattr(
        recurring_market, "estimate", AsyncMock(side_effect=MarketUnavailable("Waiting."))
    )
    assert process(app_session_local) == (0, 1)
    response = client_no_key.patch(f"{PATH}/{plan['id']}/status", json={"status": status})
    assert response.status_code == 200
    assert client_no_key.get(PATH).json()["occurrences"][0]["status"] == "scheduled"
    monkeypatch.setattr(
        recurring_market,
        "estimate",
        AsyncMock(
            return_value=Estimate(
                date(2026, 4, 15), Decimal(100), "EUR", Decimal(1), date(2026, 4, 15)
            )
        ),
    )
    assert process(app_session_local) == (1, 0)
    assert db_session.query(Holding).one().shares == 4


def test_failed_backlog_does_not_starve_other_tickers_and_source_is_saved(
    client_no_key, db_session, app_session_local, monkeypatch
):
    create(
        client_no_key,
        start_date="2025-01-01",
        frequency="custom",
        interval_unit="days",
        source="My provider",
        backfill=True,
    )
    create(client_no_key, ticker="MSFT")
    calls = []

    async def quote(ticker, asset_type, scheduled, currency, earliest, **kwargs):
        calls.append(ticker)
        if ticker == "SAP.DE":
            raise MarketUnavailable("Manual review required.")
        return Estimate(scheduled, Decimal(100), "EUR", Decimal(1), scheduled)

    monkeypatch.setattr(recurring_market, "estimate", quote)
    assert process(app_session_local) == (1, 1)
    assert calls.count("SAP.DE") == calls.count("MSFT") == 1
    assert (
        db_session.query(RecurringInvestment).filter_by(ticker="SAP.DE").one().source
        == "My provider"
    )
    assert db_session.query(Holding).one().ticker == "MSFT"


def test_daily_backfill_materializes_and_posts_in_one_pass_then_ends(
    client_no_key, db_session, app_session_local
):
    plan = create(
        client_no_key,
        start_date="2025-01-01",
        end_date="2025-12-31",
        frequency="custom",
        interval_unit="days",
        backfill=True,
    )
    assert plan["status"] == "ended"
    assert db_session.query(RecurringOccurrence).count() == 365
    assert process(app_session_local) == (365, 0)
    assert process(app_session_local) == (0, 0)
    assert db_session.query(Trade).count() == 365


def test_legacy_due_entries_can_still_be_confirmed(client_no_key, db_session, app_session_local):
    plan = create(client_no_key)
    row = db_session.get(RecurringInvestment, plan["id"])
    row.tracking_enabled = False
    db_session.commit()
    assert process(app_session_local) == (0, 0)
    entry = client_no_key.get(PATH).json()["occurrences"][0]
    response = client_no_key.post(
        f"{PATH}/occurrences/{entry['id']}/confirm",
        json={"date": "2026-04-15", "shares": 3, "price": 125},
    )
    assert response.status_code == 200
    assert db_session.query(Holding).one().shares == 3


def test_history_is_bounded_but_export_retains_every_occurrence(client_no_key, db_session):
    create(
        client_no_key,
        start_date="2024-01-01",
        end_date="2025-12-31",
        frequency="custom",
        interval_unit="days",
        backfill=True,
    )
    assert len(client_no_key.get(PATH).json()["occurrences"]) == 500
    assert len(client_no_key.get("/me/export").json()["recurring_occurrences"]) == 731


def test_validated_save_runs_database_work_off_the_event_loop(monkeypatch):
    import threading
    from unittest.mock import Mock

    from app.schemas_recurring import RecurringIn

    loop_thread = threading.get_ident()

    def save(*args, **kwargs):
        assert threading.get_ident() != loop_thread
        assert kwargs["exchange"] == "GER"
        return "saved"

    monkeypatch.setattr(recurring, "save", save)
    result = asyncio.run(
        recurring.validated_save(Mock(), USER_ID, RecurringIn.model_validate(PLAN))
    )
    assert result == "saved"
