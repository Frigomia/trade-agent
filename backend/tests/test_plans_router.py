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
    Trade,
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


def test_a_held_ticker_without_a_target_takes_the_watchlist_target(client, db_session):
    _holding(db_session, "NVDA", 10, None)  # 10 x 100 = 1000, no target of its own
    _holding(db_session, "AAPL", 5, 0.5)  # 1000
    _watch(db_session, "NVDA", 0.2)
    with _prices(NVDA=100, AAPL=200):
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert body["total_before_eur"] == 2000  # NVDA counts at its real value, not 0
    assert all(ln["reason"] != "new_position" for ln in body["lines"])
    assert not any("no target" in n for n in body["notes"])


def test_every_targeted_ticker_unpriced_says_so(client, db_session):
    _seed_basic(db_session)
    with _prices():
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert body["lines"] == [] and body["leftover_eur"] == 500
    assert (
        "No ticker with a target could be priced right now. Try again in a few minutes."
        in (body["notes"])
    )
    assert not any("has a target weight yet" in n for n in body["notes"])


@pytest.mark.parametrize("amount", [100.009, 0.004, 0.001])
def test_the_amount_must_be_whole_cents(client, amount):
    assert client.post("/plans/preview", json={"amount": amount}).status_code == 422


def test_whole_and_cent_amounts_are_accepted(client, db_session):
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        for amount in (500, 500.5, 0.01):
            body = client.post("/plans/preview", json={"amount": amount})
            assert body.status_code == 200 and body.json()["amount_eur"] == amount


def test_an_overflowing_plan_is_422_on_save_and_still_previews(client, db_session):
    _holding(db_session, "AAA", 1e11, 0.5)
    _holding(db_session, "BBB", 1, 0.5)
    with _prices(AAA=1e9, BBB=100):
        assert client.post("/plans/preview", json={"amount": 500}).status_code == 200
        saved = client.post("/plans", json={"amount": 500})
    assert saved.status_code == 422 and saved.json()["detail"] == "This plan is too large to store."
    assert db_session.query(ContributionPlan).count() == 0


def test_saving_is_rate_limited(client, db_session):
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        statuses = [client.post("/plans", json={"amount": 500}).status_code for _ in range(11)]
    assert statuses[:10] == [201] * 10 and statuses[10] == 429


def test_the_export_includes_every_plan(client, db_session):
    for _ in range(121):
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
    assert len(client.get("/me/export").json()["contribution_plans"]) == 121


def test_a_drift_holding_without_a_price_is_left_out(client, db_session):
    _holding(db_session, "AAPL", 5, 0.4)
    _holding(db_session, "MSFT", 7.5, 0.4)
    _holding(db_session, "ODD", 1, 0.2)  # no price: not part of the pool
    with _prices(AAPL=200, MSFT=400):
        body = client.get("/plans/drift").json()
    assert [i["ticker"] for i in body] == ["AAPL", "MSFT"]


def _saved(client):
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        return client.post("/plans", json={"amount": 500}).json()


def test_saved_lines_carry_their_id_and_the_isin_of_the_holding_or_the_watchlist_item(
    client, db_session
):
    _seed_basic(db_session)
    db_session.query(Holding).filter_by(ticker="AAPL").update({"isin": "US0378331005"})
    db_session.query(WatchlistItem).filter_by(ticker="NVDA").update({"isin": "US5949181045"})
    db_session.commit()
    plan = _saved(client)
    lines = {ln["ticker"]: ln for ln in client.get(f"/plans/{plan['id']}").json()["lines"]}
    assert lines["AAPL"]["isin"] == "US0378331005"
    assert lines["NVDA"]["isin"] == "US5949181045"
    assert all(isinstance(ln["id"], int) for ln in lines.values())
    assert all(ln["placed_at"] is None and ln["placed_trade_id"] is None for ln in lines.values())


def test_the_holdings_isin_wins_over_the_watchlists(client, db_session):
    _seed_basic(db_session)
    _watch(db_session, "AAPL", 0.1)
    db_session.query(Holding).filter_by(ticker="AAPL").update({"isin": "US0378331005"})
    db_session.query(WatchlistItem).filter_by(ticker="AAPL").update({"isin": "US5949181045"})
    db_session.commit()
    plan = _saved(client)
    lines = client.get(f"/plans/{plan['id']}").json()["lines"]
    line = next(ln for ln in lines if ln["ticker"] == "AAPL")
    assert line["isin"] == "US0378331005"


def test_an_isin_added_after_saving_shows_on_the_old_plan(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    assert all(ln["isin"] is None for ln in client.get(f"/plans/{plan['id']}").json()["lines"])
    client.put("/portfolio/instruments/AAPL/isin", json={"isin": "US0378331005"})
    lines = client.get(f"/plans/{plan['id']}").json()["lines"]
    line = next(ln for ln in lines if ln["ticker"] == "AAPL")
    assert line["isin"] == "US0378331005"


def test_a_preview_has_no_line_ids(client, db_session):
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert all(ln["id"] is None and ln["isin"] is None for ln in body["lines"])


def test_another_persons_isin_never_leaks_onto_my_lines(client, db_session):
    _seed_basic(db_session)
    _holding(db_session, "AAPL", 1, 0.1, user_id=OTHER_USER_ID)
    db_session.query(Holding).filter_by(user_id=OTHER_USER_ID).update({"isin": "US0378331005"})
    db_session.commit()
    plan = _saved(client)
    assert all(ln["isin"] is None for ln in client.get(f"/plans/{plan['id']}").json()["lines"])


def _line(client, plan, ticker):
    return next(
        ln for ln in client.get(f"/plans/{plan['id']}").json()["lines"] if ln["ticker"] == ticker
    )


def _place(client, plan, line, **body):
    payload = {"date": "2026-10-09", "shares": 1.5, "price": 210.0, **body}
    return client.post(f"/plans/{plan['id']}/lines/{line['id']}/placed", json=payload)


def test_placing_a_line_of_a_held_ticker_logs_the_buy_like_the_trade_route(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    line = _line(client, plan, "AAPL")
    res = _place(client, plan, line, shares=2, price=250)
    assert res.status_code == 200 and res.json()["placed_trade_id"] is not None
    assert res.json()["placed_at"] is not None
    holding = db_session.query(Holding).filter_by(user_id=USER_ID, ticker="AAPL").one()
    db_session.refresh(holding)
    assert float(holding.shares) == 7.0 and round(float(holding.cost_basis), 4) == round(
        (5 * 10 + 2 * 250) / 7, 4
    )
    trade = db_session.query(Trade).filter_by(user_id=USER_ID).one()
    assert (trade.ticker, trade.action, float(trade.shares), float(trade.price)) == (
        "AAPL",
        "BUY",
        2.0,
        250.0,
    )
    assert _line(client, plan, "AAPL")["placed_trade_id"] == trade.id


def test_the_plans_euro_price_is_never_written_to_the_trade(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    line = _line(client, plan, "AAPL")
    _place(client, plan, line, shares=1, price=999.5)
    assert float(db_session.query(Trade).one().price) == 999.5  # exactly what the person sent


def test_placing_a_new_position_creates_the_holding(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    line = _line(client, plan, "NVDA")  # on the watchlist, not held
    assert _place(client, plan, line, asset_type="STOCK", shares=2.6, price=130).status_code == 200
    holding = db_session.query(Holding).filter_by(user_id=USER_ID, ticker="NVDA").one()
    assert (holding.asset_type, holding.name) == ("STOCK", line["name"])
    assert (float(holding.shares), float(holding.cost_basis)) == (2.6, 130.0)
    assert str(holding.first_purchase_date) == "2026-10-09"


def test_a_new_position_needs_an_asset_type(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    line = _line(client, plan, "NVDA")
    assert _place(client, plan, line).status_code == 422
    assert db_session.query(Holding).filter_by(user_id=USER_ID, ticker="NVDA").count() == 0
    assert db_session.query(Trade).count() == 0


def test_a_line_can_be_placed_once(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    line = _line(client, plan, "AAPL")
    assert _place(client, plan, line).status_code == 200
    assert _place(client, plan, line).status_code == 409
    assert db_session.query(Trade).count() == 1
    holding = db_session.query(Holding).filter_by(user_id=USER_ID, ticker="AAPL").one()
    db_session.refresh(holding)
    assert float(holding.shares) == 5.0 + 1.5  # the second click changed nothing


def test_another_persons_line_is_404_and_changes_nothing(client, db_session):
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
    other_line = ContributionPlanLine(
        user_id=OTHER_USER_ID,
        plan_id=other.id,
        ticker="AAPL",
        name="Apple",
        amount_eur=100,
        shares=1,
        price_eur=100,
        currency="EUR",
        rate=1,
        reason="underweight",
    )
    db_session.add(other_line)
    db_session.commit()
    res = client.post(
        f"/plans/{other.id}/lines/{other_line.id}/placed",
        json={"date": "2026-10-09", "shares": 1, "price": 1},
    )
    assert res.status_code == 404
    assert db_session.query(Trade).count() == 0
    assert db_session.get(ContributionPlanLine, other_line.id).placed_at is None


def test_a_line_id_from_another_plan_is_404(client, db_session):
    _seed_basic(db_session)
    first, second = _saved(client), _saved(client)
    line = _line(client, first, "AAPL")
    res = client.post(
        f"/plans/{second['id']}/lines/{line['id']}/placed",
        json={"date": "2026-10-09", "shares": 1, "price": 1},
    )
    assert res.status_code == 404


@pytest.mark.parametrize(
    "body", [{"shares": 0}, {"shares": -1}, {"price": 0}, {"price": "x"}, {"date": "nope"}]
)
def test_bad_shares_price_or_date_are_422(client, db_session, body):
    _seed_basic(db_session)
    plan = _saved(client)
    assert _place(client, plan, _line(client, plan, "AAPL"), **body).status_code == 422
    assert db_session.query(Trade).count() == 0


def test_a_new_position_past_the_holding_cap_is_409_and_writes_nothing(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    line = _line(client, plan, "NVDA")
    for i in range(98):  # 2 held + 98 = 100
        _holding(db_session, f"T{i}", 1, None)
    res = _place(client, plan, line, asset_type="STOCK")
    assert res.status_code == 409
    assert db_session.query(Trade).count() == 0
    assert db_session.get(ContributionPlanLine, line["id"]).placed_at is None
    assert db_session.query(Holding).filter_by(user_id=USER_ID, ticker="NVDA").count() == 0


def test_deleting_a_plan_keeps_the_trades_it_produced(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    _place(client, plan, _line(client, plan, "AAPL"))
    assert client.delete(f"/plans/{plan['id']}").status_code == 204
    assert db_session.query(Trade).count() == 1
    assert db_session.query(ContributionPlanLine).filter_by(plan_id=plan["id"]).count() == 0


def test_placing_is_rate_limited_per_person(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    line = _line(client, plan, "AAPL")
    codes = [_place(client, plan, line).status_code for _ in range(62)]
    assert codes[0] == 200 and 429 in codes


def test_placing_requires_authentication(anon_client):
    assert (
        anon_client.post(
            "/plans/1/lines/1/placed", json={"date": "2026-10-09", "shares": 1, "price": 1}
        ).status_code
        == 401
    )


def test_a_placement_then_a_manual_trade_accumulate_both_buys(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    assert _place(client, plan, _line(client, plan, "AAPL"), shares=2, price=250).status_code == 200
    manual = {"date": "2026-10-10", "ticker": "AAPL", "action": "BUY", "shares": 3, "price": 100}
    assert client.post("/portfolio/trades", json=manual).status_code == 200
    holding = db_session.query(Holding).filter_by(user_id=USER_ID, ticker="AAPL").one()
    db_session.refresh(holding)
    assert float(holding.shares) == 10.0
    assert round(float(holding.cost_basis), 4) == round((5 * 10 + 2 * 250 + 3 * 100) / 10, 4)
    assert db_session.query(Trade).count() == 2


@pytest.mark.parametrize("literal", ['"Infinity"', "Infinity", "1e999"])
def test_infinite_numbers_are_422(client, db_session, literal):
    _seed_basic(db_session)
    plan = _saved(client)
    line = _line(client, plan, "AAPL")
    raw = f'{{"date": "2026-10-09", "shares": {literal}, "price": 1}}'  # raw JSON text
    res = client.post(
        f"/plans/{plan['id']}/lines/{line['id']}/placed",
        content=raw,
        headers={"content-type": "application/json"},
    )
    assert res.status_code == 422
    assert db_session.query(Trade).count() == 0


def test_a_huge_finite_number_is_422_and_writes_nothing(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    line = _line(client, plan, "AAPL")
    assert _place(client, plan, line, shares=1e30).status_code == 422
    assert db_session.query(Trade).count() == 0
    assert db_session.get(ContributionPlanLine, line["id"]).placed_at is None
    holding = db_session.query(Holding).filter_by(user_id=USER_ID, ticker="AAPL").one()
    db_session.refresh(holding)
    assert float(holding.shares) == 5.0
