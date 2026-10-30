import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Barrier

import pytest
from sqlalchemy.exc import IntegrityError

from app import recurring, scheduled
from app.db import open_user_session
from app.models import Holding, RecurringInvestment, RecurringOccurrence, Trade
from app.schemas import PlaceIn
from app.schemas_recurring import RecurringIn
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user, auth_headers

PATH = "/portfolio/recurring"
PLAN = {
    "name": "Trade Republic savings plan",
    "ticker": "VWCE.DE",
    "asset_type": "ETF",
    "source": "Trade Republic",
    "amount": 400,
    "currency": "EUR",
    "start_date": "2026-01-31",
}


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    monkeypatch.setattr(recurring, "today", lambda: date(2026, 3, 31))


def create(client, **changes):
    response = client.post(PATH, json=PLAN | changes)
    assert response.status_code == 201, response.text
    return response.json()


def test_month_end_leap_year_and_year_rollover():
    assert recurring.upcoming(date(2024, 1, 31), date(2024, 2, 1)) == [
        date(2024, 2, 29),
        date(2024, 3, 31),
        date(2024, 4, 30),
    ]
    assert recurring.scheduled_on_or_after(date(2025, 12, 31), date(2026, 1, 1)) == date(
        2026, 1, 31
    )
    assert recurring.scheduled_on_or_after(date(2026, 1, 30), date(2026, 3, 1)) == date(2026, 3, 30)


def test_preview_catch_up_and_no_holdings_until_confirmation(client_no_key, db_session):
    client = client_no_key
    preview = client.post(f"{PATH}/preview", json=PLAN).json()
    assert preview == {
        "catch_up_count": 3,
        "upcoming_dates": ["2026-04-30", "2026-05-31", "2026-06-30"],
    }
    assert db_session.query(RecurringInvestment).count() == 0
    plan = create(client)
    assert plan["amount"] == 400
    assert plan["next_date"] == "2026-04-30"
    for _ in range(2):
        entries = client.get(PATH).json()["occurrences"]
        assert [e["scheduled_date"] for e in entries] == ["2026-03-31", "2026-02-28", "2026-01-31"]
        assert all(e["status"] == "scheduled" and e["trade_id"] is None for e in entries)
    assert db_session.query(Holding).count() == db_session.query(Trade).count() == 0
    employer = create(client, name="Employer stock plan", ticker="SAP.DE", asset_type="STOCK")
    assert employer["asset_type"] == "STOCK"
    assert client.get(PATH).headers["cache-control"] == "no-store"


def test_downtime_edit_pause_resume_and_end(client_no_key, monkeypatch):
    client = client_no_key
    plan = create(client)
    pid = plan["id"]
    monkeypatch.setattr(recurring, "today", lambda: date(2026, 6, 30))
    # Editing catches up the old schedule and keeps its expected amounts.
    changed = PLAN | {
        "amount": 500,
        "start_date": "2026-01-15",
        "ticker": "SAP.DE",
        "asset_type": "STOCK",
    }
    assert client.put(f"{PATH}/{pid}", json=changed).json()["next_date"] == "2026-07-15"
    entries = client.get(PATH).json()["occurrences"]
    assert len(entries) == 6
    assert all(e["amount"] == 400 and e["ticker"] == "VWCE.DE" for e in entries)
    assert client.patch(f"{PATH}/{pid}/status", json={"status": "paused"}).status_code == 200
    monkeypatch.setattr(recurring, "today", lambda: date(2026, 9, 15))
    resumed = client.patch(f"{PATH}/{pid}/status", json={"status": "active"}).json()
    assert resumed["next_date"] == "2026-10-15"
    assert len(client.get(PATH).json()["occurrences"]) == 6
    monkeypatch.setattr(recurring, "today", lambda: date(2026, 10, 15))
    assert client.patch(f"{PATH}/{pid}/status", json={"status": "ended"}).status_code == 200
    monkeypatch.setattr(recurring, "today", lambda: date(2027, 1, 1))
    data = client.get(PATH).json()
    assert len(data["occurrences"]) == 7
    assert data["occurrences"][0]["amount"] == 500
    assert data["plans"][0]["next_date"] is None
    assert client.patch(f"{PATH}/{pid}/status", json={"status": "active"}).status_code == 409
    assert client.put(f"{PATH}/{pid}", json=PLAN).status_code == 409


def test_skip_reopen_and_confirm_actual_details_once(client_no_key, db_session):
    client = client_no_key
    create(client)
    oid = client.get(PATH).json()["occurrences"][0]["id"]
    url = f"{PATH}/occurrences/{oid}"
    assert client.patch(url, json={"status": "skipped"}).status_code == 200
    actual = {"date": "2026-03-30", "shares": 2.5, "price": 101.25}
    assert client.post(f"{url}/confirm", json=actual).status_code == 409
    assert client.patch(url, json={"status": "scheduled"}).status_code == 200
    first = client.post(f"{url}/confirm", json=actual)
    assert first.status_code == 200, first.text
    second = client.post(f"{url}/confirm", json=actual | {"shares": 99})
    assert first.json() == second.json()
    assert first.json()["shares"] == 2.5
    holding = db_session.query(Holding).one()
    assert float(holding.shares) == 2.5
    assert float(holding.cost_basis) == 101.25
    assert holding.first_purchase_date == date(2026, 3, 30)
    assert db_session.query(Trade).count() == 1
    assert client.patch(url, json={"status": "skipped"}).status_code == 409
    pid = client.get(PATH).json()["plans"][0]["id"]
    assert client.put(f"{PATH}/{pid}", json=PLAN | {"amount": 999}).status_code == 200
    saved = client.get(PATH).json()["occurrences"][0]
    assert saved["status"] == "confirmed" and saved["amount"] == 400
    assert saved["trade_id"] == first.json()["id"]


def test_confirmation_uses_existing_basis_and_rolls_back_invalid_totals(client_no_key, db_session):
    client = client_no_key
    db_session.add(
        Holding(
            user_id=USER_ID,
            ticker="VWCE.DE",
            name="ETF",
            asset_type="ETF",
            shares=10,
            cost_basis=80,
        )
    )
    db_session.commit()
    create(client)
    oid = client.get(PATH).json()["occurrences"][0]["id"]
    url = f"{PATH}/occurrences/{oid}/confirm"
    assert (
        client.post(url, json={"date": "2026-04-01", "shares": 2, "price": 100}).status_code == 422
    )
    assert (
        client.post(url, json={"date": "2026-03-31", "shares": 1e14, "price": 100}).status_code
        == 422
    )
    db_session.expire_all()
    assert float(db_session.query(Holding).one().shares) == 10
    assert db_session.query(Trade).count() == 0
    assert (
        client.post(url, json={"date": "2026-03-31", "shares": 2, "price": 110}).status_code == 200
    )
    db_session.expire_all()
    assert float(db_session.query(Holding).one().cost_basis) == 85


def test_owner_scoped_routes_export_and_delete(client_no_key, db_session):
    client = client_no_key
    plan = create(client)
    entry = client.get(PATH).json()["occurrences"][0]
    add_app_user(db_session, OTHER_USER_ID)
    headers = auth_headers(OTHER_USER_ID)
    assert client.get(PATH, headers=headers).json() == {"plans": [], "occurrences": []}
    assert client.put(f"{PATH}/{plan['id']}", headers=headers, json=PLAN).status_code == 404
    assert (
        client.patch(
            f"{PATH}/{plan['id']}/status", headers=headers, json={"status": "ended"}
        ).status_code
        == 404
    )
    assert (
        client.patch(
            f"{PATH}/occurrences/{entry['id']}", headers=headers, json={"status": "skipped"}
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"{PATH}/occurrences/{entry['id']}/confirm",
            headers=headers,
            json={"date": "2026-03-31", "shares": 1, "price": 400},
        ).status_code
        == 404
    )
    exported = client.get("/me/export").json()
    assert len(exported["recurring_investments"]) == 1
    assert len(exported["recurring_occurrences"]) == 3
    other = client.post(
        PATH, headers=headers, json=PLAN | {"name": "Other owner", "ticker": "SAP.DE"}
    )
    assert other.status_code == 201
    assert client.request("DELETE", "/me/data", json={"confirm": True}).status_code == 204
    assert [p.user_id for p in db_session.query(RecurringInvestment)] == [OTHER_USER_ID]
    assert all(o.user_id == OTHER_USER_ID for o in db_session.query(RecurringOccurrence))


def test_concurrent_catch_up_and_confirmation(client_no_key, app_session_local, monkeypatch):
    create(client_no_key)
    monkeypatch.setattr(recurring, "today", lambda: date(2026, 5, 31))
    barrier = Barrier(2)

    def catch_up(_):
        with open_user_session(app_session_local, USER_ID) as db:
            barrier.wait(timeout=10)
            recurring.process_due(db, USER_ID)

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(catch_up, range(2)))
    data = client_no_key.get(PATH).json()
    assert len(data["occurrences"]) == 5
    oid = data["occurrences"][0]["id"]
    barrier = Barrier(2)

    def confirm(_):
        with open_user_session(app_session_local, USER_ID) as db:
            barrier.wait(timeout=10)
            return recurring.confirm(
                db, USER_ID, oid, PlaceIn(date=date(2026, 5, 31), shares=2, price=200)
            ).id

    with ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(confirm, range(2)))
    assert ids[0] == ids[1]
    with open_user_session(app_session_local, USER_ID) as db:
        assert db.query(Trade).count() == 1
        assert float(db.query(Holding).one().shares) == 2


def test_database_uniqueness_constraint(client_no_key, db_session):
    plan = create(client_no_key)
    db_session.add(
        RecurringOccurrence(
            user_id=USER_ID,
            plan_id=plan["id"],
            scheduled_date=date(2026, 1, 31),
            ticker="VWCE.DE",
            asset_type="ETF",
            amount=400,
            currency="EUR",
        )
    )
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


@pytest.mark.parametrize(
    "changes",
    [
        {"amount": 0},
        {"amount": 0.001},
        {"amount": "NaN"},
        {"currency": "eur"},
        {"ticker": "../bad"},
        {"frequency": "daily"},
        {"name": " "},
        {"start_date": "1900-01-01"},
    ],
)
def test_invalid_plan_input(client_no_key, changes):
    assert client_no_key.post(PATH, json=PLAN | changes).status_code == 422


def test_scheduled_command_catches_up_without_market_data_or_ai(
    db_session, monkeypatch, app_session_local
):
    add_app_user(db_session, USER_ID)
    monkeypatch.setattr("app.db.SessionLocal", app_session_local)
    with open_user_session(app_session_local, USER_ID) as db:
        recurring.save(db, USER_ID, RecurringIn.model_validate(PLAN))
    monkeypatch.setattr(recurring, "today", lambda: date(2026, 7, 31))
    assert asyncio.run(scheduled.run_command("recurring")) == 0
    assert db_session.query(RecurringOccurrence).count() == 7
