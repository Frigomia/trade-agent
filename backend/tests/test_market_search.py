import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from app.agents.market_data import SEARCH_CACHE_TTL, search_symbols


def _quote(symbol, name, quote_type, exchange="XETRA", *, long_name=None):
    return {
        "symbol": symbol,
        "shortname": name,
        "longname": long_name,
        "quoteType": quote_type,
        "exchDisp": exchange,
    }


def _search(quotes):
    """Patches yfinance's Search and Redis; returns the fake Redis."""
    fake_search = MagicMock()
    fake_search.quotes = quotes
    redis = AsyncMock()
    redis.get.return_value = None
    return fake_search, redis


def test_search_keeps_stocks_and_etfs_and_names_them():
    quotes = [
        _quote("VWCE.DE", "Vanguard FTSE All-World U.ETF R", "ETF"),
        _quote("AAPL", "Apple Inc.", "EQUITY", "NASDAQ", long_name="Apple Inc. (long)"),
        _quote("SAAPL=F", "Apple Stock Futures", "FUTURE", "CME"),
        _quote("BTC-USD", "Bitcoin USD", "CRYPTOCURRENCY", "CCC"),
        _quote("^GSPC", "S&P 500", "INDEX", "SNP"),
    ]
    fake_search, redis = _search(quotes)

    with (
        patch("app.agents.market_data.yf.Search", return_value=fake_search),
        patch("app.agents.market_data.get_redis", return_value=redis),
    ):
        result = asyncio.run(search_symbols("apple"))

    assert result == [
        {
            "symbol": "VWCE.DE",
            "name": "Vanguard FTSE All-World U.ETF R",
            "type": "ETF",
            "exchange": "XETRA",
        },
        {"symbol": "AAPL", "name": "Apple Inc. (long)", "type": "STOCK", "exchange": "NASDAQ"},
    ]


def test_search_returns_at_most_eight_matches():
    fake_search, redis = _search([_quote(f"T{i}.DE", f"Fund {i}", "ETF") for i in range(20)])

    with (
        patch("app.agents.market_data.yf.Search", return_value=fake_search),
        patch("app.agents.market_data.get_redis", return_value=redis),
    ):
        result = asyncio.run(search_symbols("fund"))

    assert len(result) == 8


def test_search_caches_the_answer_for_an_hour_per_query_ignoring_case_and_spaces():
    fake_search, redis = _search([_quote("VWCE.DE", "Vanguard", "ETF")])

    with (
        patch("app.agents.market_data.yf.Search", return_value=fake_search) as mock_search,
        patch("app.agents.market_data.get_redis", return_value=redis),
    ):
        asyncio.run(search_symbols("  VWCE "))

    mock_search.assert_called_once()
    assert mock_search.call_args.args[0] == "vwce"
    assert redis.get.call_args.args[0] == "search:vwce"
    assert redis.set.call_args.args[0] == "search:vwce"
    assert redis.set.call_args.kwargs["ex"] == SEARCH_CACHE_TTL == 3600


def test_search_uses_the_cache_without_calling_yahoo():
    redis = AsyncMock()
    redis.get.return_value = (
        '[{"symbol": "AAPL", "name": "Apple", "type": "STOCK", "exchange": "NASDAQ"}]'
    )

    with (
        patch("app.agents.market_data.yf.Search") as mock_search,
        patch("app.agents.market_data.get_redis", return_value=redis),
    ):
        result = asyncio.run(search_symbols("apple"))

    mock_search.assert_not_called()
    assert result[0]["symbol"] == "AAPL"


# --- the route -------------------------------------------------------------------------------

MATCH = {"symbol": "VWCE.DE", "name": "Vanguard FTSE All-World", "type": "ETF", "exchange": "XETRA"}


def test_search_route_returns_the_matches(client):
    with patch("app.routers.market.search_symbols", AsyncMock(return_value=[MATCH])) as search:
        response = client.get("/market/search", params={"q": "vwce"})

    assert response.status_code == 200
    assert response.json() == [MATCH]
    search.assert_awaited_once_with("vwce")


def test_search_route_needs_two_characters_and_at_most_sixty(client):
    assert client.get("/market/search", params={"q": "a"}).status_code == 422
    assert client.get("/market/search", params={"q": "a" * 61}).status_code == 422
    assert client.get("/market/search").status_code == 422


def test_search_route_answers_with_an_empty_list_when_yahoo_fails(client):
    with patch("app.routers.market.search_symbols", AsyncMock(side_effect=RuntimeError("boom"))):
        response = client.get("/market/search", params={"q": "vwce"})

    assert response.status_code == 200
    assert response.json() == []


def test_search_route_requires_authentication(anon_client):
    assert anon_client.get("/market/search", params={"q": "vwce"}).status_code == 401


def test_search_route_is_rate_limited(client):
    with patch("app.routers.market.search_symbols", AsyncMock(return_value=[])):
        for _ in range(30):
            assert client.get("/market/search", params={"q": "vwce"}).status_code == 200
        assert client.get("/market/search", params={"q": "vwce"}).status_code == 429
