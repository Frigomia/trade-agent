import math

import pytest

from app.discovery.validate_universe import (
    CORE_FIELDS,
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
