"""Invariants of the committed universe file. Offline: no network."""

from collections import Counter

from app.discovery.universe import load_universe, region_of
from app.discovery.validate_universe import REGION_TARGETS
from app.fx import SUPPORTED


def test_the_committed_universe_loads_and_has_no_duplicate_tickers() -> None:
    rows = load_universe()

    assert len(rows) == len({row.ticker for row in rows})


def test_every_region_is_close_to_its_target() -> None:
    rows = load_universe()
    counts = Counter(region_of(row.country, row.asset_type) for row in rows)

    # Targets, not quotas: allow a tenth either way (plan section 6, Phase 3).
    for region, target in REGION_TARGETS.items():
        assert abs(counts[region] - target) <= target * 0.1, (region, counts[region], target)
    assert counts["unknown"] == 0


def test_every_currency_in_the_file_can_be_converted_to_eur() -> None:
    unsupported = {row.currency for row in load_universe()} - SUPPORTED

    assert unsupported == set()


def test_the_universe_is_not_only_large_caps() -> None:
    stocks = [row for row in load_universe() if row.asset_type == "STOCK"]
    sizes = Counter(row.size_bucket for row in stocks)

    small_or_less = sizes["micro"] + sizes["small"]
    assert small_or_less / len(stocks) >= 0.15
    assert sizes["large"] / len(stocks) <= 0.55
