import math
import random
from dataclasses import replace
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.analysis.portfolio import MIN_RETURNS, ReturnSeries, log_returns
from app.discovery.etf import (
    ETF_MIN_SHARED_INTERVALS,
    EtfShortlist,
    build_etf_candidate,
    etf_exclusion,
    fund_size_eur,
    shortlist_etfs,
)
from app.discovery.snapshot import Freshness, SymbolSnapshot
from tests.discovery_fixtures import sample_exposure

RATES = {
    "USD": Decimal("0.9"),
    "GBp": Decimal("0.0115"),  # EUR per penny
    "ZAc": Decimal("0.0005"),
    "ILA": Decimal("0.0003"),
}
BASE = date(2025, 1, 1)
DAYS = 300


def day(n: int) -> str:
    return (BASE + timedelta(days=n)).isoformat()


def walk(seed: int, count: int = DAYS) -> list[float]:
    """A deterministic random walk of closes, different for each seed."""
    rng = random.Random(seed)
    closes = [100.0]
    for _ in range(count - 1):
        closes.append(closes[-1] * (1 + rng.gauss(0.0003, 0.01)))
    return closes


def returns_of(closes: list[float], start: int = 0) -> ReturnSeries:
    return log_returns({day(start + i): c for i, c in enumerate(closes)})


def fund(start: int = 0, **over: object) -> SymbolSnapshot:
    """A healthy UCITS fund: cheap, large, a year of history, dates from day `start`."""
    closes = walk(1)
    base = SymbolSnapshot(
        ticker="IWDA.AS",
        asset_type="ETF",
        name="iShares Core MSCI World UCITS ETF",
        exchange="AMS",
        country="Netherlands",
        sector=None,
        industry=None,
        currency="EUR",
        price=closes[-1],
        market_cap=None,
        avg_volume=1e6,
        metrics={"expenseRatio": 0.002, "totalAssets": None, "fundSizeEur": 5e9},
        closes=closes,
        dates=[day(start + i) for i in range(len(closes))],
        category="Global Large-Cap Blend Equity",
        isin="IE00B4L5Y983",
        ucits=True,
    )
    return replace(base, **over)


def with_metrics(snap: SymbolSnapshot, **metrics: float | None) -> SymbolSnapshot:
    return replace(snap, metrics={**snap.metrics, **metrics})


HOLDINGS = {"H1": returns_of(walk(10)), "H2": returns_of(walk(11))}


def check(snap: SymbolSnapshot, **over: object) -> str | None:
    """The exclusion reason for `snap`, or None when it passes."""
    kwargs: dict[str, object] = {
        "stale": None,
        "rates": RATES,
        "returns": returns_of(snap.closes, _start(snap)),
        "holding_returns": HOLDINGS,
        "held_etfs": [],
        "held_categories": {},
    }
    result = etf_exclusion(snap, **(kwargs | over))  # type: ignore[arg-type]
    assert result is None or result.explanation  # every exclusion explains itself
    return None if result is None else result.reason


def _start(snap: SymbolSnapshot) -> int:
    return (date.fromisoformat(snap.dates[0]) - BASE).days if snap.dates else 0


def test_a_healthy_fund_passes() -> None:
    assert check(fund()) is None


@pytest.mark.parametrize(
    "name",
    [
        "iShares Core MSCI World UCITS ETF",  # IWDA.AS
        "iShares NASDAQ 100 UCITS ETF",
        "iShares Core MSCI EM IMI UCITS ETF",
    ],
)
def test_the_three_named_funds_pass(name: str) -> None:
    assert check(fund(name=name)) is None


def test_a_fund_not_marked_ucits_is_out() -> None:
    assert check(fund(ucits=False)) == "not_ucits"


def test_an_unsupported_currency_is_out() -> None:
    assert check(fund(currency="XXX")) == "currency_unsupported"
    assert check(fund(currency=None)) == "currency_unsupported"


@pytest.mark.parametrize("price", [None, 0.0, -1.0, float("nan")])
def test_a_missing_or_invalid_price_is_out(price: float | None) -> None:
    assert check(fund(price=price)) == "unreliable_price"


def test_missing_or_invalid_history_is_out() -> None:
    assert check(fund(closes=[], dates=[])) == "unreliable_price"
    bad = walk(1)
    bad[100] = float("nan")
    assert check(fund(closes=bad)) == "unreliable_price"


def test_a_stale_price_is_out() -> None:
    assert check(fund(), stale="last close is old") == "unreliable_price"


def test_fewer_than_250_closes_is_out_and_250_passes() -> None:
    assert check(fund(closes=walk(1, 249), dates=[day(i) for i in range(249)])) == (
        "insufficient_data"
    )
    assert check(fund(closes=walk(1, 250), dates=[day(i) for i in range(250)])) is None


def test_fewer_than_60_matching_intervals_with_the_holdings_is_out() -> None:
    # The holdings cover days 0..299. A fund starting on day 240 shares 60 dates: 59 intervals.
    assert check(fund(start=240)) == "insufficient_data"
    # Starting on day 239 it shares 61 dates: exactly the 60 intervals it needs.
    assert check(fund(start=239)) is None


def test_the_interval_minimum_is_the_one_the_fit_step_uses() -> None:
    assert ETF_MIN_SHARED_INTERVALS == MIN_RETURNS


def test_a_fund_with_no_expense_ratio_is_out() -> None:
    assert check(with_metrics(fund(), expenseRatio=None)) == "insufficient_data"


@pytest.mark.parametrize(
    ("name", "category"),
    [
        ("Xtrackers S&P 500 2x Leveraged Daily Swap UCITS ETF", "Trading--Leveraged Equity"),
        ("WisdomTree NASDAQ 100 3x Daily Short", None),
        ("Some Fund", "Equity Inverse"),
        ("Xtrackers ShortDAX x2 Daily Swap UCITS ETF", None),
        ("Leverage Shares 3x Tesla ETP", None),
        ("Leverage Shares Tesla ETP", None),
        ("WisdomTree S&P 500 Daily Short UCITS ETF", None),
        ("Lyxor Bund Daily -1x Inverse UCITS ETF", None),
        ("Some Fund", "Trading--Leveraged Equity"),
        ("Some Fund", "TRADING--Inverse Equity"),
    ],
)
def test_a_leveraged_or_inverse_fund_is_out(name: str, category: str | None) -> None:
    assert check(fund(name=name, category=category)) == "fails_quality_filter"


@pytest.mark.parametrize(
    ("name", "category"),
    [
        ("iShares $ Short Duration Corp Bond UCITS ETF", "USD Corporate Bond"),
        ("Some Bond Fund", "EUR Corporate Bond - Short Term"),
        ("Some Bond Fund", "Short Government"),
        ("Some Bond Fund", "Ultrashort Bond"),
        ("Xtrackers EUR Overnight Rate Swap Ultrashort UCITS ETF", "Ultrashort Bond"),
        ("Short-Duration Bond UCITS ETF", "Short-Term Bond"),
    ],
)
def test_a_short_duration_bond_fund_is_not_mistaken_for_an_inverse_one(
    name: str, category: str
) -> None:
    assert check(fund(name=name, category=category)) is None


def overlap_case(category: str | None, held_category: str | None) -> str | None:
    snap = fund(category=category)
    copy = returns_of(snap.closes)  # a held fund that moves exactly like the candidate
    return check(
        snap,
        holding_returns={**HOLDINGS, "VWCE.DE": copy},
        held_etfs=["VWCE.DE"],
        held_categories={"VWCE.DE": held_category},
    )


def test_a_near_copy_in_the_same_category_overlaps_a_held_etf() -> None:
    assert overlap_case("World", "World") == "overlaps_holding"
    assert overlap_case("World", "world") == "overlaps_holding"


def test_a_near_copy_in_another_category_does_not_overlap() -> None:
    assert overlap_case("World", "Europe") is None


def test_an_unknown_category_leaves_the_correlation_to_decide() -> None:
    assert overlap_case("World", None) == "overlaps_holding"
    assert overlap_case(None, "World") == "overlaps_holding"


def test_a_low_correlation_in_the_same_category_does_not_overlap() -> None:
    snap = fund(category="World")
    other = returns_of(walk(77))
    assert (
        check(
            snap,
            holding_returns={**HOLDINGS, "VWCE.DE": other},
            held_etfs=["VWCE.DE"],
            held_categories={"VWCE.DE": "World"},
        )
        is None
    )


def test_a_held_etf_without_returns_is_skipped() -> None:
    assert check(fund(), held_etfs=["NOSERIES"], held_categories={"NOSERIES": "World"}) is None


def test_an_expense_ratio_of_exactly_half_a_percent_passes() -> None:
    assert check(with_metrics(fund(), expenseRatio=0.005)) is None
    assert check(with_metrics(fund(), expenseRatio=0.0051)) == "fails_quality_filter"


def sized(currency: str, total_assets: float | None) -> SymbolSnapshot:
    return with_metrics(fund(currency=currency), fundSizeEur=None, totalAssets=total_assets)


def test_a_usd_fund_is_converted_to_eur_before_the_size_test() -> None:
    assert check(sized("USD", 112e6)) is None  # 100.8M EUR
    assert check(sized("USD", 110e6)) == "fails_quality_filter"  # 99.0M EUR


def test_a_pence_quoted_fund_is_converted_to_eur_before_the_size_test() -> None:
    # Total assets in pounds, the major unit, as Yahoo gives a market cap: 1 GBP = 1.15 EUR.
    assert check(sized("GBp", 87e6)) is None  # 100.05M EUR
    assert check(sized("GBp", 86.9e6)) == "fails_quality_filter"  # 99.935M EUR


def test_minor_unit_rates_are_scaled_for_pence_cents_and_agorot() -> None:
    assert fund_size_eur(sized("GBp", 1e8), RATES) == pytest.approx(1.15e8)
    assert fund_size_eur(sized("ZAc", 1e9), RATES) == pytest.approx(5e7)
    assert fund_size_eur(sized("ILA", 1e9), RATES) == pytest.approx(3e7)


def test_the_universe_file_size_beats_yahoos() -> None:
    big_override = with_metrics(fund(currency="USD"), fundSizeEur=5e9, totalAssets=1e6)
    assert check(big_override) is None
    small_override = with_metrics(fund(currency="USD"), fundSizeEur=5e7, totalAssets=1e10)
    assert check(small_override) == "fails_quality_filter"
    assert fund_size_eur(big_override, RATES) == 5e9


def test_an_unknown_size_does_not_fail_the_fund() -> None:
    assert fund_size_eur(sized("EUR", None), RATES) is None
    assert check(sized("EUR", None)) is None
    assert check(sized("GBp", 1.0), rates={}) is None  # a size that cannot be converted is unknown


# ---- shortlist ------------------------------------------------------------------------------


def noise(seed: int, scale: float = 0.01) -> list[float]:
    rng = random.Random(seed)
    return [rng.gauss(0, scale) for _ in range(DAYS - 1)]


MARKET = [r + 0.0003 for r in noise(100)]


def closes_from(rets: list[float], scale: float = 1.0) -> list[float]:
    """Closes whose log returns are `rets`; `scale` changes the price level, not the returns."""
    closes = [100.0 * scale]
    for r in rets:
        closes.append(closes[-1] * math.exp(r))
    return closes


def dated(closes: list[float]) -> dict[str, float]:
    return {day(i): c for i, c in enumerate(closes)}


# Two holdings that follow the market, as sample_exposure() describes (SAP.DE and AAPL).
HIST = {
    "SAP.DE": dated(closes_from([m + n for m, n in zip(MARKET, noise(101, 0.005), strict=True)])),
    "AAPL": dated(closes_from([m + n for m, n in zip(MARKET, noise(102, 0.005), strict=True)])),
}


def etf(
    ticker: str,
    rets: list[float],
    *,
    ter: float = 0.002,
    size: float = 5e9,
    category: str | None = "Global Equity",
    scale: float = 1.0,
) -> SymbolSnapshot:
    closes = closes_from(rets, scale)
    return with_metrics(
        fund(
            ticker=ticker,
            name=f"{ticker} UCITS ETF",
            category=category,
            closes=closes,
            price=closes[-1],
            dates=[day(i) for i in range(len(closes))],
        ),
        expenseRatio=ter,
        fundSizeEur=size,
    )


def run(snaps: list[SymbolSnapshot], **over: object) -> EtfShortlist:
    kwargs: dict[str, object] = {
        "holdings": ["SAP.DE", "AAPL"],
        "held_etfs": [],
        "exposure": sample_exposure(),
        "histories": HIST,
        "today": date(2026, 1, 1),
    }
    return shortlist_etfs(snaps, Freshness({}, {}), RATES, **(kwargs | over))  # type: ignore[arg-type]


def tickers(result: EtfShortlist) -> list[str]:
    return [c.ticker for c in result.candidates]


def reasons(result: EtfShortlist) -> dict[str, str]:
    return {e.ticker: e.reason for e in result.excluded}


def test_near_copies_leave_only_the_cheapest() -> None:
    # VT, VWCE and IWDA-like: the same returns at different price levels and costs.
    result = run(
        [
            etf("VT", MARKET, ter=0.0020, scale=1.1),
            etf("VWCE", MARKET, ter=0.0022, scale=2.0),
            etf("IWDA", MARKET, ter=0.0007, scale=3.0),
        ]
    )

    assert tickers(result) == ["IWDA"]
    assert reasons(result) == {"VT": "fails_quality_filter", "VWCE": "fails_quality_filter"}
    assert all("IWDA" in e.explanation for e in result.excluded)


def test_equal_cost_near_copies_keep_the_largest() -> None:
    result = run([etf("SMALL", MARKET, size=2e8), etf("BIG", MARKET, size=9e9, scale=2.0)])

    assert tickers(result) == ["BIG"]
    assert reasons(result) == {"SMALL": "fails_quality_filter"}


def test_a_near_copy_in_another_known_category_is_kept_apart() -> None:
    result = run([etf("A", MARKET, category="World"), etf("B", MARKET, category="Europe")])

    assert sorted(tickers(result)) == ["A", "B"]


def test_an_unknown_category_leaves_the_correlation_to_decide_between_candidates() -> None:
    result = run([etf("A", MARKET, ter=0.001, category="World"), etf("B", MARKET, category=None)])

    assert tickers(result) == ["A"]
    assert reasons(result) == {"B": "fails_quality_filter"}


def test_a_low_correlation_fund_outranks_a_high_correlation_one() -> None:
    result = run([etf("EQ", MARKET, category="Equity"), etf("BOND", noise(200), category="Bond")])

    assert tickers(result) == ["BOND", "EQ"]
    assert result.eligible == 2
    assert result.skipped_reason is None


def test_ties_are_broken_by_ticker() -> None:
    same = noise(201)
    result = run([etf("B", same, category="X"), etf("A", same, category="Y")])

    assert tickers(result) == ["A", "B"]


def test_at_most_one_fund_per_category_and_the_cut_to_size() -> None:
    snaps = [
        etf("BOND1", noise(200), category="Bond"),
        etf("BOND2", noise(201), category="Bond"),  # same category, not a near-copy
        etf("GOLD", noise(202), category="Gold"),
        etf("EM", noise(203), category="Emerging"),
        etf("REIT", noise(204), category="Property"),
    ]

    result = run(snaps)

    assert len(result.candidates) == 3  # ETF_SLOTS
    assert result.eligible == 4  # one Bond fund went; the cut to 3 comes after the count
    assert len({c.industry for c in result.candidates}) == 3
    assert not {"BOND1", "BOND2"} <= set(tickers(result))
    assert reasons(result) == {}  # a set-aside duplicate category is not an exclusion
    assert len(run(snaps, size=2).candidates) == 2


def test_a_held_etf_is_not_recommended_and_leaves_no_exclusion() -> None:
    held = etf("HELD", MARKET, category="World")

    result = run(
        [held, etf("BOND", noise(200), category="Bond")], holdings=["SAP.DE", "AAPL", "HELD"]
    )

    assert tickers(result) == ["BOND"]
    assert result.excluded == []


def test_a_copy_of_a_held_etf_overlaps_it() -> None:
    held = etf("HELD", MARKET, category="World")
    result = run(
        [held, etf("COPY", MARKET, category="World", scale=2.0), etf("BOND", noise(200))],
        holdings=["SAP.DE", "AAPL", "HELD"],
        held_etfs=["HELD"],
        histories={**HIST, "HELD": dated(held.closes)},
    )

    assert tickers(result) == ["BOND"]
    assert reasons(result) == {"COPY": "overlaps_holding"}


def test_fewer_than_two_positions_skips_the_lane() -> None:
    exposure = sample_exposure()
    one = exposure.model_copy(update={"positions": exposure.positions[:1]})

    result = run([etf("BOND", noise(200))], exposure=one)

    assert result.candidates == [] and result.excluded == [] and result.eligible == 0
    assert result.skipped_reason == "ETF ideas need at least two holdings with price history"


def test_a_fund_whose_fit_cannot_be_measured_is_insufficient_data() -> None:
    flat = etf("FLAT", [0.0] * (DAYS - 1))  # no movement: correlation is undefined

    result = run([flat, etf("BOND", noise(200), category="Bond")])

    assert tickers(result) == ["BOND"]
    assert reasons(result) == {"FLAT": "insufficient_data"}


def test_stocks_are_not_this_lanes_business() -> None:
    stock = replace(etf("STK", MARKET), asset_type="STOCK")

    result = run([stock, replace(etf("US", noise(200)), ucits=False)])

    assert result.candidates == []
    assert reasons(result) == {"US": "not_ucits"}


def test_an_etf_candidate_carries_the_fund_facts_and_a_real_risk_level() -> None:
    snap = etf("BOND", noise(200), category="Bond")

    candidate = build_etf_candidate(snap, RATES, "last close is one day old")

    assert candidate.asset_type == "ETF"
    assert candidate.sector is None and candidate.industry == "Bond" and candidate.peers == []
    assert candidate.fundamentals == snap.metrics
    assert candidate.coverage.core_metrics_present == candidate.coverage.core_metrics_total
    assert candidate.risk.size_bucket == "unknown"  # a fund's size is not a company's
    assert candidate.risk.risk_level != "unknown"
    assert candidate.risk.volatility_annualized is not None
    assert candidate.data_notes == ["price date uncertain: last close is one day old"]
