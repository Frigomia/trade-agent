from decimal import Decimal
from statistics import quantiles
from typing import Any

import pytest

from app.discovery.peers import (
    METRIC_SETS,
    MIN_PEERS,
    PeerRecord,
    compare_to_peers,
    metric_group,
    named_peers,
)


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


def metric(universe: list[PeerRecord], candidate: PeerRecord, name: str):  # type: ignore[no-untyped-def]
    return next(c for c in compare_to_peers(candidate, universe) if c.metric == name)


def test_zero_debt_is_a_valid_leverage_value() -> None:
    # P0 is debt free: it is the eighth peer, so dropping it would make the comparison unavailable
    universe = [rec(f"P{i}", debtToEquity=0.1 * i) for i in range(MIN_PEERS)]

    debt_free = metric(universe, rec("X", debtToEquity=0.0), "debtToEquity")
    assert (debt_free.value, debt_free.peer_group, debt_free.peer_count) == (0.0, "industry", 8)
    assert (debt_free.position) == "below"

    assert (
        metric(universe, rec("X", debtToEquity=-0.5), "debtToEquity").value is None
    )  # negative equity


@pytest.mark.parametrize(
    ("ratio", "ebitda", "valid"),
    [
        (
            -2.0,
            50.0,
            True,
        ),  # EV -100 / EBITDA 50: more cash than the company is worth, a real value
        (10.0, -10.0, False),  # EV -100 / EBITDA -10: a positive ratio from a loss-making business
        (8.0, 100.0, True),
        (8.0, 0.0, False),
        (8.0, None, False),  # EBITDA unknown: validity cannot be established
    ],
)
def test_enterprise_to_ebitda_is_valid_only_when_ebitda_is_positive(
    ratio: float, ebitda: float | None, valid: bool
) -> None:
    universe = [rec(f"P{i}", enterpriseToEbitda=5.0 + i, ebitda=100.0) for i in range(MIN_PEERS)]
    me = rec("X", enterpriseToEbitda=ratio, ebitda=ebitda)

    assert (metric(universe, me, "enterpriseToEbitda").value is not None) is valid


def test_a_peer_with_negative_ebitda_is_left_out_of_the_ev_statistics() -> None:
    universe = [
        rec(f"P{i}", enterpriseToEbitda=5.0 + i, ebitda=100.0) for i in range(MIN_PEERS - 1)
    ]
    universe.append(rec("LOSS", enterpriseToEbitda=10.0, ebitda=-10.0))

    assert (
        metric(
            universe, rec("X", enterpriseToEbitda=6.0, ebitda=100.0), "enterpriseToEbitda"
        ).peer_group
        == "none"
    )


@pytest.mark.parametrize(
    ("peg", "pe", "valid"), [(1.5, 12.0, True), (1.5, -10.0, False), (-1.0, 12.0, False)]
)
def test_peg_needs_positive_earnings_not_just_a_positive_ratio(
    peg: float, pe: float, valid: bool
) -> None:
    # negative earnings with negative growth gives a positive PEG that means nothing
    universe = [rec(f"P{i}", pegRatio=1.0 + i / 10) for i in range(MIN_PEERS)]

    assert (metric(universe, rec("X", pe, pegRatio=peg), "pegRatio").value is not None) is valid


def test_one_extreme_value_cannot_push_a_statistic_outside_the_observed_range() -> None:
    # Bounded influence, not immunity: replacing a value can still move a quartile by a rank.
    base = [float(v) for v in range(1, 9)]
    for position in range(len(base)):
        for extreme in (1e9, -1e9):
            values = [extreme if i == position else v for i, v in enumerate(base)]
            universe = [rec(f"P{i}", returnOnEquity=v) for i, v in enumerate(values)]
            c = metric(universe, rec("X", returnOnEquity=4.0), "returnOnEquity")
            assert min(values) <= c.peer_p25 <= c.peer_median <= c.peer_p75 <= max(values)  # type: ignore[operator]
            assert c.peer_p75 <= max(base)  # type: ignore[operator]  # a mean would be about 1e8


@pytest.mark.parametrize("size", range(MIN_PEERS, 41))
def test_winsorizing_at_five_percent_would_not_change_the_median_or_quartiles(size: int) -> None:
    values = [float((index * 7919) % 101 + 1) for index in range(size)]
    low, high = (
        quantiles(values, n=20, method="inclusive")[0],
        quantiles(values, n=20, method="inclusive")[18],
    )
    clipped = [min(max(v, low), high) for v in values]

    assert quantiles(clipped, n=4, method="inclusive") == quantiles(values, n=4, method="inclusive")


# ---- named peers ----------------------------------------------------------------------------


def named(
    ticker: str, cap: float | None, currency: str = "USD", industry: str = "Software", **kw: Any
) -> PeerRecord:
    return PeerRecord(
        ticker,
        "STOCK",
        kw.pop("sector", "Technology"),
        industry,
        {"trailingPE": kw.pop("pe", 20.0), "returnOnEquity": kw.pop("roe", 0.1)},
        name=f"{ticker} Corp",
        country=kw.pop("country", "United States"),
        currency=currency,
        market_cap=cap,
    )


RATES = {"USD": Decimal("1.0"), "GBp": Decimal("0.0085"), "GBP": Decimal("0.85")}


def table(candidate: PeerRecord, universe: list[PeerRecord]):  # type: ignore[no-untyped-def]
    return named_peers(candidate, universe, compare_to_peers(candidate, universe), RATES)


def test_named_peers_are_the_five_largest_by_market_cap_without_the_candidate():
    candidate = named("ME", 5e9)
    universe = [candidate, *(named(f"P{i}", (i + 1) * 1e9) for i in range(9))]

    rows = table(candidate, universe)

    assert [r.ticker for r in rows] == ["P8", "P7", "P6", "P5", "P4"]
    assert rows[0].name == "P8 Corp"
    assert rows[0].country == "United States"
    assert rows[0].market_cap_eur == 9e9


def test_named_peers_use_the_metric_names_of_the_comparison_and_blank_invalid_values():
    candidate = named("ME", 5e9)
    universe = [candidate, *(named(f"P{i}", 1e9 + i, pe=20.0 + i) for i in range(8))]
    universe.append(named("LOSS", 9e9, pe=-4.0))  # a multiple of a loss is not a P/E

    top = table(candidate, universe)[0]

    assert top.ticker == "LOSS"
    assert top.values["trailingPE"] is None
    assert top.values["returnOnEquity"] == 0.1
    assert set(top.values) == {m.name for m in METRIC_SETS["general"]}


def test_a_minor_unit_peer_reports_its_major_currency_and_a_euro_market_cap():
    candidate = named("ME", 5e9)
    universe = [candidate, *(named(f"P{i}", 1e9) for i in range(8)), named("UK", 1e10, "GBp")]

    top = table(candidate, universe)[0]

    # The market cap is in pounds already; the pence rate is scaled back up (0.0085 / 0.01).
    assert (top.ticker, top.currency) == ("UK", "GBP")
    assert round(top.market_cap_eur or 0) == 8_500_000_000


def test_unknown_caps_come_last_and_ties_break_by_ticker():
    candidate = named("ME", 5e9)
    universe = [candidate, *(named(f"P{i}", None) for i in range(8)), named("BIG", 1e9)]

    rows = table(candidate, universe)

    assert [r.ticker for r in rows] == ["BIG", "P0", "P1", "P2", "P3"]
    assert rows[1].market_cap_eur is None


def test_named_peers_follow_the_group_the_comparison_used():
    candidate = named("ME", 5e9)
    # Too few in the industry, enough in the sector: the comparison fell back to the sector.
    industry_peers = [named(f"I{i}", 1e9 * (i + 1)) for i in range(3)]
    sector_peers = [named(f"S{i}", 1e9, industry="Hardware") for i in range(8)]

    rows = table(candidate, [candidate, *industry_peers, *sector_peers])

    assert {r.ticker for r in rows} <= {p.ticker for p in [*industry_peers, *sector_peers]}
    assert any(r.ticker.startswith("S") for r in rows)  # the sector pool, not only the industry


def test_nothing_is_named_when_the_comparison_had_no_peer_group():
    candidate = named("ME", 5e9)
    universe = [candidate, *(named(f"P{i}", 1e9) for i in range(MIN_PEERS - 2))]

    assert table(candidate, universe) == []


def test_peers_of_another_metric_group_are_not_named():
    candidate = named("ME", 5e9)
    bank = PeerRecord("BANK", "STOCK", "Technology", "Banks - Regional", {}, name="Bank")
    universe = [candidate, bank, *(named(f"P{i}", 1e9) for i in range(8))]

    assert "BANK" not in [r.ticker for r in table(candidate, universe)]


def test_peers_that_gave_the_comparison_no_figure_are_not_named():
    candidate = named("ME", 5e9)
    empty = PeerRecord(
        "EMPTY", "STOCK", "Technology", "Software", {}, name="Empty", market_cap=9e12
    )
    universe = [candidate, empty, *(named(f"P{i}", 1e9) for i in range(8))]

    assert "EMPTY" not in [r.ticker for r in table(candidate, universe)]
