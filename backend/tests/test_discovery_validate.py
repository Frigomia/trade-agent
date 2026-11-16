import math
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.discovery.fetching import RawSymbolData
from app.discovery.universe import UniverseRow
from app.discovery.validate_universe import (
    CORE_FIELDS,
    build_report,
    check_symbol,
    core_coverage,
    find_duplicate_listings,
    names_match,
    size_bucket_for,
)


def test_core_coverage_counts_present_values_and_lists_the_missing_ones() -> None:
    info = {
        "returnOnEquity": 0.18,
        "profitMargins": None,
        "operatingMargins": math.nan,
        "revenueGrowth": 0.0,  # zero growth is a real value, not a gap
        "marketCap": 2.3e11,
    }

    coverage = core_coverage(info)

    assert coverage.total == len(CORE_FIELDS)
    assert coverage.present == 3
    assert "profitMargins" in coverage.missing
    assert "operatingMargins" in coverage.missing
    assert "revenueGrowth" not in coverage.missing


def test_core_coverage_of_an_empty_record_is_all_missing() -> None:
    coverage = core_coverage({})

    assert coverage.present == 0
    assert set(coverage.missing) == set(CORE_FIELDS)


@pytest.mark.parametrize(
    ("market_cap_eur", "bucket"),
    [
        (None, "unknown"),
        (50e6, "micro"),
        (299e6, "micro"),
        (300e6, "small"),
        (1.9e9, "small"),
        (2e9, "mid"),
        (9.9e9, "mid"),
        (10e9, "large"),
    ],
)
def test_size_bucket_labels_by_eur_market_cap(market_cap_eur: float | None, bucket: str) -> None:
    assert size_bucket_for(market_cap_eur) == bucket


@pytest.mark.parametrize(
    ("expected", "actual"),
    [
        ("SAP SE", "SAP SE"),
        ("Nestle S.A.", "Nestlé S.A."),
        ("ASML Holding N.V.", "ASML Holding NV"),
        ("Toyota Motor Corporation", "Toyota Motor Corp"),
        ("Taiwan Semiconductor Manufacturing", "Taiwan Semiconductor Manufacturing Co Ltd"),
    ],
)
def test_names_match_ignores_case_accents_and_company_suffixes(expected: str, actual: str) -> None:
    assert names_match(expected, actual)


@pytest.mark.parametrize(
    ("expected", "actual"),
    [
        ("Apple Inc.", "Microsoft Corporation"),
        ("SAP SE", "Siemens AG"),
        ("Toyota Motor Corporation", ""),
    ],
)
def test_names_match_rejects_different_companies(expected: str, actual: str) -> None:
    assert not names_match(expected, actual)


def test_find_duplicate_listings_groups_symbols_of_the_same_company() -> None:
    listings = [
        ("TM", "Toyota Motor Corporation"),
        ("7203.T", "Toyota Motor Corp"),
        ("SAP.DE", "SAP SE"),
        ("MSFT", "Microsoft Corporation"),
    ]

    assert find_duplicate_listings(listings) == [("7203.T", "TM")]


def test_find_duplicate_listings_is_empty_when_every_company_appears_once() -> None:
    assert find_duplicate_listings([("SAP.DE", "SAP SE"), ("MSFT", "Microsoft Corporation")]) == []


TODAY = date(2026, 11, 16)
RATES = {"EUR": Decimal(1)}


def _etf_row(**changes: object) -> UniverseRow:
    values: dict[str, object] = {
        "ticker": "SXR8.DE",
        "name": "iShares Core S&P 500 UCITS ETF USD (Acc)",
        "asset_type": "ETF",
        "exchange": "XETRA",
        "country": "",
        "currency": "EUR",
        "sector": "",
        "industry": "",
        "size_bucket": "unknown",
        "notes": "",
        "isin": "IE00B5BMR087",
        "ucits": True,
        "ter": None,
        "size_eur_m": None,
    }
    values.update(changes)
    return UniverseRow(**values)  # type: ignore[arg-type]


def _etf_data(**info_changes: object) -> RawSymbolData:
    info: dict[str, object] = {
        "longName": "iShares Core S&P 500 UCITS ETF USD (Acc)",
        "quoteType": "ETF",
        "currency": "EUR",
        "category": "Large Blend",
        "netExpenseRatio": 0.07,
        "totalAssets": 5.0e10,
        "fundInceptionDate": 1_300_000_000,
    }
    info.update(info_changes)
    return RawSymbolData(info=info, history_days=300, last_close_date=TODAY - timedelta(days=1))


def test_an_etf_row_passes_and_reports_the_fields_yahoo_returned() -> None:
    result = check_symbol(_etf_row(), _etf_data(totalAssets=None, category=""), RATES, TODAY)

    assert result.ok
    assert result.mismatches == ()
    assert result.etf_fields == ("netExpenseRatio", "fundInceptionDate")
    assert result.expense_ratio_raw == 0.07


def test_an_etf_row_that_resolves_to_a_stock_fails() -> None:
    result = check_symbol(_etf_row(), _etf_data(quoteType="EQUITY"), RATES, TODAY)

    assert result.failure == "not_an_etf"


def test_an_etf_row_flags_a_different_name_or_currency() -> None:
    data = _etf_data(longName="Xtrackers MSCI World UCITS ETF", currency="USD")

    result = check_symbol(_etf_row(), data, {**RATES, "USD": Decimal("0.9")}, TODAY)

    assert result.ok
    assert result.mismatches == ("name", "currency")


def test_a_stock_row_reports_no_etf_fields() -> None:
    row = _etf_row(asset_type="STOCK", name="SAP SE", sector="Technology", ter=None)
    data = RawSymbolData(
        info={
            "longName": "SAP SE",
            "quoteType": "EQUITY",
            "currency": "EUR",
            "sector": "Technology",
        },
        history_days=300,
        last_close_date=TODAY,
    )

    result = check_symbol(row, data, RATES, TODAY)

    assert result.etf_fields == ()
    assert result.expense_ratio_raw is None


def test_the_report_counts_etf_fields_and_shows_the_expense_ratio_values_seen() -> None:
    full = check_symbol(_etf_row(), _etf_data(), RATES, TODAY)
    sparse = check_symbol(
        _etf_row(ticker="EUNL.DE", ter=0.002),
        _etf_data(category=None, totalAssets=None, netExpenseRatio=0.2),
        RATES,
        TODAY,
    )

    report = build_report([full, sparse], [])

    assert "### ETF fields returned by Yahoo" in report
    assert "| category | 1 | 2 |" in report
    assert "| netExpenseRatio | 2 | 2 |" in report
    assert "| totalAssets | 1 | 2 |" in report
    # The evidence for percent versus fraction: Yahoo's raw value next to the file's own TER.
    assert "| SXR8.DE | 0.07 |  | EUR |" in report
    assert "| EUNL.DE | 0.2 | 0.002 | EUR |" in report


def test_a_report_without_etf_rows_has_no_etf_section() -> None:
    assert "ETF fields" not in build_report([], [])
