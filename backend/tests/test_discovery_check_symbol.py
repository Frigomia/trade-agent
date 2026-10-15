from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import pytest

import app.discovery.validate_universe as module
from app.discovery.universe import UniverseRow
from app.discovery.validate_universe import (
    MIN_CORE_METRICS,
    MIN_HISTORY_DAYS,
    STALE_DAYS,
    RawSymbolData,
    build_report,
    check_symbol,
    eur_rate_from,
    fetch_all,
    market_cap_to_eur,
    meets_thresholds,
)

TODAY = date(2026, 10, 15)

SAP_ROW = UniverseRow(
    ticker="SAP.DE",
    name="SAP SE",
    asset_type="STOCK",
    exchange="XETRA",
    country="Germany",
    currency="EUR",
    sector="Technology",
    industry="Software - Application",
    size_bucket="large",
    notes="",
)
ETF_ROW = UniverseRow(
    ticker="VWCE.DE",
    name="Vanguard FTSE All-World UCITS ETF",
    asset_type="ETF",
    exchange="XETRA",
    country="Ireland",
    currency="EUR",
    sector="",
    industry="",
    size_bucket="unknown",
    notes="",
)
RATES = {"EUR": Decimal(1), "USD": Decimal("0.8")}

FULL_INFO: dict[str, Any] = {
    "longName": "SAP SE",
    "quoteType": "EQUITY",
    "country": "Germany",
    "currency": "EUR",
    "sector": "Technology",
    "marketCap": 229e9,
    "returnOnEquity": 0.18,
    "profitMargins": 0.2,
    "operatingMargins": 0.27,
    "revenueGrowth": 0.09,
    "freeCashflow": 9e9,
    "trailingPE": 28.0,
}


class YFRateLimitError(Exception):
    """Same class name yfinance uses: the script matches on the name, not the import."""


def raw(info: dict[str, Any], days: int = 250, last: date | None = TODAY) -> RawSymbolData:
    return RawSymbolData(info=info, history_days=days, last_close_date=last)


def check(row: UniverseRow, fetched: RawSymbolData | Exception, rates=RATES):
    return check_symbol(row, fetched, rates, TODAY)


def test_a_healthy_stock_passes_and_gets_a_size_label() -> None:
    result = check(SAP_ROW, raw(FULL_INFO))

    assert result.ok
    assert result.failure is None
    assert result.market_cap_eur == 229e9
    assert result.size_bucket == "large"
    assert result.mismatches == ()


def test_market_cap_is_converted_to_eur() -> None:
    info = {**FULL_INFO, "currency": "USD", "marketCap": 1_000_000_000}
    row = UniverseRow(**{**SAP_ROW.__dict__, "currency": "USD"})

    result = check(row, raw(info))

    assert result.market_cap_eur == 800_000_000
    assert result.size_bucket == "small"


def test_a_fetch_error_is_reported_as_unresolved() -> None:
    result = check(SAP_ROW, RuntimeError("no data"))

    assert not result.ok
    assert result.failure == "unresolved"
    assert result.detail == "RuntimeError"


def test_an_empty_record_is_unresolved() -> None:
    assert check(SAP_ROW, raw({})).failure == "unresolved"


def test_a_short_history_is_flagged() -> None:
    result = check(SAP_ROW, raw(FULL_INFO, days=MIN_HISTORY_DAYS - 1))

    assert result.failure == "history_too_short"


def test_the_last_close_may_be_exactly_the_stale_limit_old() -> None:
    result = check(SAP_ROW, raw(FULL_INFO, last=TODAY - timedelta(days=STALE_DAYS)))

    assert result.ok


def test_a_last_close_older_than_the_stale_limit_is_flagged() -> None:
    result = check(SAP_ROW, raw(FULL_INFO, last=TODAY - timedelta(days=STALE_DAYS + 1)))

    assert result.failure == "stale_price"


def test_a_missing_last_close_date_is_a_stale_price() -> None:
    assert check(SAP_ROW, raw(FULL_INFO, last=None)).failure == "stale_price"


def test_an_unsupported_currency_is_flagged() -> None:
    result = check(SAP_ROW, raw({**FULL_INFO, "currency": "XXX"}))

    assert result.failure == "currency_unsupported"


def test_a_stock_with_too_few_core_metrics_has_insufficient_data() -> None:
    sparse = {k: v for k, v in FULL_INFO.items() if k in ("longName", "quoteType", "currency")}
    sparse["marketCap"] = 1e9
    assert MIN_CORE_METRICS > 1

    assert check(SAP_ROW, raw(sparse)).failure == "insufficient_data"


def test_an_etf_is_not_held_to_the_fundamentals_threshold() -> None:
    info = {"longName": "Vanguard FTSE All-World UCITS ETF", "quoteType": "ETF", "currency": "EUR"}

    assert check(ETF_ROW, raw(info)).ok


def test_a_different_company_name_is_a_warning_not_a_failure() -> None:
    result = check(SAP_ROW, raw({**FULL_INFO, "longName": "Siemens AG"}))

    assert result.ok
    assert "name" in result.mismatches


def test_country_and_currency_drift_from_the_file_is_recorded() -> None:
    result = check(SAP_ROW, raw({**FULL_INFO, "country": "Japan", "currency": "USD"}))

    assert "country" in result.mismatches
    assert "currency" in result.mismatches


def test_a_domicile_in_the_same_region_is_not_a_country_mismatch() -> None:
    result = check(SAP_ROW, raw({**FULL_INFO, "country": "France"}))  # file: Germany, both Europe

    assert "country" not in result.mismatches


def test_an_offshore_domicile_is_not_a_country_mismatch() -> None:
    result = check(SAP_ROW, raw({**FULL_INFO, "country": "Jersey"}))

    assert "country" not in result.mismatches


def test_market_cap_of_a_pence_quoted_stock_uses_the_pound_not_the_penny() -> None:
    # Yahoo quotes the price in pence (GBp) but reports the market cap in pounds.
    info = {**FULL_INFO, "currency": "GBp", "marketCap": 193e9, "country": "United Kingdom"}
    row = UniverseRow(
        **{**SAP_ROW.__dict__, "ticker": "AZN.L", "country": "United Kingdom", "currency": "GBp"}
    )

    result = check(row, raw(info), {"GBp": Decimal("0.0115")})  # 1.15 EUR per pound

    assert result.market_cap_eur == pytest.approx(193e9 * 1.15)
    assert result.size_bucket == "large"


def test_market_cap_to_eur_handles_major_units_minor_units_and_unknown() -> None:
    rates = {"USD": Decimal("0.8"), "ZAc": Decimal("0.0005")}

    assert market_cap_to_eur(1000.0, "USD", rates) == 800.0
    assert market_cap_to_eur(1000.0, "ZAc", rates) == pytest.approx(1000.0 * 0.05)
    assert market_cap_to_eur(1000.0, "XXX", rates) is None
    assert market_cap_to_eur(None, "USD", rates) is None


def test_eur_rate_from_handles_eur_subunits_and_unknown() -> None:
    prices = {"EURZAR=X": 20.0, "EURUSD=X": 1.25}

    assert eur_rate_from("EUR", prices.get) == Decimal(1)
    assert eur_rate_from("USD", prices.get) == Decimal("0.8")
    assert eur_rate_from("ZAc", prices.get) == Decimal("0.0005")
    assert eur_rate_from("XXX", prices.get) is None


def test_report_shows_counts_by_region_and_lists_failures() -> None:
    good = check(SAP_ROW, raw(FULL_INFO))
    bad_row = UniverseRow(**{**SAP_ROW.__dict__, "ticker": "GONE.DE", "country": "Japan"})
    bad = check(bad_row, raw({}))

    report = build_report([good, bad], duplicates=[])

    assert "europe" in report
    assert "asia_pacific" in report
    assert "GONE.DE" in report
    assert "unresolved" in report


def test_report_region_table_shows_checked_and_passing_counts() -> None:
    good = check(SAP_ROW, raw(FULL_INFO))
    bad_row = UniverseRow(**{**SAP_ROW.__dict__, "ticker": "GONE.DE", "country": "Japan"})
    bad = check(bad_row, raw({}))

    report = build_report([good, bad], duplicates=[])

    assert "| asia_pacific | 150 | 1 | 0 |" in report
    assert "| europe | 180 | 1 | 1 |" in report


def test_thresholds_fail_when_too_many_symbols_do_not_resolve() -> None:
    good = check(SAP_ROW, raw(FULL_INFO))
    bad = check(SAP_ROW, raw({}))

    assert meets_thresholds([good] * 19 + [bad], min_ok_ratio=0.9)
    assert not meets_thresholds([good, bad], min_ok_ratio=0.9)


def test_a_rate_limit_error_is_not_reported_as_a_bad_symbol() -> None:
    result = check(SAP_ROW, YFRateLimitError("Too Many Requests"))

    assert result.failure == "rate_limited"
    assert result.detail == "YFRateLimitError"


def test_rate_limited_symbols_are_left_out_of_the_pass_ratio() -> None:
    good = check(SAP_ROW, raw(FULL_INFO))
    bad = check(SAP_ROW, raw({}))
    unchecked = check(SAP_ROW, YFRateLimitError())

    assert meets_thresholds([good, good, unchecked, unchecked, unchecked], min_ok_ratio=0.9)
    assert not meets_thresholds([good, bad, unchecked], min_ok_ratio=0.9)


def test_the_report_lists_unchecked_symbols_separately() -> None:
    report = build_report([check(SAP_ROW, YFRateLimitError())], duplicates=[])

    assert "Not checked" in report
    assert "SAP.DE" in report


def test_fetch_all_retries_rate_limited_symbols_after_a_cooldown() -> None:
    calls: dict[str, int] = {}
    sleeps: list[float] = []

    def flaky(ticker: str) -> RawSymbolData:
        calls[ticker] = calls.get(ticker, 0) + 1
        if ticker == "B" and calls[ticker] == 1:
            raise YFRateLimitError
        return raw({})

    results = fetch_all(["A", "B"], flaky, workers=1, passes=3, cooldown=30.0, sleep=sleeps.append)

    assert all(isinstance(r, RawSymbolData) for r in results.values())
    assert calls == {"A": 1, "B": 2}
    assert sleeps == [30.0]


def test_fetch_all_gives_up_after_the_last_pass() -> None:
    sleeps: list[float] = []

    def always_throttled(ticker: str) -> RawSymbolData:
        raise YFRateLimitError

    results = fetch_all(
        ["A"], always_throttled, workers=1, passes=2, cooldown=5.0, sleep=sleeps.append
    )

    assert isinstance(results["A"], Exception)
    assert sleeps == [5.0]


def test_fetch_yfinance_raises_the_last_error_after_three_attempts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts: list[str] = []

    def failing_ticker(symbol: str) -> None:
        attempts.append(symbol)
        raise ValueError(f"attempt {len(attempts)}")

    monkeypatch.setattr(module.yf, "Ticker", failing_ticker)
    monkeypatch.setattr(module.time, "sleep", lambda seconds: None)

    with pytest.raises(ValueError, match="attempt 3"):
        module.fetch_yfinance("SAP.DE")

    assert attempts == ["SAP.DE", "SAP.DE", "SAP.DE"]
