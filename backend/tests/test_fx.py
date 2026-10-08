import asyncio
from decimal import Decimal as D
from unittest.mock import AsyncMock, patch

import pytest

import app.redis_client as redis_client_module
from app import fx


def run(coro):
    try:
        return asyncio.run(coro)
    finally:
        redis_client_module._redis = None


def run_prices(tickers, quotes, currencies, rates=None):
    """quotes: ticker -> price; currencies: ticker -> currency; rates: symbol -> price."""
    rates = rates or {}

    async def quote(symbol):
        if symbol in rates:
            value = rates[symbol]
            if isinstance(value, Exception):
                raise value
            return {"price": value, "closes": [value]}
        if symbol not in quotes:
            raise RuntimeError("no quote")
        return {"price": quotes[symbol], "closes": [quotes[symbol]]}

    async def currency(ticker):
        return currencies.get(ticker)

    with (
        patch("app.fx.fetch_quote_and_history", AsyncMock(side_effect=quote)) as q,
        patch("app.fx.fetch_currency", AsyncMock(side_effect=currency)),
    ):
        return run(fx.eur_prices(set(tickers))), q


def test_a_euro_ticker_passes_through():
    (prices, skipped), _ = run_prices(["SAP.DE"], {"SAP.DE": 120.0}, {"SAP.DE": "EUR"})
    assert prices["SAP.DE"] == fx.EurPrice(D("120.0"), "EUR", D("1"))
    assert skipped == {}


def test_a_dollar_ticker_is_converted_with_the_eurusd_rate():
    (prices, _), _ = run_prices(["AAPL"], {"AAPL": 100.0}, {"AAPL": "USD"}, {"EURUSD=X": 1.25})
    assert prices["AAPL"].price_eur == D("80")
    assert prices["AAPL"].currency == "USD" and prices["AAPL"].rate == D("0.8")


def test_pence_quotes_are_converted_through_pounds():
    (prices, _), _ = run_prices(["VOD.L"], {"VOD.L": 5000.0}, {"VOD.L": "GBp"}, {"EURGBP=X": 0.8})
    assert prices["VOD.L"].price_eur == D("62.5")  # 5000p = 50 GBP = 62.5 EUR


def test_one_rate_lookup_per_currency():
    (prices, _), quotes = run_prices(
        ["A", "B"], {"A": 10.0, "B": 20.0}, {"A": "USD", "B": "USD"}, {"EURUSD=X": 1.0}
    )
    assert len(prices) == 2
    assert [c.args[0] for c in quotes.await_args_list].count("EURUSD=X") == 1


@pytest.mark.parametrize("price", [None, float("nan"), float("inf"), 0.0, -3.0])
def test_a_bad_price_leaves_the_ticker_out_with_a_note(price):
    (prices, skipped), _ = run_prices(["AAPL"], {"AAPL": price}, {"AAPL": "EUR"})
    assert prices == {} and "AAPL" in skipped["AAPL"]


def test_a_failing_quote_leaves_the_ticker_out():
    (prices, skipped), _ = run_prices(["AAPL"], {}, {"AAPL": "EUR"})
    assert prices == {} and "AAPL" in skipped["AAPL"]


def test_a_missing_currency_leaves_the_ticker_out():
    (prices, skipped), _ = run_prices(["AAPL"], {"AAPL": 10.0}, {})
    assert prices == {} and "currency" in skipped["AAPL"]


def test_an_unsupported_currency_leaves_the_ticker_out():
    (prices, skipped), _ = run_prices(["AAPL"], {"AAPL": 10.0}, {"AAPL": "XYZ"})
    assert prices == {} and "XYZ" in skipped["AAPL"]


@pytest.mark.parametrize("rate", [None, float("nan"), 0.0, -1.0, RuntimeError("down")])
def test_a_bad_rate_leaves_the_ticker_out(rate):
    (prices, skipped), _ = run_prices(["AAPL"], {"AAPL": 10.0}, {"AAPL": "USD"}, {"EURUSD=X": rate})
    assert prices == {} and "AAPL" in skipped["AAPL"]


def test_no_amount_can_be_non_finite():
    (prices, _), _ = run_prices(["AAPL"], {"AAPL": 1e308}, {"AAPL": "USD"}, {"EURUSD=X": 1e-300})
    assert all(p.price_eur.is_finite() for p in prices.values())
