"""The holdings summary carries the ETF label the allocation donut groups by."""

import asyncio
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest

from app.analysis.portfolio import PositionInput, analyze_portfolio
from app.discovery.universe import etf_sector_label
from app.fx import EurPrice
from app.holdings import enrich_holdings
from app.schemas import HoldingSummaryOut

UNIVERSE_ETF = "IS3N.DE"
UNIVERSE_CATEGORY = "Global Emerging Markets Equity"


def _row(ticker, asset_type="ETF", sector=None):
    return HoldingSummaryOut(
        ticker=ticker, name=ticker, asset_type=asset_type, shares=1, sector=sector
    )


def _enrich(row, profile):
    with patch("app.holdings.fetch_profile", AsyncMock(return_value=profile)):
        asyncio.run(enrich_holdings([row], asyncio.Semaphore(1)))
    return row


def test_universe_etf_without_own_sector_or_profile_gets_the_universe_label_and_funds_country():
    row = _enrich(_row(UNIVERSE_ETF), {"country": "Ireland"})
    assert row.group_sector == f"ETF: {UNIVERSE_CATEGORY}"
    assert row.country == "Funds"
    assert row.sector is None  # the stored value is never overwritten


def test_own_sector_wins_and_is_left_stored():
    row = _enrich(_row(UNIVERSE_ETF, sector="My Fund"), {"category": "Global Equity"})
    assert row.group_sector == "ETF: My Fund"
    assert row.sector == "My Fund"


def test_yahoo_category_beats_the_universe():
    row = _enrich(_row(UNIVERSE_ETF), {"category": "Global Equity"})
    assert row.group_sector == "ETF: Global Equity"


def test_unresolved_etf_has_no_group_sector_but_is_still_funds():
    row = _enrich(_row("NOSUCHETF"), {})
    assert row.group_sector is None
    assert row.country == "Funds"


def test_stock_row_is_unchanged():
    row = _enrich(_row("AAPL", "STOCK", sector="Technology"), {"country": "United States"})
    assert row.group_sector is None
    assert row.country == "United States"
    assert row.sector == "Technology"


@pytest.mark.parametrize(
    ("own", "category", "ticker"),
    [
        ("My Fund", "Global Equity", UNIVERSE_ETF),
        (None, "Global Equity", UNIVERSE_ETF),
        ("  ", None, UNIVERSE_ETF),
        (None, None, "NOSUCHETF"),
        (None, "  Spaced   out  ", "NOSUCHETF"),
        ("x" * 150, None, "NOSUCHETF"),
    ],
)
def test_helper_matches_the_label_the_risk_panel_uses(own, category, ticker):
    profile = {"category": category} if category else {}
    exposure = analyze_portfolio(
        [PositionInput(ticker, "Fund", 1, "ETF", own)],
        {ticker: EurPrice(Decimal(100), "EUR", Decimal(1))},
        {},
        {ticker: profile},
        datetime(2026, 10, 15, 12, tzinfo=UTC),
    )
    # None from the helper is what the analytics call "Unclassified".
    label = etf_sector_label(own, category, ticker) or "Unclassified"
    assert label == exposure.by_sector[0].label


def test_summary_endpoint_returns_group_sector_for_a_universe_etf(client):
    client.post(
        "/portfolio/holdings",
        json={"ticker": UNIVERSE_ETF, "name": "Fund", "asset_type": "ETF", "shares": 2},
    )
    with patch(
        "app.routers.portfolio.fetch_quote_and_history",
        AsyncMock(return_value={"price": 10.0, "closes": [10.0]}),
    ):
        body = client.get("/portfolio/summary").json()
    [holding] = body["holdings"]
    assert holding["group_sector"] == f"ETF: {UNIVERSE_CATEGORY}"
    assert holding["country"] == "Funds"
    assert holding["sector"] is None


def test_changing_an_etf_to_stock_with_a_null_sector_clears_it_and_skips_the_yahoo_fill(client):
    fund = {"ticker": "VWCE.DE", "name": "Fund", "asset_type": "ETF", "shares": 1}
    client.post("/portfolio/holdings", json={**fund, "sector": "Global Equity"})

    with patch("app.holdings.fetch_profile", AsyncMock(return_value={"sector": "Technology"})):
        body = client.post(
            "/portfolio/holdings", json={**fund, "asset_type": "STOCK", "sector": None}
        ).json()

    assert body["asset_type"] == "STOCK"
    assert body["sector"] is None
