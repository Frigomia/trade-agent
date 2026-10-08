from datetime import date
from decimal import Decimal as D
from unittest.mock import AsyncMock, patch

import pytest

from app.fx import EurPrice
from app.models import (
    ContributionPlan,
    ContributionPlanLine,
    Holding,
    Recommendation,
    WatchlistItem,
)
from tests.auth_support import OTHER_USER_ID, USER_ID


def _holding(db, ticker, shares, target, user_id=USER_ID):
    db.add(
        Holding(
            user_id=user_id,
            ticker=ticker,
            name=ticker,
            asset_type="STOCK",
            shares=shares,
            cost_basis=10,
            first_purchase_date=date(2024, 1, 1),
            target_weight=target,
        )
    )
    db.commit()


def _watch(db, ticker, target, user_id=USER_ID):
    db.add(WatchlistItem(user_id=user_id, ticker=ticker, asset_type="STOCK", target_weight=target))
    db.commit()


def _prices(**eur):
    async def fake(tickers):
        got = {t: EurPrice(D(str(eur[t])), "EUR", D(1)) for t in tickers if t in eur}
        return got, {t: f"{t} is left out: no price available." for t in tickers if t not in eur}

    return patch("app.plans.eur_prices", AsyncMock(side_effect=fake))


def _seed_basic(db):
    _holding(db, "AAPL", 5, 0.4)  # 5 x 200 = 1000
    _holding(db, "MSFT", 7.5, 0.4)  # 7.5 x 400 = 3000
    _watch(db, "NVDA", 0.2)  # not held


def test_preview_computes_and_saves_nothing(client, db_session):
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert body["id"] is None and body["amount_eur"] == 500
    assert {ln["ticker"]: ln["amount_eur"] for ln in body["lines"]} == {
        "AAPL": 235.29,
        "NVDA": 264.71,
    }
    assert body["leftover_eur"] == 0 and body["total_before_eur"] == 4000
    assert body["disclaimer"] == "Advisory only. Nothing is sent to a broker."
    assert db_session.query(ContributionPlan).count() == 0


def test_save_stores_the_plan_computed_on_the_server(client, db_session):
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        saved = client.post(
            "/plans", json={"amount": 500, "lines": [{"ticker": "HACK", "amount_eur": 500}]}
        )
    assert saved.status_code == 201
    body = saved.json()
    assert body["id"] is not None and {ln["ticker"] for ln in body["lines"]} == {"AAPL", "NVDA"}
    assert db_session.query(ContributionPlanLine).filter_by(plan_id=body["id"]).count() == 2
    again = client.get(f"/plans/{body['id']}").json()
    assert again["lines"] == body["lines"] and again["created_at"] is not None


def test_a_pending_trim_or_sell_call_excludes_a_ticker(client, db_session):
    _seed_basic(db_session)
    db_session.add(
        Recommendation(
            user_id=USER_ID,
            ticker="AAPL",
            asset_type="STOCK",
            action="SELL",
            reasoning=["x"],
            status="PENDING",
        )
    )
    db_session.commit()
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert [ln["ticker"] for ln in body["lines"]] == ["NVDA"]
    assert any("AAPL" in n for n in body["notes"])


def test_an_approved_or_old_decided_call_does_not_exclude(client, db_session):
    _seed_basic(db_session)
    db_session.add(
        Recommendation(
            user_id=USER_ID,
            ticker="AAPL",
            asset_type="STOCK",
            action="SELL",
            reasoning=["x"],
            status="APPROVED",
        )
    )
    db_session.commit()
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert {ln["ticker"] for ln in body["lines"]} == {"AAPL", "NVDA"}


def test_an_unpriced_ticker_is_left_out_with_a_note(client, db_session):
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400):  # NVDA has no price
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert [ln["ticker"] for ln in body["lines"]] == ["AAPL"]
    assert any("NVDA" in n for n in body["notes"])


def test_holdings_without_a_target_are_not_priced_and_are_noted(client, db_session):
    _seed_basic(db_session)
    _holding(db_session, "OLD", 3, None)
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert "OLD" not in {ln["ticker"] for ln in body["lines"]}
    assert any("target" in n for n in body["notes"])


def test_nothing_with_a_target_gives_an_empty_plan(client, db_session):
    _holding(db_session, "AAPL", 5, None)
    with _prices(AAPL=200):
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert body["lines"] == [] and body["leftover_eur"] == 500 and body["notes"]


@pytest.mark.parametrize("amount", [0, -1, 1_000_001, "abc", None])
def test_the_amount_is_validated(client, amount):
    assert client.post("/plans/preview", json={"amount": amount}).status_code == 422


def test_whole_shares_mode_reports_the_leftover(client, db_session):
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        body = client.post("/plans/preview", json={"amount": 500, "whole_shares": True}).json()
    assert body["leftover_eur"] == 100 and all(
        ln["shares"] == int(ln["shares"]) for ln in body["lines"]
    )


def test_a_user_never_sees_or_uses_another_users_data(client, db_session):
    _seed_basic(db_session)
    _holding(db_session, "TSLA", 100, 0.9, user_id=OTHER_USER_ID)
    with _prices(AAPL=200, MSFT=400, NVDA=100, TSLA=50):
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert "TSLA" not in {ln["ticker"] for ln in body["lines"]}
    other = ContributionPlan(
        user_id=OTHER_USER_ID,
        amount_eur=100,
        whole_shares=False,
        total_before_eur=0,
        leftover_eur=0,
        notes=[],
    )
    db_session.add(other)
    db_session.commit()
    assert client.get(f"/plans/{other.id}").status_code == 404
    assert client.delete(f"/plans/{other.id}").status_code == 404
    assert db_session.query(ContributionPlan).filter_by(id=other.id).count() == 1
    assert client.get("/plans").json() == []


def test_list_is_newest_first_and_delete_removes_the_lines(client, db_session):
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        first = client.post("/plans", json={"amount": 500}).json()
        second = client.post("/plans", json={"amount": 600}).json()
    listed = client.get("/plans").json()
    assert [p["id"] for p in listed] == [second["id"], first["id"]]
    assert listed[0]["line_count"] == 2 and listed[0]["amount_eur"] == 600
    assert client.delete(f"/plans/{first['id']}").status_code == 204
    assert db_session.query(ContributionPlanLine).filter_by(plan_id=first["id"]).count() == 0
    assert client.get(f"/plans/{first['id']}").status_code == 404


def test_a_person_can_keep_at_most_120_plans(client, db_session):
    for _ in range(120):
        db_session.add(
            ContributionPlan(
                user_id=USER_ID,
                amount_eur=1,
                whole_shares=False,
                total_before_eur=0,
                leftover_eur=0,
                notes=[],
            )
        )
    db_session.commit()
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        assert client.post("/plans", json={"amount": 500}).status_code == 409


def test_the_preview_is_rate_limited(client, db_session):
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        statuses = [
            client.post("/plans/preview", json={"amount": 500}).status_code for _ in range(11)
        ]
    assert statuses[:10] == [200] * 10 and statuses[10] == 429


def test_plans_require_authentication(anon_client):
    assert anon_client.post("/plans/preview", json={"amount": 5}).status_code == 401
    assert anon_client.get("/plans").status_code == 401


def test_drift_lists_holdings_beyond_the_threshold(client, db_session):
    _holding(db_session, "AAPL", 5, 0.4)  # 1000
    _holding(db_session, "MSFT", 7.5, 0.4)  # 3000: weights 25 / 75 against 50 / 50
    with _prices(AAPL=200, MSFT=400):
        body = client.get("/plans/drift").json()
    assert [(i["ticker"], round(i["points"], 1)) for i in body] == [("AAPL", -25.0), ("MSFT", 25.0)]
    assert body[0]["weight"] == pytest.approx(0.25) and body[0]["target"] == pytest.approx(0.5)


def test_drift_uses_the_persons_own_threshold(client, db_session):
    _holding(db_session, "AAPL", 5, 0.4)
    _holding(db_session, "MSFT", 7.5, 0.4)
    client.post("/preferences", json={"drift_threshold_pct": 30})
    with _prices(AAPL=200, MSFT=400):
        assert client.get("/plans/drift").json() == []


def test_drift_is_empty_without_targets_and_never_lists_the_watchlist(client, db_session):
    _holding(db_session, "AAPL", 5, None)
    _watch(db_session, "NVDA", 0.5)
    with _prices(AAPL=200, NVDA=100):
        assert client.get("/plans/drift").json() == []


def test_drift_is_not_confused_with_a_plan_id(client):
    assert client.get("/plans/drift").status_code == 200


def test_drift_ignores_other_users(client, db_session):
    _holding(db_session, "TSLA", 100, 0.5, user_id=OTHER_USER_ID)
    _holding(db_session, "GOOG", 1, 0.5, user_id=OTHER_USER_ID)
    with _prices(TSLA=50, GOOG=100):
        assert client.get("/plans/drift").json() == []
