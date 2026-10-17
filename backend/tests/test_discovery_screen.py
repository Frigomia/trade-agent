from dataclasses import replace
from decimal import Decimal

import pytest

from app.discovery.eligibility import MIN_CORE_METRICS, is_eligible
from app.discovery.scoring import dimension_score
from app.discovery.screen import shortlist_for_user
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
    }
    base = SymbolSnapshot(
        ticker=f"S{i:02d}",
        asset_type="STOCK",
        name=f"Stock {i}",
        exchange="NMS",
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
    assert result.excluded == []


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
