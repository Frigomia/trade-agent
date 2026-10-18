from dataclasses import replace
from decimal import Decimal

import pytest

from app.discovery.eligibility import MIN_CORE_METRICS, is_eligible
from app.discovery.peers import PeerRecord
from app.discovery.scoring import dimension_score
from app.discovery.screen import PEER_DATA_NOTE, build_candidate, shortlist_for_user
from app.discovery.snapshot import METRIC_KEYS, Freshness, SymbolSnapshot
from app.schemas_discovery import PeerComparison

RATES = {"USD": Decimal("0.9")}
NONE = Freshness(stale={}, uncertain={})


def snap(i: int, **over: object) -> SymbolSnapshot:
    """Stock number i of 12 in one industry: a higher i is better on every metric."""
    metrics = dict.fromkeys(METRIC_KEYS)
    metrics |= {
        "returnOnEquity": 0.02 * i,
        "operatingMargins": 0.01 * i,
        "trailingPE": 40.0 - i,
        "priceToBook": 10.0 - 0.5 * i,
        "priceToSalesTrailing12Months": 20.0 - i,
    }
    base = SymbolSnapshot(
        ticker=f"S{i:02d}",
        asset_type="STOCK",
        name=f"Stock {i}",
        exchange="NMS",
        country="United States",
        sector="Technology",
        industry="Software",
        currency="USD",
        price=10.0,
        market_cap=5e9,
        avg_volume=1e6,
        metrics=metrics,
        closes=[10.0] * 130,
        dates=["2026-10-15"] * 130,  # only the last one is read here
    )
    return replace(base, **over)


def peers_of(*cells: tuple[str, float, str]) -> list[PeerComparison]:
    return [
        PeerComparison(
            metric=metric,
            value=value,
            peer_group="industry",
            peer_count=12,
            peer_median=0.5,
            peer_p25=0.0,
            peer_p75=1.0,
            position=position,  # type: ignore[arg-type]
        )
        for metric, value, position in cells
    ]


# ---- scoring ----------------------------------------------------------------------------------


def test_values_far_above_the_peer_range_score_100_when_higher_is_better() -> None:
    comparisons = peers_of(("returnOnEquity", 2.0, "above"), ("operatingMargins", 3.0, "above"))

    assert dimension_score(comparisons, "general", "quality") == 100


def test_values_far_above_the_peer_range_score_0_when_lower_is_better() -> None:
    comparisons = peers_of(
        ("trailingPE", 2.0, "above"), ("priceToSalesTrailing12Months", 5.0, "above")
    )

    assert dimension_score(comparisons, "general", "valuation") == 0


def test_one_scored_metric_is_not_enough_for_a_dimension_score() -> None:
    unavailable = ("operatingMargins", 0.0, "unavailable")
    comparisons = peers_of(("returnOnEquity", 0.9, "within"), unavailable)

    assert dimension_score(comparisons, "general", "quality") is None


def test_a_metric_that_is_shown_but_never_scored_does_not_count() -> None:
    comparisons = peers_of(("payoutRatio", 0.9, "within"), ("returnOnEquity", 0.9, "within"))

    assert dimension_score(comparisons, "utility", "quality") is None


# ---- eligibility ------------------------------------------------------------------------------


def test_a_complete_record_is_eligible() -> None:
    ok, why = is_eligible(snap(5))

    assert (ok, why) == (True, None)


@pytest.mark.parametrize(
    ("over", "reason"),
    [
        ({"name": ""}, "ambiguous_identity"),
        ({"exchange": None}, "ambiguous_identity"),
        ({"asset_type": "BOND"}, "ambiguous_identity"),
        ({"currency": "XXX"}, "currency_unsupported"),
        ({"currency": None}, "currency_unsupported"),
        ({"price": None}, "unreliable_price"),
        ({"price": 0.0}, "unreliable_price"),
        ({"price": float("nan")}, "unreliable_price"),
        ({"closes": [], "dates": []}, "unreliable_price"),
        ({"closes": [10.0, float("nan")]}, "unreliable_price"),
        ({"closes": [10.0, 0.0]}, "unreliable_price"),
    ],
)
def test_each_safeguard_excludes_with_its_reason(over: dict[str, object], reason: str) -> None:
    ok, why = is_eligible(snap(5, **over))

    assert not ok
    assert why is not None
    assert (why.reason, why.ticker) == (reason, "S05")
    assert why.explanation


def test_a_stale_price_is_unreliable() -> None:
    ok, why = is_eligible(snap(5), stale="no bar since 2026-09-01")

    assert not ok
    assert why is not None
    assert why.reason == "unreliable_price"
    assert "2026-09-01" in why.explanation


def test_fewer_than_the_minimum_core_metrics_is_insufficient_data() -> None:
    thin = dict.fromkeys(METRIC_KEYS) | {"returnOnEquity": 0.1, "trailingPE": 12.0}

    ok, why = is_eligible(snap(5, metrics=thin))

    assert MIN_CORE_METRICS == 3
    assert not ok
    assert why is not None
    assert why.reason == "insufficient_data"


def test_the_profile_changes_nothing_yet() -> None:
    assert is_eligible(snap(5), profile="conservative") == is_eligible(snap(5))


# ---- shortlist --------------------------------------------------------------------------------


def screen(snaps: list[SymbolSnapshot], freshness: Freshness = NONE, **kw):  # type: ignore[no-untyped-def]
    return shortlist_for_user(snaps, freshness, RATES, **kw)


def test_the_best_fundamentals_rank_first() -> None:
    result = screen([snap(i) for i in range(12)], size=3)

    assert [c.ticker for c in result.candidates] == ["S11", "S10", "S09"]
    assert result.excluded == []


def test_held_tickers_and_avoided_sectors_are_dropped() -> None:
    snaps = [snap(i) for i in range(12)] + [snap(20, ticker="OIL", sector="Energy")]

    result = screen(snaps, holdings={"S11"}, avoid_sectors={"Energy"}, size=20)

    tickers = [c.ticker for c in result.candidates]
    assert "S11" not in tickers
    assert "OIL" not in tickers
    assert result.excluded == []  # a choice by the user, not a safeguard


def test_an_ineligible_symbol_is_excluded_with_its_reason_and_still_a_peer() -> None:
    snaps = [snap(i) for i in range(12)]
    snaps[11] = replace(snaps[11], currency="XXX")

    result = screen(snaps, size=20)

    assert [(e.ticker, e.reason) for e in result.excluded] == [("S11", "currency_unsupported")]
    assert "S11" not in [c.ticker for c in result.candidates]
    assert result.candidates[0].peers[0].peer_count == 11  # the other eleven still compare


def test_a_stale_symbol_is_excluded_and_an_uncertain_one_stays() -> None:
    freshness = Freshness(stale={"S11": "old"}, uncertain={"S10": "holiday or outage"})

    result = screen([snap(i) for i in range(12)], freshness, size=2)

    assert [e.ticker for e in result.excluded] == ["S11"]
    assert result.candidates[0].ticker == "S10"


def test_a_candidate_with_no_peer_comparison_is_not_ranked_not_scored_as_zero() -> None:
    lonely = snap(30, ticker="ODD", sector="Energy", industry="Oil")

    result = screen([snap(i) for i in range(12)] + [lonely], size=20)

    assert "ODD" not in [c.ticker for c in result.candidates]
    assert [(e.ticker, e.reason) for e in result.excluded] == [("ODD", "insufficient_data")]
    assert "peer" in result.excluded[0].explanation


def test_equal_scores_break_by_lower_risk_then_ticker() -> None:
    snaps = [snap(i) for i in range(12)]
    snaps[0] = replace(snaps[0], ticker="A", market_cap=1e7)  # micro: a small_cap flag
    snaps.append(replace(snaps[0], ticker="B", market_cap=5e9))  # same fundamentals, no flag
    snaps.append(replace(snaps[0], ticker="C", market_cap=5e9))

    result = screen(snaps, size=20)

    order = [c.ticker for c in result.candidates if c.ticker in "ABC"]
    assert order == ["B", "C", "A"]


def test_the_candidate_carries_its_risk_peers_coverage_and_origin() -> None:
    top = screen([snap(i) for i in range(12)], size=1).candidates[0]

    assert (top.ticker, top.origin, top.origin_note) == ("S11", "universe", None)
    assert top.risk.risk_level in ("low", "medium", "high", "unknown")
    assert {p.metric for p in top.peers} >= {"returnOnEquity", "trailingPE"}
    assert top.coverage.core_metrics_present >= 3
    assert top.fundamentals["returnOnEquity"] == pytest.approx(0.22)


def test_an_empty_universe_is_an_empty_shortlist() -> None:
    result = screen([])

    assert (result.candidates, result.excluded) == ([], [])


def test_holdings_and_avoided_sectors_match_regardless_of_case() -> None:
    result = screen(
        [snap(i) for i in range(12)], holdings={"s11"}, avoid_sectors={"TECHNOLOGY"}, size=20
    )

    assert result.candidates == []


@pytest.mark.parametrize("size", [0, -1])
def test_a_size_below_one_returns_nothing(size: int) -> None:
    assert screen([snap(i) for i in range(12)], size=size).candidates == []


def test_the_price_date_is_an_explicit_utc_day() -> None:
    top = screen([snap(i) for i in range(12)], size=1).candidates[0]

    assert top.price_as_of is not None
    assert (top.price_as_of.isoformat()) == "2026-10-15T00:00:00+00:00"


def test_an_uncertain_price_date_is_disclosed_with_its_reason() -> None:
    freshness = Freshness(stale={}, uncertain={"S10": "holiday or outage"})

    candidates = {c.ticker: c for c in screen([snap(i) for i in range(12)], freshness).candidates}

    assert candidates["S10"].data_notes == [
        "price date uncertain: holiday or outage",
        PEER_DATA_NOTE,
    ]
    assert candidates["S11"].data_notes == [PEER_DATA_NOTE]


def test_a_dimension_that_could_not_be_scored_is_named() -> None:
    metrics = dict.fromkeys(METRIC_KEYS) | {
        "returnOnEquity": 0.3,
        "operatingMargins": 0.2,
        "revenueGrowth": 0.1,
    }
    snaps = [snap(i) for i in range(12)] + [snap(20, ticker="HALF", metrics=metrics)]

    half = next(c for c in screen(snaps, size=20).candidates if c.ticker == "HALF")

    assert half.data_notes == [PEER_DATA_NOTE, "valuation not scored: no valid peer comparison"]


def entrant(snaps: list[SymbolSnapshot], **over: object):  # type: ignore[no-untyped-def]
    outside = snap(15, ticker="OUTSIDE", **over)
    record = PeerRecord(
        outside.ticker, outside.asset_type, outside.sector, outside.industry, outside.metrics
    )
    records = [PeerRecord(s.ticker, s.asset_type, s.sector, s.industry, s.metrics) for s in snaps]
    return build_candidate(outside, record, records, RATES, origin="reddit", origin_note="found")


def test_admitted_candidates_compete_for_the_same_shortlist_places_without_changing_peers() -> None:
    snaps = [snap(i) for i in range(12)]
    outside, _ = entrant(snaps)
    before = screen(snaps, size=20)

    result = screen(snaps, mentions_admitted=[outside], size=3)

    assert [c.ticker for c in result.candidates] == ["OUTSIDE", "S11", "S10"]
    assert result.candidates[0] == outside
    assert result.candidates[1].peers == before.candidates[0].peers
    assert outside.peers[0].peer_count == 12
    assert outside.data_notes == [PEER_DATA_NOTE]


@pytest.mark.parametrize(
    "preference", [{"holdings": {"outside"}}, {"avoid_sectors": {"technology"}}]
)
def test_user_preferences_apply_to_admitted_candidates(preference):  # type: ignore[no-untyped-def]
    snaps = [snap(i) for i in range(12)]
    outside, _ = entrant(snaps)

    result = screen(snaps, mentions_admitted=[outside], size=20, **preference)

    assert "OUTSIDE" not in [c.ticker for c in result.candidates]
    assert result.excluded == []


def test_admitted_duplicates_do_not_replace_universe_candidates_or_fill_multiple_places() -> None:
    snaps = [snap(i) for i in range(12)]
    outside, _ = entrant(snaps)
    duplicate = outside.model_copy(update={"ticker": "S11"})

    result = screen(snaps, mentions_admitted=[duplicate, outside, outside], size=20)

    tickers = [c.ticker for c in result.candidates]
    assert len(tickers) == len(set(tickers)) == 13
    assert next(c for c in result.candidates if c.ticker == "S11").origin == "universe"


def test_admission_origin_does_not_change_rank_or_hide_unscorable_candidates() -> None:
    snaps = [snap(i) for i in range(12)]
    outside, _ = entrant(snaps)
    unscorable = outside.model_copy(update={"ticker": "NOPEERS", "peers": []})
    tavily = outside.model_copy(update={"origin": "tavily"})

    reddit_result = screen(snaps, mentions_admitted=[outside, unscorable], size=20)
    tavily_result = screen(snaps, mentions_admitted=[tavily], size=20)

    assert [c.ticker for c in reddit_result.candidates] == [
        c.ticker for c in tavily_result.candidates
    ]
    assert [(e.ticker, e.reason) for e in reddit_result.excluded] == [
        ("NOPEERS", "insufficient_data")
    ]


def test_an_etf_is_excluded_with_an_explicit_reason_even_with_full_data() -> None:
    etf = snap(30, ticker="VT", asset_type="ETF")

    ok, why = is_eligible(etf)

    assert not ok
    assert why is not None
    assert (why.reason, why.ticker) == ("insufficient_data", "VT")
    assert "ETF" in why.explanation
    assert "separate criteria" in why.explanation


def test_an_etf_never_reaches_the_shortlist_and_is_listed_as_excluded() -> None:
    result = screen(
        [snap(i) for i in range(12)] + [snap(30, ticker="VT", asset_type="ETF")], size=20
    )

    assert "VT" not in [c.ticker for c in result.candidates]
    assert [e.ticker for e in result.excluded] == ["VT"]


def test_the_listing_country_is_carried_into_the_candidate() -> None:
    top = screen([snap(i) for i in range(12)], size=1).candidates[0]

    assert top.country == "United States"


def test_an_etf_is_reported_as_an_etf_whatever_else_is_wrong() -> None:
    ok, why = is_eligible(snap(30, ticker="VT", asset_type="ETF", currency="XXX"))

    assert not ok
    assert why is not None
    assert "ETF" in why.explanation
