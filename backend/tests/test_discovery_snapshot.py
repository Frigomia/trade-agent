from datetime import date, timedelta

import pytest

from app.discovery.fetching import RawSymbolData
from app.discovery.snapshot import (
    METRIC_KEYS,
    Freshness,
    SymbolSnapshot,
    check_freshness,
    coverage_of,
    normalize_metrics,
    to_snapshot,
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


# ---- freshness: current bars, peers, and verified closures ----------------------------------


def weekdays(last: date, count: int = 10) -> list[str]:
    return sessions(last, count)


def exchange(last_dates: list[str], name: str = "GER") -> list[SymbolSnapshot]:
    return [
        snap(f"{name}{i}", weekdays(date.fromisoformat(d)), name) for i, d in enumerate(last_dates)
    ]


def days_ago(days: int) -> str:
    return (TODAY - timedelta(days=days)).isoformat()


def test_a_symbol_far_behind_current_peers_is_stale() -> None:
    group = exchange([TODAY.isoformat()] * 5 + [days_ago(9)])  # about 7 sessions back

    result = check_freshness(group, TODAY)

    assert list(result.stale) == ["GER5"]
    assert "GER" in result.stale["GER5"]
    assert result.uncertain == {}


def test_a_close_in_the_latest_three_weekdays_is_current_without_any_peer() -> None:
    group = exchange([TODAY.isoformat()] * 5 + [days_ago(2)])  # Wednesday: still within three

    assert check_freshness(group, TODAY) == Freshness({}, {})
    assert check_freshness(
        [snap("ALONE", weekdays(TODAY - timedelta(days=2)))], TODAY
    ) == Freshness({}, {})


def test_old_records_do_not_make_current_symbols_stale() -> None:
    # Three records end 30 days ago and two end today: the current two are demonstrably current.
    group = exchange([days_ago(30)] * 3 + [TODAY.isoformat()] * 2)

    result = check_freshness(group, TODAY)

    assert set(result.stale) == {"GER0", "GER1", "GER2"}
    assert "GER3" not in result.uncertain and "GER4" not in result.uncertain
    assert all("no bar since" not in reason for reason in result.stale.values())


def test_a_shared_old_age_is_uncertain_not_proof_of_freshness() -> None:
    # Six records all end a week ago: a holiday, a provider outage or an outdated cache all look
    # the same from the data alone. It must not be reported as fresh.
    result = check_freshness(exchange([days_ago(7)] * 6), TODAY)

    assert result.stale == {}
    assert set(result.uncertain) == {f"GER{i}" for i in range(6)}
    assert "cannot" in result.uncertain["GER0"]


def test_a_verified_closure_explains_the_gap() -> None:
    group = exchange([days_ago(7)] * 6)  # last bar Friday 9 October
    holiday = {date(2026, 10, 12), date(2026, 10, 13), date(2026, 10, 14)}

    assert check_freshness(group, TODAY, {"GER": holiday}) == Freshness({}, {})


def test_a_closure_verified_for_another_exchange_or_only_in_part_does_not_count() -> None:
    group = exchange([days_ago(7)] * 6)

    other = check_freshness(group, TODAY, {"JPX": {date(2026, 10, 12), date(2026, 10, 13)}})
    partial = check_freshness(group, TODAY, {"GER": {date(2026, 10, 12)}})

    assert len(other.uncertain) == len(partial.uncertain) == 6


def test_an_ordinary_trading_week_with_a_shared_outage_is_not_fresh() -> None:
    # Nothing is known to have closed the exchange, so a week of silence cannot be a holiday.
    result = check_freshness(exchange([days_ago(7)] * 6), TODAY, {"GER": set()})

    assert len(result.uncertain) == 6 and result.stale == {}


def test_an_exchange_with_nothing_for_over_two_weeks_is_stale_as_a_whole() -> None:
    result = check_freshness(exchange([days_ago(30)] * 6), TODAY)

    assert set(result.stale) == {f"GER{i}" for i in range(6)}
    assert result.uncertain == {}


def test_a_holiday_seen_in_its_peers_bars_is_not_a_missed_session() -> None:
    # The exchange was closed Wednesday and Thursday: peers have no bars on those days, so a symbol
    # whose last bar is Monday missed only two sessions (Tuesday and Friday).
    dates = [d for d in weekdays(TODAY) if d not in ("2026-10-14", "2026-10-15")]
    peers = [snap(f"P{i}", dates) for i in range(5)]
    monday = snap("MON", [d for d in dates if d <= "2026-10-12"])

    assert check_freshness([*peers, monday], TODAY) == Freshness({}, {})


def test_a_small_exchange_falls_back_to_calendar_days() -> None:
    fresh = [
        snap("A", weekdays(TODAY - timedelta(days=4)), "SES"),
        snap("B", weekdays(TODAY), "SES"),
    ]
    old = snap("C", weekdays(TODAY - timedelta(days=6)), "SES")

    result = check_freshness([*fresh, old], TODAY)

    assert list(result.stale) == ["C"]  # A is 4 calendar days old, C is 7
    assert "calendar" in result.stale["C"]


def test_a_small_exchange_also_accepts_a_verified_closure() -> None:
    old = snap("C", weekdays(date(2026, 10, 9)), "SES")
    closed = {date(2026, 10, 12), date(2026, 10, 13), date(2026, 10, 14)}

    assert check_freshness([old], TODAY, {"SES": closed}) == Freshness({}, {})


def test_records_without_bars_are_stale_and_do_not_count_toward_the_minimum() -> None:
    week_old = snap("LONE", weekdays(TODAY - timedelta(days=7)))
    empties = [snap(f"E{i}", []) for i in range(4)]

    alone = check_freshness([week_old], TODAY)
    padded = check_freshness([week_old, *empties], TODAY)

    assert list(alone.stale) == ["LONE"]
    assert set(padded.stale) == {"LONE", "E0", "E1", "E2", "E3"}  # still stale, not promoted
    assert padded.stale["E0"] == "no price history"
    assert padded.uncertain == {}


def test_exchanges_are_judged_separately() -> None:
    japan = exchange([days_ago(7)] * 6, "JPX")  # silent: cannot tell holiday from outage
    germany = exchange([TODAY.isoformat()] * 5 + [days_ago(9)], "GER")

    result = check_freshness([*japan, *germany], TODAY)

    assert list(result.stale) == ["GER5"]
    assert set(result.uncertain) == {f"JPX{i}" for i in range(6)}


# ---- sessions peers demonstrably traded, and exchanges with their own trading week ------------


def test_sessions_peers_traded_make_a_symbol_stale_even_when_the_peers_are_old_too() -> None:
    # Five peers end on 9 October and one symbol on 16 September. The shared gap since 9 October
    # may be a holiday or an outage, but the symbol missed ten sessions the peers did trade.
    peers = [snap(f"P{i}", weekdays(date(2026, 10, 9))) for i in range(5)]
    behind = snap("BEHIND", weekdays(date(2026, 9, 16)))

    result = check_freshness([*peers, behind], TODAY)

    assert list(result.stale) == ["BEHIND"]
    assert set(result.uncertain) == {f"P{i}" for i in range(5)}  # the shared gap stays uncertain


def test_a_verified_closure_cannot_erase_sessions_the_peers_traded() -> None:
    peers = [snap(f"P{i}", weekdays(TODAY)) for i in range(5)]
    behind = snap("BEHIND", weekdays(date(2026, 10, 7)))  # Wednesday: seven sessions back
    everything_closed = {date(2026, 10, d) for d in (8, 9, 12, 13, 14, 15, 16)}

    result = check_freshness([*peers, behind], TODAY, {"GER": everything_closed})

    assert list(result.stale) == ["BEHIND"]


SAUDI_TODAY = date(2026, 10, 20)  # a Tuesday; the Saudi Exchange trades Sunday to Thursday
SAUDI_DAYS = [
    "2026-10-11",  # Sunday
    "2026-10-12",
    "2026-10-13",
    "2026-10-14",
    "2026-10-15",  # Thursday
    "2026-10-18",  # Sunday
    "2026-10-19",
    "2026-10-20",
]


def saudi(count: int, dates: list[str]) -> list[SymbolSnapshot]:
    return [snap(f"S{i}", dates, "SAU") for i in range(count)]


def test_a_sunday_to_thursday_market_is_judged_on_its_own_sessions() -> None:
    peers = saudi(5, SAUDI_DAYS)
    lagging = snap("LAG", [d for d in SAUDI_DAYS if d <= "2026-10-15"], "SAU")

    without = check_freshness([*peers, lagging], SAUDI_TODAY)
    friday_closure = check_freshness([*peers, lagging], SAUDI_TODAY, {"SAU": {date(2026, 10, 16)}})

    # Sunday, Monday and Tuesday were traded by the peers: three missed sessions
    assert list(without.stale) == ["LAG"]
    assert list(friday_closure.stale) == ["LAG"]  # a verified Friday closure erases nothing


def test_a_closure_on_a_day_the_market_never_trades_explains_nothing() -> None:
    quiet = saudi(6, [d for d in SAUDI_DAYS if d <= "2026-10-15"])  # all end on Thursday

    friday = check_freshness(quiet, SAUDI_TODAY, {"SAU": {date(2026, 10, 16)}})
    sunday = check_freshness(quiet, SAUDI_TODAY, {"SAU": {date(2026, 10, 18)}})

    assert len(friday.uncertain) == 6  # Friday is not a trading day: nothing to explain
    assert sunday == Freshness({}, {})  # Sunday is: its verified closure explains the gap


def test_the_trading_week_can_be_supplied_for_any_exchange() -> None:
    quiet = [snap(f"G{i}", [d for d in SAUDI_DAYS if d <= "2026-10-15"], "GER") for i in range(6)]

    default_week = check_freshness(quiet, SAUDI_TODAY, {"GER": {date(2026, 10, 16)}})
    sunday_week = check_freshness(
        quiet,
        SAUDI_TODAY,
        {"GER": {date(2026, 10, 18)}},
        trading_weekdays={"GER": (6, 0, 1, 2, 3)},
    )

    assert default_week == Freshness({}, {})  # Monday to Friday: the Friday closure explains it
    assert sunday_week == Freshness({}, {})  # Sunday to Thursday: the Sunday closure does


# ---- from a fetched record to the stored one -------------------------------------------------


def fetched(info: dict[str, object], closes: list[float], dates: list[str]) -> RawSymbolData:
    last = date.fromisoformat(dates[-1]) if dates else None
    return RawSymbolData(info, len(closes), last, closes, dates)


def test_a_fetched_record_becomes_a_snapshot() -> None:
    info = {
        "longName": "SAP SE",
        "quoteType": "EQUITY",
        "exchange": "GER",
        "sector": "Technology",
        "industry": "Software - Application",
        "currency": "EUR",
        "marketCap": 2.3e11,
        "averageVolume": 2.5e6,
        "debtToEquity": 22.0,
    }

    s = to_snapshot("SAP.DE", fetched(info, [100.0, 101.0], ["2026-10-14", "2026-10-15"]))

    assert (s.ticker, s.asset_type, s.name, s.exchange) == ("SAP.DE", "STOCK", "SAP SE", "GER")
    assert (s.sector, s.industry, s.currency) == ("Technology", "Software - Application", "EUR")
    assert (s.price, s.market_cap, s.avg_volume) == (101.0, 2.3e11, 2.5e6)
    assert s.metrics["debtToEquity"] == pytest.approx(0.22)
    assert (s.closes, s.dates) == ([100.0, 101.0], ["2026-10-14", "2026-10-15"])


def test_an_etf_keeps_its_type() -> None:
    assert to_snapshot("VT", fetched({"quoteType": "ETF"}, [], [])).asset_type == "ETF"


def test_missing_fields_stay_missing_and_the_name_falls_back_to_the_ticker() -> None:
    s = to_snapshot("XYZ", fetched({}, [], []))

    assert (s.name, s.exchange, s.sector, s.currency) == ("XYZ", None, None, None)
    assert (s.price, s.market_cap, s.avg_volume, s.closes) == (None, None, None, [])


def test_a_classification_that_is_not_text_is_dropped() -> None:
    s = to_snapshot("X", fetched({"sector": 12, "exchange": "", "marketCap": float("nan")}, [], []))

    assert (s.sector, s.exchange, s.market_cap) == (None, None, None)
