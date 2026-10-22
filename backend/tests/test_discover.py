from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Recommendation, WatchlistItem
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user

PROFILE = {"name": "Halden Systems", "exchange": "NASDAQ", "currency": "USD"}


def now():
    return datetime.now(UTC).replace(tzinfo=None)


def seed(db, ticker, *, user_id=USER_ID, days_ago=None, **fields):
    created = None if days_ago is None else now() - timedelta(days=days_ago)
    db.add(
        WatchlistItem(
            user_id=user_id, ticker=ticker, asset_type="STOCK", created_at=created, **fields
        )
    )
    db.commit()


def idea(
    db,
    ticker,
    headline="Recurring revenue, priced below peers.",
    user_id=USER_ID,
    source="discovery",
    age=0,
):
    rec = Recommendation(
        user_id=user_id,
        ticker=ticker,
        asset_type="STOCK",
        action="BUY",
        reasoning=["r"],
        source=source,
        status="PENDING",
        idea={"headline": headline} if headline is not None else {},
        created_at=now() - timedelta(days=age),
    )
    db.add(rec)
    db.commit()
    return rec.id


def listing(client, quotes):
    """GET /discover with quotes faked: {ticker: (price, closes) or an Exception}."""

    async def quote(ticker):
        value = quotes[ticker]
        if isinstance(value, Exception):
            raise value
        price, closes = value
        return {"price": price, "closes": closes, "as_of": "2026-10-21", "stale": False}

    with patch("app.routers.discover.fetch_quote_and_history", AsyncMock(side_effect=quote)):
        return client.get("/discover")


def add(client, body, profile=PROFILE):
    if isinstance(profile, Exception):
        mock = AsyncMock(side_effect=profile)
    else:
        mock = AsyncMock(return_value=profile)
    with patch("app.routers.discover.fetch_profile", mock):
        return client.post("/discover", json=body), mock


def test_the_list_shows_each_company_with_its_quote_and_daily_change(client, db_session):
    seed(
        db_session,
        "HLDN",
        days_ago=2,
        name="Halden Systems",
        exchange="NASDAQ",
        currency="USD",
        source="today",
    )

    response = listing(client, {"HLDN": (184.2, [180.0, 184.2])})

    assert response.status_code == 200
    body = response.json()
    assert body["missing"] == []
    item = body["items"][0]
    assert (item["ticker"], item["name"], item["exchange"], item["currency"], item["source"]) == (
        "HLDN",
        "Halden Systems",
        "NASDAQ",
        "USD",
        "today",
    )
    assert item["price"] == 184.2
    assert item["change_pct"] == pytest.approx(2.3333, abs=1e-3)
    assert item["price_as_of"] == "2026-10-21"
    assert item["stale"] is False
    assert item["added_at"] is not None


def test_a_pence_quote_is_shown_in_pounds_and_so_are_the_targets(client, db_session):
    seed(
        db_session,
        "MRLW.L",
        name="Marlow Water",
        currency="GBp",
        target_price_low=1200,
        target_price_high=1300,
    )

    item = listing(client, {"MRLW.L": (1284.0, [1280.0, 1284.0])}).json()["items"][0]

    assert item["currency"] == "GBP"
    assert item["price"] == pytest.approx(12.84)
    assert (item["target_price_low"], item["target_price_high"]) == (
        pytest.approx(12.0),
        pytest.approx(13.0),
    )


def test_a_company_with_no_stored_currency_gets_it_from_the_provider_so_pence_are_not_pounds(
    client, db_session
):
    seed(db_session, "MRLW.L", name="Marlow Water")  # currency was not known when it was added

    with patch("app.routers.discover.fetch_currency", AsyncMock(return_value="GBp")):
        item = listing(client, {"MRLW.L": (1284.0, [1280.0, 1284.0])}).json()["items"][0]

    assert (item["currency"], item["price"]) == ("GBP", pytest.approx(12.84))


def test_a_company_whose_currency_cannot_be_found_shows_its_price_without_claiming_a_unit(
    client, db_session
):
    seed(db_session, "MRLW.L")

    with patch("app.routers.discover.fetch_currency", AsyncMock(side_effect=RuntimeError("down"))):
        item = listing(client, {"MRLW.L": (1284.0, [1280.0, 1284.0])}).json()["items"][0]

    assert item["currency"] is None and item["price"] == 1284.0


def test_status_and_insight_come_from_the_latest_saved_discovery_idea_only(client, db_session):
    seed(db_session, "HLDN")
    seed(db_session, "NVKC")
    seed(db_session, "PLMN")
    older = idea(db_session, "HLDN", "An older reading.", age=5)
    newest = idea(db_session, "HLDN", "The newest reading.", age=1)
    idea(db_session, "PLMN", "A holdings call, not research.", source="manual")
    quotes = {t: (10.0, [10.0, 10.0]) for t in ("HLDN", "NVKC", "PLMN")}

    items = {i["ticker"]: i for i in listing(client, quotes).json()["items"]}

    assert newest != older
    assert (items["HLDN"]["status"], items["HLDN"]["insight"], items["HLDN"]["report_id"]) == (
        "analyzed",
        "The newest reading.",
        newest,
    )
    assert items["NVKC"]["status"] == "none" and items["NVKC"]["insight"] is None
    assert items["PLMN"]["status"] == "none"  # a manual recommendation is not research


def test_an_analyzed_company_without_a_headline_has_no_insight(client, db_session):
    seed(db_session, "HLDN")
    idea(db_session, "HLDN", headline=None)

    item = listing(client, {"HLDN": (1.0, [1.0, 1.0])}).json()["items"][0]

    assert item["status"] == "analyzed" and item["insight"] is None


def test_a_failed_quote_leaves_no_price_and_says_prices_are_missing(client, db_session):
    seed(db_session, "HLDN")
    seed(db_session, "NVKC")

    body = listing(client, {"HLDN": RuntimeError("down"), "NVKC": (5.0, [5.0, 5.0])}).json()

    items = {i["ticker"]: i for i in body["items"]}
    assert items["HLDN"]["price"] is None
    assert items["HLDN"]["change_pct"] is None
    assert items["HLDN"]["stale"] is True
    assert items["NVKC"]["price"] == 5.0
    assert body["missing"] == ["prices"]


def test_one_close_gives_a_price_but_no_change(client, db_session):
    seed(db_session, "HLDN")

    item = listing(client, {"HLDN": (5.0, [5.0])}).json()["items"][0]

    assert item["price"] == 5.0 and item["change_pct"] is None


def test_newest_first_and_an_item_from_before_discover_keeps_no_invented_date(client, db_session):
    seed(db_session, "OLDX")  # added before the date was recorded
    seed(db_session, "NEWX", days_ago=1)
    seed(db_session, "MIDX", days_ago=5)

    body = listing(client, {t: (1.0, [1.0, 1.0]) for t in ("OLDX", "NEWX", "MIDX")}).json()

    assert [i["ticker"] for i in body["items"]] == ["NEWX", "MIDX", "OLDX"]
    assert body["items"][-1]["added_at"] is None


def test_the_list_holds_only_the_callers_companies_and_quotes_only_those(client, db_session):
    add_app_user(db_session, OTHER_USER_ID)
    seed(db_session, "MINE")
    seed(db_session, "THEIRS", user_id=OTHER_USER_ID)
    idea(db_session, "THEIRS", "Their private reading.", user_id=OTHER_USER_ID)
    asked = []

    async def quote(ticker):
        asked.append(ticker)
        return {"price": 1.0, "closes": [1.0, 1.0], "as_of": "2026-10-21", "stale": False}

    with patch("app.routers.discover.fetch_quote_and_history", AsyncMock(side_effect=quote)):
        body = client.get("/discover").json()

    assert [i["ticker"] for i in body["items"]] == ["MINE"]
    assert asked == ["MINE"]
    assert "Their private reading." not in str(body)


def test_an_empty_list_asks_for_nothing(client):
    with patch("app.routers.discover.fetch_quote_and_history", AsyncMock()) as quote:
        body = client.get("/discover").json()

    assert body == {"items": [], "missing": []}
    quote.assert_not_awaited()


def test_adding_fills_name_exchange_and_currency_from_the_profile_and_stamps_the_date(client):
    response, profile = add(client, {"ticker": "HLDN", "asset_type": "STOCK"})

    assert response.status_code == 200
    body = response.json()
    assert (body["name"], body["exchange"], body["currency"], body["source"]) == (
        "Halden Systems",
        "NASDAQ",
        "USD",
        "manual",
    )
    assert body["created_at"] is not None
    profile.assert_awaited_once_with("HLDN")


def test_the_name_exchange_and_currency_are_never_taken_from_the_request(client):
    body = {
        "ticker": "HLDN",
        "asset_type": "STOCK",
        "name": "Evil Corp",
        "exchange": "X",
        "currency": "BTC",
    }

    response, _ = add(client, body)

    assert response.status_code == 200
    assert response.json()["name"] == "Halden Systems"
    assert response.json()["currency"] == "USD"


def test_provider_text_longer_than_its_column_is_cut_or_ignored_never_a_failed_insert(client):
    long = {"name": "N" * 150, "exchange": "E" * 100, "currency": "C" * 100}

    response, _ = add(client, {"ticker": "HLDN", "asset_type": "STOCK"}, long)

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "N" * 150
    assert body["exchange"] == "E" * 60  # cut to its column
    assert body["currency"] is None  # not a currency code, so not stored


def test_a_profile_value_of_the_wrong_type_is_ignored_not_a_failed_request(client):
    response, _ = add(
        client,
        {"ticker": "HLDN", "asset_type": "STOCK"},
        {"name": 5, "exchange": ["x"], "currency": {"a": 1}},
    )

    assert response.status_code == 200
    assert response.json()["name"] is None


def test_an_add_through_the_older_watchlist_route_is_dated_too(client):
    response = client.post("/portfolio/watchlist", json={"ticker": "HLDN", "asset_type": "STOCK"})

    assert response.json()["created_at"] is not None
    assert response.json()["source"] == "manual"


def test_a_company_saved_from_today_is_marked_so(client):
    response, _ = add(client, {"ticker": "HLDN", "asset_type": "STOCK", "source": "today"})

    assert response.json()["source"] == "today"


def test_an_unknown_source_is_refused(client):
    response, _ = add(client, {"ticker": "HLDN", "asset_type": "STOCK", "source": "admin"})

    assert response.status_code == 422


def test_a_failed_profile_still_adds_the_company_with_no_name(client):
    response, _ = add(client, {"ticker": "HLDN", "asset_type": "STOCK"}, RuntimeError("down"))

    assert response.status_code == 200
    assert response.json()["name"] is None and response.json()["exchange"] is None


def test_adding_again_returns_the_same_company_keeping_its_source_and_date(client, db_session):
    first, _ = add(client, {"ticker": "HLDN", "asset_type": "STOCK", "source": "today"}, {})
    again, _ = add(client, {"ticker": "HLDN", "asset_type": "STOCK", "source": "manual"})

    assert again.status_code == 200
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["source"] == "today"
    assert again.json()["created_at"] == first.json()["created_at"]
    assert again.json()["name"] == "Halden Systems"  # the profile fills what was missing
    assert db_session.query(WatchlistItem).count() == 1


def test_adding_again_does_not_overwrite_what_is_already_known(client):
    add(client, {"ticker": "HLDN", "asset_type": "STOCK"})

    again, _ = add(
        client,
        {"ticker": "HLDN", "asset_type": "STOCK"},
        {"name": "Renamed", "exchange": "LSE", "currency": "GBp"},
    )

    assert again.json()["name"] == "Halden Systems"
    assert again.json()["currency"] == "USD"


def test_an_undo_re_adds_with_the_note_and_targets_the_person_had(client):
    body = {
        "ticker": "HLDN",
        "asset_type": "STOCK",
        "note": "chips",
        "target_weight": 0.05,
        "target_price_low": 90,
        "target_price_high": 110,
    }

    response, _ = add(client, body)

    row = response.json()
    assert (
        row["note"],
        row["target_weight"],
        row["target_price_low"],
        row["target_price_high"],
    ) == ("chips", 0.05, 90, 110)


def test_a_half_price_range_is_refused(client):
    response, _ = add(client, {"ticker": "HLDN", "asset_type": "STOCK", "target_price_low": 90})

    assert response.status_code == 422


def test_the_list_is_capped_at_one_hundred(client, db_session):
    for i in range(100):
        seed(db_session, f"T{i}")

    response, _ = add(client, {"ticker": "ONEMORE", "asset_type": "STOCK"})

    assert response.status_code == 409


def test_a_company_already_in_a_full_list_can_still_be_added_again(client, db_session):
    for i in range(100):
        seed(db_session, f"T{i}")

    response, _ = add(client, {"ticker": "T5", "asset_type": "STOCK"})

    assert response.status_code == 200


def test_removing_uses_the_existing_watchlist_route_and_the_company_leaves_the_list(client):
    add(client, {"ticker": "HLDN", "asset_type": "STOCK"})

    assert client.delete("/portfolio/watchlist/HLDN").status_code == 204
    with patch("app.routers.discover.fetch_quote_and_history", AsyncMock()):
        assert client.get("/discover").json()["items"] == []


def test_the_new_fields_are_in_the_watchlist_and_the_export(client):
    add(client, {"ticker": "HLDN", "asset_type": "STOCK", "source": "today"})

    listed = client.get("/portfolio/watchlist").json()[0]
    exported = client.get("/me/export").json()["watchlist_items"][0]

    for row in (listed, exported):
        assert (row["name"], row["exchange"], row["currency"], row["source"]) == (
            "Halden Systems",
            "NASDAQ",
            "USD",
            "today",
        )
        assert row["created_at"] is not None


def test_the_database_refuses_an_unknown_source(db_session):
    db_session.add(
        WatchlistItem(user_id=USER_ID, ticker="HLDN", asset_type="STOCK", source="admin")
    )

    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
