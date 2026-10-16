from datetime import date, timedelta

import pytest

from app.discovery.snapshot import (
    METRIC_KEYS,
    SymbolSnapshot,
    coverage_of,
    find_stale,
    normalize_metrics,
)

TODAY = date(2026, 10, 16)  # a Friday


def sessions(last: date, count: int = 10) -> list[str]:
    """`count` weekday dates ending on `last` (an exchange with no holidays)."""
    days, day = [], last
    while len(days) < count:
        if day.weekday() < 5:
            days.append(day.isoformat())
        day -= timedelta(days=1)
    return days[::-1]


def snap(ticker: str, dates: list[str], exchange: str | None = "GER") -> SymbolSnapshot:
    return SymbolSnapshot(
        ticker=ticker,
        asset_type="STOCK",
        name=ticker,
        exchange=exchange,
        sector="Technology",
        industry="Software",
        currency="EUR",
        price=10.0 if dates else None,
        market_cap=1e9,
        avg_volume=1e5,
        metrics={},
        closes=[10.0] * len(dates),
        dates=dates,
    )


# ---- normalizing Yahoo's numbers -------------------------------------------------------------


def test_percent_like_fields_become_fractions() -> None:
    m = normalize_metrics({"dividendYield": 1.33, "debtToEquity": 45.0, "returnOnEquity": 0.18})

    assert m["dividendYield"] == pytest.approx(0.0133)
    assert m["debtToEquity"] == pytest.approx(0.45)
    assert m["returnOnEquity"] == 0.18  # already a fraction


def test_the_trailing_dividend_yield_is_never_used() -> None:
    # Wrong by 100x for pence, cent and agora quotes (normalization audit).
    assert normalize_metrics({"trailingAnnualDividendYield": 0.0004})["dividendYield"] is None


def test_free_cash_flow_margin_is_free_cash_flow_over_revenue() -> None:
    assert normalize_metrics({"freeCashflow": 50.0, "totalRevenue": 200.0})["fcfMargin"] == 0.25
    assert normalize_metrics({"freeCashflow": -50.0, "totalRevenue": 200.0})["fcfMargin"] == -0.25


@pytest.mark.parametrize("revenue", [0.0, -5.0, None, float("nan")])
def test_no_margin_without_positive_revenue(revenue: float | None) -> None:
    assert normalize_metrics({"freeCashflow": 50.0, "totalRevenue": revenue})["fcfMargin"] is None


def test_the_peg_ratio_falls_back_to_the_trailing_one() -> None:
    assert normalize_metrics({"trailingPegRatio": 1.2})["pegRatio"] == 1.2
    assert normalize_metrics({"pegRatio": 0.0, "trailingPegRatio": 1.2})["pegRatio"] == 0.0


def test_ebitda_is_passed_through_for_the_peer_validity_check() -> None:
    assert normalize_metrics({"ebitda": -10.0})["ebitda"] == -10.0


@pytest.mark.parametrize("bad", [None, float("nan"), float("inf"), True, "12", [1]])
def test_a_value_that_is_not_a_finite_number_is_missing_not_zero(bad: object) -> None:
    m = normalize_metrics({"trailingPE": bad, "debtToEquity": bad, "dividendYield": bad})

    assert (m["trailingPE"], m["debtToEquity"], m["dividendYield"]) == (None, None, None)


def test_every_metric_key_is_always_present() -> None:
    assert set(normalize_metrics({})) == set(METRIC_KEYS)


# ---- coverage --------------------------------------------------------------------------------


def test_coverage_counts_the_core_fields_with_a_value() -> None:
    metrics = normalize_metrics({"returnOnEquity": 0.1, "marketCap": 5e9, "trailingPE": 20.0})

    coverage = coverage_of(metrics)

    assert (coverage.core_metrics_present, coverage.core_metrics_total) == (3, 10)
    assert len(coverage.missing) == 7  # consistent with the Coverage contract
    assert "returnOnEquity" not in coverage.missing


def test_zero_is_a_present_value() -> None:
    assert coverage_of(normalize_metrics({"revenueGrowth": 0.0})).core_metrics_present == 1


# ---- the stored record -----------------------------------------------------------------------


def test_a_record_survives_a_json_round_trip() -> None:
    s = snap("SAP.DE", sessions(TODAY))

    assert SymbolSnapshot.from_json(s.to_json()) == s


# ---- freshness measured in the exchange's own sessions ---------------------------------------


def exchange(last_dates: list[str], name: str = "GER") -> list[SymbolSnapshot]:
    return [
        snap(f"{name}{i}", sessions(date.fromisoformat(d)), name) for i, d in enumerate(last_dates)
    ]


def test_a_symbol_far_behind_its_exchange_is_stale() -> None:
    latest = TODAY.isoformat()
    behind = (TODAY - timedelta(days=9)).isoformat()  # about 7 sessions back
    group = exchange([latest] * 5 + [behind])

    stale = find_stale(group, TODAY)

    assert list(stale) == ["GER5"]
    assert "GER" in stale["GER5"]


def test_a_missed_session_or_two_is_not_stale() -> None:
    two_back = sessions(TODAY)[-3]  # still within the latest three sessions
    group = exchange([TODAY.isoformat()] * 5 + [two_back])

    assert find_stale(group, TODAY) == {}


def test_a_holiday_shared_by_the_whole_exchange_is_not_stale() -> None:
    # Everyone's last bar is 7 calendar days old (a week-long holiday): a calendar rule of 5 days
    # would flag the whole exchange, a session-aware rule does not.
    holiday_end = (TODAY - timedelta(days=7)).isoformat()
    group = exchange([holiday_end] * 6)

    assert find_stale(group, TODAY) == {}


def test_an_exchange_with_no_recent_bars_at_all_is_stale() -> None:
    old = (TODAY - timedelta(days=30)).isoformat()

    assert set(find_stale(exchange([old] * 6), TODAY)) == {f"GER{i}" for i in range(6)}


def test_a_small_exchange_falls_back_to_calendar_days() -> None:
    fresh = [
        snap("A", sessions(TODAY - timedelta(days=4)), "SES"),
        snap("B", sessions(TODAY), "SES"),
    ]
    old = snap("C", sessions(TODAY - timedelta(days=6)), "SES")

    stale = find_stale([*fresh, old], TODAY)

    assert list(stale) == ["C"]  # A is 4 calendar days old, C is 7
    assert "calendar" in stale["C"]


def test_a_symbol_with_no_bars_is_stale_and_not_counted_as_a_session() -> None:
    group = [*exchange([TODAY.isoformat()] * 5), snap("EMPTY", [])]

    assert set(find_stale(group, TODAY)) == {"EMPTY"}


def test_exchanges_are_judged_separately() -> None:
    japan = exchange([(TODAY - timedelta(days=7)).isoformat()] * 6, "JPX")  # on holiday
    germany = exchange([TODAY.isoformat()] * 5 + [(TODAY - timedelta(days=9)).isoformat()], "GER")

    assert list(find_stale([*japan, *germany], TODAY)) == ["GER5"]
