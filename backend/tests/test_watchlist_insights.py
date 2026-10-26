from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.models import WatchlistItem
from app.schemas import WatchlistItemIn, WatchlistSummaryOut
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user


def watch(client, ticker, low=None, high=None, **extra):
    body = {"ticker": ticker, "asset_type": "STOCK", **extra}
    if low is not None or high is not None:
        body.update(target_price_low=low, target_price_high=high)
    return client.post("/portfolio/watchlist", json=body)


def store_currency(db_session, ticker, currency):
    """Set the currency a company was saved with (Discover fills it in when a company is added)."""
    item = db_session.query(WatchlistItem).filter_by(ticker=ticker).one()
    item.currency = currency
    db_session.commit()


def get_insights(client, prices, stale=(), currency="USD"):
    """GET /portfolio/insights with quotes faked: {ticker: price or an Exception}.

    `currency` is what the provider says a company is quoted in (a company with none stored).
    """

    async def quote(ticker):
        value = prices[ticker]
        if isinstance(value, Exception):
            raise value
        return {"price": value, "closes": [value], "stale": ticker in stale}

    mock = AsyncMock(side_effect=quote)
    with (
        patch("app.routers.portfolio.fetch_quote_and_history", mock),
        patch("app.fx.fetch_currency", AsyncMock(return_value=currency)),
    ):
        return client.get("/portfolio/insights"), mock


def test_a_target_price_range_is_saved_and_listed(client):
    response = watch(client, "NVDA", 90.5, 110)

    assert response.status_code == 200
    assert response.json()["target_price_low"] == 90.5
    assert response.json()["target_price_high"] == 110
    listed = client.get("/portfolio/watchlist").json()[0]
    assert (listed["target_price_low"], listed["target_price_high"]) == (90.5, 110)


def test_an_item_without_a_range_has_none(client):
    body = watch(client, "NVDA").json()

    assert body["target_price_low"] is None
    assert body["target_price_high"] is None


@pytest.mark.parametrize(
    "low, high",
    [
        (100, None),
        (None, 100),
        (120, 100),
        (0, 100),
        (-5, 100),
        (1, 1e12),  # the column holds less than 10^12
        (1, 1e13),
    ],
)
def test_an_invalid_range_is_refused(client, low, high):
    body = {"ticker": "NVDA", "asset_type": "STOCK"}
    body["target_price_low"] = low
    body["target_price_high"] = high

    assert client.post("/portfolio/watchlist", json=body).status_code == 422
    assert client.get("/portfolio/watchlist").json() == []


def test_a_range_with_equal_ends_is_allowed(client):
    assert watch(client, "NVDA", 100, 100).status_code == 200


def test_readding_without_a_range_keeps_it(client):
    watch(client, "NVDA", 90, 110)
    watch(client, "NVDA", note="n")

    item = client.get("/portfolio/watchlist").json()[0]
    assert (item["target_price_low"], item["target_price_high"]) == (90, 110)


def test_both_ends_null_clears_the_range(client):
    watch(client, "NVDA", 90, 110)
    client.post(
        "/portfolio/watchlist",
        json={
            "ticker": "NVDA",
            "asset_type": "STOCK",
            "target_price_low": None,
            "target_price_high": None,
        },
    )

    item = client.get("/portfolio/watchlist").json()[0]
    assert item["target_price_low"] is None
    assert item["target_price_high"] is None


def test_naming_only_one_end_is_refused_and_leaves_the_range_alone(client):
    watch(client, "NVDA", 90, 110)

    for one_end in ({"target_price_low": None}, {"target_price_high": 120}):
        response = client.post(
            "/portfolio/watchlist", json={"ticker": "NVDA", "asset_type": "STOCK", **one_end}
        )
        assert response.status_code == 422

    item = client.get("/portfolio/watchlist").json()[0]
    assert (item["target_price_low"], item["target_price_high"]) == (90, 110)


def test_output_models_do_not_re_run_the_input_rule():
    # One odd stored row must not turn the whole list, summary or export into a 500.
    row = {"ticker": "ODD", "asset_type": "STOCK", "target_price_low": 5}

    assert WatchlistSummaryOut.model_validate(row).target_price_high is None
    with pytest.raises(ValidationError):
        WatchlistItemIn.model_validate(row)


def test_the_database_refuses_a_half_range(db_session):
    db_session.add(
        WatchlistItem(user_id=USER_ID, ticker="NVDA", asset_type="STOCK", target_price_low=5)
    )

    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_insights_list_an_item_whose_price_is_inside_its_range(client):
    watch(client, "NVDA", 90, 110)

    response, _ = get_insights(client, {"NVDA": 100.0})

    assert response.status_code == 200
    assert response.json() == {
        "insights": [
            {
                "ticker": "NVDA",
                "kind": "in_target_range",
                "text": "Entered your target price range",
                "currency": "USD",
                "current_price": 100.0,
                "target_price_low": 90.0,
                "target_price_high": 110.0,
            }
        ],
        "missing": [],
    }


def test_insights_show_a_pence_quoted_company_in_pounds(client, db_session):
    watch(client, "SHEL.L", 650, 720.5)
    store_currency(db_session, "SHEL.L", "GBp")

    response, _ = get_insights(client, {"SHEL.L": 700.0})

    [insight] = response.json()["insights"]
    assert insight["currency"] == "GBP"
    assert (
        insight["current_price"],
        insight["target_price_low"],
        insight["target_price_high"],
    ) == (
        7.0,
        6.5,
        7.205,
    )


def test_insights_use_the_stored_currency_without_asking_the_provider(client, db_session):
    watch(client, "NVDA", 90, 110)
    store_currency(db_session, "NVDA", "USD")

    with patch("app.fx.fetch_currency", AsyncMock(side_effect=AssertionError)):

        async def quote(_ticker):
            return {"price": 100.0, "closes": [100.0], "stale": False}

        with patch("app.routers.portfolio.fetch_quote_and_history", AsyncMock(side_effect=quote)):
            response = client.get("/portfolio/insights")

    assert response.json()["insights"][0]["currency"] == "USD"


def test_insights_ask_the_provider_for_a_company_with_no_stored_currency(client):
    watch(client, "ABC.L", 650, 720.5)

    response, _ = get_insights(client, {"ABC.L": 700.0}, currency="GBp")

    [insight] = response.json()["insights"]
    assert (insight["currency"], insight["current_price"]) == ("GBP", 7.0)


def test_insights_report_missing_rather_than_guess_when_the_currency_is_unknown(client):
    watch(client, "ABC", 90, 110)

    response, _ = get_insights(client, {"ABC": 100.0}, currency=None)

    assert response.json() == {"insights": [], "missing": ["prices"]}


def test_insights_report_missing_when_the_currency_lookup_fails(client):
    watch(client, "ABC", 90, 110)

    async def quote(_ticker):
        return {"price": 100.0, "closes": [100.0], "stale": False}

    with (
        patch("app.routers.portfolio.fetch_quote_and_history", AsyncMock(side_effect=quote)),
        patch("app.fx.fetch_currency", AsyncMock(side_effect=RuntimeError("down"))),
    ):
        response = client.get("/portfolio/insights")

    assert response.status_code == 200
    assert response.json() == {"insights": [], "missing": ["prices"]}


def test_insights_without_a_currency_do_not_hide_the_ones_with_one(client, db_session):
    watch(client, "KNOWN", 90, 110)
    watch(client, "UNKNOWN", 90, 110)
    store_currency(db_session, "KNOWN", "USD")

    async def quote(_ticker):
        return {"price": 100.0, "closes": [100.0], "stale": False}

    with (
        patch("app.routers.portfolio.fetch_quote_and_history", AsyncMock(side_effect=quote)),
        patch("app.fx.fetch_currency", AsyncMock(return_value=None)),
    ):
        body = client.get("/portfolio/insights").json()

    assert [i["ticker"] for i in body["insights"]] == ["KNOWN"]
    assert body["missing"] == ["prices"]


def test_insights_include_both_ends_of_the_range(client):
    watch(client, "LOW", 90, 110)
    watch(client, "HIGH", 90, 110)

    response, _ = get_insights(client, {"LOW": 90.0, "HIGH": 110.0})

    assert [i["ticker"] for i in response.json()["insights"]] == ["HIGH", "LOW"]


def test_insights_skip_a_price_outside_the_range(client):
    watch(client, "ABOVE", 90, 110)
    watch(client, "BELOW", 90, 110)

    response, _ = get_insights(client, {"ABOVE": 110.01, "BELOW": 89.99})

    assert response.json() == {"insights": [], "missing": []}


def test_insights_only_price_items_that_have_a_range(client):
    watch(client, "NVDA", 90, 110)
    watch(client, "PLAIN")

    response, mock = get_insights(client, {"NVDA": 100.0})

    assert response.status_code == 200
    assert [c.args[0] for c in mock.await_args_list] == ["NVDA"]


def test_insights_with_no_ranges_fetch_nothing(client):
    watch(client, "PLAIN")

    response, mock = get_insights(client, {})

    assert response.json() == {"insights": [], "missing": []}
    mock.assert_not_awaited()


def test_a_stale_or_failed_quote_is_missing_not_an_insight(client):
    watch(client, "STALE", 90, 110)
    watch(client, "DOWN", 90, 110)
    watch(client, "FINE", 90, 110)

    response, _ = get_insights(
        client, {"STALE": 100.0, "DOWN": RuntimeError("boom"), "FINE": 100.0}, stale={"STALE"}
    )

    body = response.json()
    assert [i["ticker"] for i in body["insights"]] == ["FINE"]
    assert body["missing"] == ["prices"]


def test_insights_never_include_another_users_watchlist(client, db_session):
    add_app_user(db_session, OTHER_USER_ID)
    db_session.add(
        WatchlistItem(
            user_id=OTHER_USER_ID,
            ticker="THEIRS",
            asset_type="STOCK",
            target_price_low=90,
            target_price_high=110,
        )
    )
    db_session.commit()
    watch(client, "MINE", 90, 110)

    response, mock = get_insights(client, {"MINE": 100.0, "THEIRS": 100.0})

    assert [i["ticker"] for i in response.json()["insights"]] == ["MINE"]
    assert [c.args[0] for c in mock.await_args_list] == ["MINE"]
