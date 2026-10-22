from unittest.mock import AsyncMock, patch

import pytest

from app.models import Recommendation
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user

CLOSES = {"2026-10-19": 172.0, "2026-10-16": 170.5, "2026-10-17": 171.25}


def seed(db, ticker="HLDN", user_id=USER_ID, source="discovery", currency="USD", status="PENDING"):
    rec = Recommendation(
        user_id=user_id,
        ticker=ticker,
        asset_type="STOCK",
        action="BUY",
        reasoning=["test"],
        source=source,
        status=status,
        idea={"snapshot": {"currency": currency}} if source == "discovery" else None,
    )
    db.add(rec)
    db.commit()
    return rec.id


def history(client, rec_id, closes=CLOSES, quote_currency="USD", **params):
    """GET the history with the provider faked; returns the response and the closes mock."""
    fetch = AsyncMock(side_effect=closes if isinstance(closes, Exception) else None)
    if not isinstance(closes, Exception):
        fetch.return_value = closes
    currency = AsyncMock(
        side_effect=quote_currency if isinstance(quote_currency, Exception) else None
    )
    if not isinstance(quote_currency, Exception):
        currency.return_value = quote_currency
    with (
        patch("app.routers.discovery.fetch_dated_closes", fetch),
        patch("app.routers.discovery.fetch_currency", currency),
    ):
        return client.get(f"/discovery/ideas/{rec_id}/history", params=params), fetch


@pytest.mark.parametrize(
    "range_, period", [("1w", "5d"), ("1m", "1mo"), ("6m", "6mo"), ("1y", "1y"), ("5y", "5y")]
)
def test_each_range_asks_the_provider_for_its_period(client, db_session, range_, period):
    rec_id = seed(db_session)

    response, fetch = history(client, rec_id, range=range_)

    assert response.status_code == 200
    assert response.json()["range"] == range_
    fetch.assert_awaited_once_with("HLDN", period, strict=True)


def test_default_range_is_one_year(client, db_session):
    response, fetch = history(client, seed(db_session))

    assert response.json()["range"] == "1y"
    fetch.assert_awaited_once_with("HLDN", "1y", strict=True)


def test_returns_dated_closes_oldest_first_with_the_last_date_as_of(client, db_session):
    response, _ = history(client, seed(db_session))

    body = response.json()
    assert body["ticker"] == "HLDN"
    assert body["currency"] == "USD"
    assert body["as_of"] == "2026-10-19"
    assert body["points"] == [
        {"date": "2026-10-16", "close": 170.5},
        {"date": "2026-10-17", "close": 171.25},
        {"date": "2026-10-19", "close": 172.0},
    ]
    assert response.headers["cache-control"] == "no-store"


def test_a_pence_quote_is_converted_to_pounds(client, db_session):
    rec_id = seed(db_session, "ULVR.L", currency="GBP")

    response, _ = history(client, rec_id, {"2026-10-19": 4234.5, "2026-10-16": 4210.0}, "GBp")

    body = response.json()
    assert body["currency"] == "GBP"
    assert [p["close"] for p in body["points"]] == [42.1, 42.345]


@pytest.mark.parametrize(
    "quote, major, close",
    [("ZAc", "ZAR", 12.0), ("ILA", "ILS", 12.0), ("GBX", "GBP", 12.0), ("EUR", "EUR", 1200.0)],
)
def test_other_minor_units_convert_and_major_units_do_not(client, db_session, quote, major, close):
    response, _ = history(client, seed(db_session, "X.Z"), {"2026-10-19": 1200.0}, quote)

    assert response.json()["currency"] == major
    assert response.json()["points"][0]["close"] == close


def test_no_history_is_an_empty_list_not_an_error(client, db_session):
    response, _ = history(client, seed(db_session), {})

    assert response.status_code == 200
    assert response.json() == {
        "ticker": "HLDN",
        "currency": "USD",
        "as_of": None,
        "range": "1y",
        "points": [],
    }


def test_unknown_quote_currency_falls_back_to_a_saved_major_unit_that_has_no_minor_form(
    client, db_session
):
    response, _ = history(client, seed(db_session, currency="USD"), quote_currency=RuntimeError())

    assert response.json()["currency"] == "USD"
    assert len(response.json()["points"]) == 3


@pytest.mark.parametrize("saved", ["GBP", "ZAR", "ILS", None])
def test_unknown_quote_currency_with_a_saved_unit_that_could_be_minor_is_a_502_not_a_guess(
    client, db_session, saved
):
    response, _ = history(client, seed(db_session, currency=saved), quote_currency=RuntimeError())

    assert response.status_code == 502  # a series 100 times too high is never sent
    assert response.json()["detail"] == "Price history is unavailable"


@pytest.mark.parametrize("saved", ["GBP", None])
def test_unknown_quote_currency_with_no_history_is_still_just_empty(client, db_session, saved):
    response, _ = history(
        client, seed(db_session, currency=saved), {}, quote_currency=RuntimeError()
    )

    assert response.status_code == 200
    assert response.json()["points"] == []


def test_a_provider_failure_is_a_502_with_a_plain_detail(client, db_session):
    response, _ = history(client, seed(db_session), RuntimeError("yahoo down"))

    assert response.status_code == 502
    assert response.json()["detail"] == "Price history is unavailable"


def test_another_users_idea_is_a_404_and_the_provider_is_never_asked(client, db_session):
    add_app_user(db_session, OTHER_USER_ID)
    theirs = seed(db_session, user_id=OTHER_USER_ID)

    response, fetch = history(client, theirs)

    assert response.status_code == 404
    fetch.assert_not_awaited()


def test_an_unknown_id_and_a_holdings_recommendation_are_404s(client, db_session):
    holdings_rec = seed(db_session, source="manual")

    for rec_id in (999999, holdings_rec):
        response, fetch = history(client, rec_id)
        assert response.status_code == 404
        fetch.assert_not_awaited()


def test_a_dismissed_idea_still_has_its_history(client, db_session):
    response, _ = history(client, seed(db_session, status="DISMISSED"))

    assert response.status_code == 200


@pytest.mark.parametrize("bad", ["2y", "1d", "", "max"])
def test_an_unknown_range_is_a_422(client, db_session, bad):
    response, fetch = history(client, seed(db_session), range=bad)

    assert response.status_code == 422
    fetch.assert_not_awaited()


def test_the_ticker_comes_from_the_saved_idea_not_the_client(client, db_session):
    rec_id = seed(db_session, "HLDN")

    _, fetch = history(client, rec_id, ticker="EVIL")

    fetch.assert_awaited_once_with("HLDN", "1y", strict=True)


@pytest.mark.parametrize("bad_id", [0, -1, 2**31, 10**20])
def test_an_id_the_column_cannot_hold_is_a_422_not_a_500(client, bad_id):
    response, fetch = history(client, bad_id)

    assert response.status_code == 422
    fetch.assert_not_awaited()
