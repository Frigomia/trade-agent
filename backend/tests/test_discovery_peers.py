from typing import Any

import pytest

from app.discovery.peers import METRIC_SETS, MIN_PEERS, PeerRecord, compare_to_peers, metric_group


def rec(ticker: str, pe: float | None = 20.0, industry: str = "Software", **kw: Any) -> PeerRecord:
    sector = kw.pop("sector", "Technology")
    return PeerRecord(
        ticker, kw.pop("asset_type", "STOCK"), sector, industry, {"trailingPE": pe, **kw}
    )


def pes(values: list[float | None], **kw: Any) -> list[PeerRecord]:
    return [rec(f"P{i}", v, **kw) for i, v in enumerate(values)]


def pe(candidate: PeerRecord, universe: list[PeerRecord]):  # type: ignore[no-untyped-def]
    return next(c for c in compare_to_peers(candidate, universe) if c.metric == "trailingPE")


@pytest.mark.parametrize(
    ("sector", "industry", "asset_type", "group"),
    [
        ("Financial Services", "Banks - Regional", "STOCK", "bank"),
        ("Financial Services", "Insurance - Life", "STOCK", "insurer"),
        ("Financial Services", "Insurance Brokers", "STOCK", "financial_other"),
        ("Financial Services", "Asset Management", "STOCK", "financial_other"),
        ("Real Estate", "REIT - Industrial", "STOCK", "reit"),
        ("Real Estate", "Real Estate Services", "STOCK", "general"),
        ("Utilities", "Utilities - Regulated Electric", "STOCK", "utility"),
        ("Technology", "Software", "STOCK", "general"),
        (None, None, "STOCK", "general"),
        ("Financial Services", "Banks - Regional", "ETF", "etf"),
    ],
)
def test_metric_group(
    sector: str | None, industry: str | None, asset_type: str, group: str
) -> None:
    assert metric_group(sector, industry, asset_type) == group


def test_an_etf_has_no_comparison() -> None:
    assert compare_to_peers(rec("VT", asset_type="ETF"), pes([10.0] * 20)) == []


def test_industry_then_sector_then_none() -> None:
    industry = pes([10.0 + i for i in range(MIN_PEERS)])
    assert pe(rec("X", 15.0), industry).peer_group == "industry"

    small = pes([10.0, 11.0, 12.0])
    others = pes([13.0 + i for i in range(MIN_PEERS)], industry="Hardware")
    sector = pe(rec("X", 15.0), small + others)
    assert (sector.peer_group, sector.peer_count) == ("sector", 3 + MIN_PEERS)

    few = pe(rec("X", 15.0), small)
    assert (few.peer_group, few.position, few.peer_median, few.value) == (
        "none",
        "unavailable",
        None,
        15.0,
    )


def test_the_candidate_is_not_its_own_peer() -> None:
    me = rec("X", 15.0)

    assert pe(me, [me, *pes([10.0] * (MIN_PEERS - 1))]).peer_group == "none"


def test_peers_are_counted_per_metric_and_only_within_the_group() -> None:
    universe = pes([10.0 + i for i in range(MIN_PEERS)]) + pes([None] * 5, operatingMargins=0.2)
    by_metric = {
        c.metric: c for c in compare_to_peers(rec("X", 15.0, operatingMargins=0.3), universe)
    }
    assert by_metric["trailingPE"].peer_count == MIN_PEERS
    assert by_metric["operatingMargins"].peer_group == "none"

    banks = [
        rec(f"B{i}", 10.0 + i, "Banks - Regional", sector="Financial Services")
        for i in range(MIN_PEERS)
    ]
    managers = [
        rec(f"M{i}", 99.0, "Asset Management", sector="Financial Services")
        for i in range(MIN_PEERS)
    ]
    bank = pe(rec("X", 12.0, "Banks - Diversified", sector="Financial Services"), banks + managers)
    assert (bank.peer_group, bank.peer_count) == ("sector", MIN_PEERS)


def test_statistics_and_position() -> None:
    universe = pes([float(v) for v in range(1, 10)])  # 1..9: p25 3, median 5, p75 7

    c = pe(rec("X", 5.0), universe)
    assert (c.peer_p25, c.peer_median, c.peer_p75) == (3.0, 5.0, 7.0)
    assert [pe(rec("X", v), universe).position for v in (2.0, 3.0, 7.0, 8.0)] == [
        "below",
        "within",
        "within",
        "above",
    ]


def test_one_outlier_peer_does_not_move_the_median() -> None:
    clean = [float(v) for v in range(10, 18)]

    assert (
        pe(rec("X", 12.0), pes(clean)).peer_median
        == pe(rec("X", 12.0), pes(clean[:-1] + [1e9])).peer_median
    )


@pytest.mark.parametrize("bad", [None, float("nan"), float("inf"), 0.0, -5.0])
def test_a_missing_or_undefined_pe_is_unavailable_never_zero(bad: float | None) -> None:
    c = pe(rec("X", bad), pes([10.0 + i for i in range(MIN_PEERS)]))

    assert (c.value, c.position) == (None, "unavailable")


def test_a_loss_making_peer_is_left_out_of_the_pe_statistics() -> None:
    universe = [*pes([10.0 + i for i in range(MIN_PEERS - 1)]), rec("LOSS", -3.0)]

    assert pe(rec("X", 12.0), universe).peer_group == "none"


def test_a_negative_return_on_equity_is_a_real_value() -> None:
    universe = [rec(f"P{i}", returnOnEquity=0.05 * i) for i in range(MIN_PEERS)]
    roe = next(
        c
        for c in compare_to_peers(rec("X", returnOnEquity=-0.2), universe)
        if c.metric == "returnOnEquity"
    )

    assert (roe.value, roe.position) == (-0.2, "below")


def test_what_yahoo_cannot_provide_is_unavailable_and_nothing_is_swapped_in() -> None:
    reit = {
        c.metric: c
        for c in compare_to_peers(rec("R", sector="Real Estate", industry="REIT - Retail"), [])
    }
    utility = {
        c.metric: c
        for c in compare_to_peers(rec("U", sector="Utilities", industry="Utilities - Gas"), [])
    }

    assert (reit["priceToFfo"].value, reit["priceToFfo"].position) == (None, "unavailable")
    assert utility["interestCoverage"].position == "unavailable"
    assert {"trailingPE", "payoutRatio"}.isdisjoint(s.name for s in METRIC_SETS["reit"])
    assert {"debtToEquity", "enterpriseToEbitda"}.isdisjoint(s.name for s in METRIC_SETS["bank"])
