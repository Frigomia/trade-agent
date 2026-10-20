import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.discovery import runner
from app.discovery.peers import PeerRecord
from app.discovery.screen import SHORTLIST_SIZE, build_candidate
from tests.auth_support import USER_ID
from tests.discovery_fixtures import sample_exposure, sample_idea
from tests.test_discovery_screen import snap


@pytest.fixture
def scan_inputs(monkeypatch):
    today = datetime.now(UTC).date().isoformat()
    snapshots = [snap(i, dates=[today]) for i in range(1, 13)]
    monkeypatch.setattr(runner, "load_universe", lambda: snapshots)
    monkeypatch.setattr(runner, "load_snapshot", AsyncMock(return_value=snapshots))
    monkeypatch.setattr(runner, "_user_inputs", lambda user_id: ([], []))
    monkeypatch.setattr(runner, "_rates", AsyncMock(return_value={"USD": Decimal("0.9")}))
    monkeypatch.setattr(runner, "_cached_mentions", AsyncMock(return_value=None))
    admission = AsyncMock(return_value=([], []))
    monkeypatch.setattr(runner, "admit_mentions", admission)
    active, peak = 0, 0

    async def graph(candidate, client, *, fit):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0)
        active -= 1
        assert client is user_client
        assert not fit.applicable
        return sample_idea().model_copy(update={"ticker": candidate.ticker})

    user_client = MagicMock()
    evaluation = AsyncMock(side_effect=graph)
    monkeypatch.setattr(runner, "run_discovery_graph", evaluation)
    return snapshots, user_client, evaluation, admission, lambda: peak


def test_scan_ranks_once_caps_provider_work_and_works_without_holdings(scan_inputs):
    snapshots, client, graph, admission, peak = scan_inputs
    progress = AsyncMock()
    result = asyncio.run(runner.evaluate_scan(USER_ID, client, progress))
    assert result.eligible == 12 and result.shortlisted == SHORTLIST_SIZE
    assert result.researched == SHORTLIST_SIZE and len(result.ideas) == SHORTLIST_SIZE
    assert graph.await_count == SHORTLIST_SIZE
    assert peak() <= runner.MAX_CONCURRENT_CANDIDATES
    assert [call.args[0].ticker for call in graph.await_args_list] == [
        f"S{i:02d}" for i in range(12, 4, -1)
    ]
    assert admission.await_args.args[1] == []
    assert admission.await_args.args[2] == snapshots
    assert result.coverage_summary["mentions_available"] is False
    assert progress.await_args.args == ("evaluating", SHORTLIST_SIZE, SHORTLIST_SIZE)


def test_admitted_mentions_compete_for_the_same_eight_places(scan_inputs):
    snapshots, client, graph, admission, _ = scan_inputs
    records = [
        PeerRecord(s.ticker, s.asset_type, s.sector, s.industry, s.metrics) for s in snapshots
    ]
    candidate, _ = build_candidate(snap(13), records[-1], records, {"USD": Decimal("0.9")})
    candidate = candidate.model_copy(update={"ticker": "DYNAMIC", "origin": "tavily"})
    admission.return_value = ([candidate], [])
    result = asyncio.run(runner.evaluate_scan(USER_ID, client, AsyncMock()))
    assert result.eligible == 13 and result.shortlisted == SHORTLIST_SIZE
    assert "DYNAMIC" in {call.args[0].ticker for call in graph.await_args_list}
    assert graph.await_count == SHORTLIST_SIZE


def test_empty_screen_has_no_provider_evaluations(scan_inputs, monkeypatch):
    _, client, graph, _, _ = scan_inputs
    monkeypatch.setattr(runner, "_user_inputs", lambda user_id: ([], ["Technology"]))
    result = asyncio.run(runner.evaluate_scan(USER_ID, client, AsyncMock()))
    assert result.ideas == [] and result.shortlisted == 0 and result.eligible == 0
    graph.assert_not_awaited()


def test_missing_snapshot_fails_before_fx_or_research(scan_inputs, monkeypatch):
    _, client, graph, admission, _ = scan_inputs
    monkeypatch.setattr(runner, "load_snapshot", AsyncMock(return_value=[]))
    with pytest.raises(runner.SnapshotUnavailable):
        asyncio.run(runner.evaluate_scan(USER_ID, client, AsyncMock()))
    runner._rates.assert_not_awaited()
    graph.assert_not_awaited()
    admission.assert_not_awaited()


def test_failed_candidates_are_disclosed_and_all_failed_is_not_a_quiet_day(scan_inputs):
    _, client, graph, _, _ = scan_inputs
    graph.side_effect = [RuntimeError("secret"), *[sample_idea() for _ in range(7)]]
    result = asyncio.run(runner.evaluate_scan(USER_ID, client, AsyncMock()))
    assert result.researched == 7
    assert result.coverage_summary["candidate_failures"] == ["S12"]
    graph.side_effect = RuntimeError("secret")
    with pytest.raises(runner.CandidateEvaluationUnavailable):
        asyncio.run(runner.evaluate_scan(USER_ID, client, AsyncMock()))


def test_candidate_fit_drops_future_history(scan_inputs, monkeypatch):
    _, client, graph, _, _ = scan_inputs
    exposure = sample_exposure()
    tomorrow = (datetime.now(UTC).date() + timedelta(days=1)).isoformat()
    monkeypatch.setattr(runner, "load_fit_context", AsyncMock(return_value=(exposure, {})))
    monkeypatch.setattr(runner, "fetch_dated_closes", AsyncMock(return_value={tomorrow: 100.0}))
    original = runner.marginal_effect
    fit = MagicMock(wraps=original)
    monkeypatch.setattr(runner, "marginal_effect", fit)

    async def graph_with_fit(candidate, user_client, *, fit):
        return sample_idea().model_copy(update={"ticker": candidate.ticker})

    graph.side_effect = graph_with_fit
    asyncio.run(runner.evaluate_scan(USER_ID, client, AsyncMock()))
    assert fit.call_count == SHORTLIST_SIZE
    assert all(call.args[1] == {} for call in fit.call_args_list)


@pytest.mark.parametrize("raw", [None, "null", "not-json"])
def test_manual_mentions_only_read_cache_and_do_not_resolve_owner_keys(monkeypatch, raw):
    redis = SimpleNamespace(get=AsyncMock(return_value=raw))
    monkeypatch.setattr(runner, "get_redis", lambda: redis)
    assert asyncio.run(runner._cached_mentions()) is None
    assert redis.get.await_args.args[0].startswith("discovery:mentions:v2:")


def test_empty_fit_context_needs_no_market_data(monkeypatch):
    from app import portfolio_analytics

    prices = AsyncMock(side_effect=AssertionError("No holdings to price"))
    monkeypatch.setattr(portfolio_analytics.fx, "eur_prices", prices)
    exposure, histories = asyncio.run(portfolio_analytics.load_fit_context([]))
    assert exposure.total_value_eur is None and histories == {}
    prices.assert_not_awaited()


def test_holding_fit_context_drops_future_bars(monkeypatch):
    from app import portfolio_analytics
    from app.analysis.portfolio import PositionInput
    from app.fx import EurPrice

    today = datetime.now(UTC).date()
    future = (today + timedelta(days=1)).isoformat()
    monkeypatch.setattr(
        portfolio_analytics.fx,
        "eur_prices",
        AsyncMock(
            return_value=(
                {"OWN": EurPrice(Decimal(100), "EUR", Decimal(1))},
                {},
            )
        ),
    )
    monkeypatch.setattr(
        portfolio_analytics.market_data, "fetch_profile", AsyncMock(return_value={})
    )
    monkeypatch.setattr(
        portfolio_analytics.market_data,
        "fetch_dated_closes",
        AsyncMock(
            return_value={today.isoformat(): 100.0, future: 999.0},
        ),
    )
    _, histories = asyncio.run(
        portfolio_analytics.load_fit_context(
            [
                PositionInput("OWN", "Owned", 1, "STOCK"),
            ]
        )
    )
    assert histories == {"OWN": {today.isoformat(): 100.0}}
