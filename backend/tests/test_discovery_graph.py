"""The candidate graph preserves code decisions, budgets and fetched-source boundaries."""

import asyncio
from datetime import UTC, date, datetime
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from anthropic import AuthenticationError

from app.agents import discovery_graph, research
from app.analysis.discovery_score import evaluate
from app.config import settings
from app.schemas_discovery import CandidateFit, Claim, Exclusion, IdeaOut, NegativeDevelopment
from tests.discovery_fixtures import sample_candidate

URL = "https://www.sec.gov/Archives/company-report"


def evidence(*, negative=False, forum=False, status="confirmed", url=URL):
    result = discovery_graph._empty_evidence(sample_candidate())
    result.claims = [
        Claim(
            text="The regulator revoked the company's sole operating licence."
            if negative
            else "Revenue increased by 5% in the reported fiscal year.",
            kind="forum" if forum else "fact",
            stance="bear" if negative else "bull",
            materiality="high",
            source_tier="forum" if forum else "official",
            event_id="licence" if negative else "revenue",
            url=url,
            published_at=date(2026, 10, 10),
        )
    ]
    if negative:
        result.negative_developments = [
            NegativeDevelopment(
                summary="Operating licence revoked.",
                occurred_on=date(2026, 10, 10),
                evidence=[url],
                thesis_impact="The company cannot operate its sole business.",
                status=status,
                invalidates_thesis=True,
            )
        ]
    return result


def prose(url=URL):
    return {
        "thesis": "Revenue growth supports further research.",
        "catalysts": [f"Reported revenue growth ({url})."],
        "outlook": "The future remains uncertain.",
        "bear_case": "Margins and competitive pressures require further investigation.",
        "fit_summary": None,
        "community_note": None,
        "conclusion": "Further human review is needed.",
    }


@pytest.fixture
def providers(monkeypatch):
    initial = evidence()
    research_mock = AsyncMock(return_value=initial)
    follow_up = AsyncMock(side_effect=lambda candidate, current, client, query, **kwargs: current)
    extraction = AsyncMock(return_value=prose())
    monkeypatch.setattr(research, "research_candidate", research_mock)
    monkeypatch.setattr(research, "follow_up_candidate", follow_up)
    monkeypatch.setattr(research, "_extract", extraction)
    return research_mock, follow_up, extraction


def run(client=None, **kwargs):
    candidate = sample_candidate()
    candidate.price_as_of = datetime.now(UTC)
    return asyncio.run(discovery_graph.run_discovery_graph(candidate, client, **kwargs))


def reassessment(development):
    claim = development.claims[-1]
    return {
        "invalidates_thesis": True,
        "explanation": f'Confirmed development: "{claim.text}" ({claim.url}); the thesis fails.',
        "evidence": [claim.url],
    }


def test_no_client_means_quant_only_without_server_key_or_paid_work(monkeypatch, providers):
    initial, follow_up, extraction = providers
    server = MagicMock(side_effect=AssertionError("Server key must never be resolved"))
    monkeypatch.setattr(research, "_get_client", server)
    result = run()
    assert isinstance(result, IdeaOut)
    assert result.ticker == sample_candidate().ticker
    assert result.fit_summary is None and result.catalysts == []
    assert {score.name for score in result.scores} == {"quality", "valuation", "fit"}
    assert any("Research unavailable" in note for note in result.data_notes)
    initial.assert_not_awaited()
    follow_up.assert_not_awaited()
    extraction.assert_not_awaited()
    server.assert_not_called()


def test_missing_tavily_does_not_spend_claude_or_resolve_server_key(monkeypatch):
    monkeypatch.setattr(settings, "tavily_api_key", None)
    server = MagicMock(side_effect=AssertionError("Server key must never be resolved"))
    monkeypatch.setattr(research, "_get_client", server)
    client = MagicMock()
    result = run(client)
    assert isinstance(result, IdeaOut)
    assert any("ResearchUnavailable" in note for note in result.data_notes)
    client.with_options.assert_not_called()
    server.assert_not_called()


@pytest.mark.parametrize(
    ("currency", "price", "display_currency", "display_price"),
    [
        ("CHF", 95, "CHF", 95),
        ("GBP", 50, "GBP", 50),
        ("GBp", 5000, "GBP", 50),
        ("GBX", 5000, "GBP", 50),
        ("ZAc", 1234, "ZAR", 12.34),
        ("ILA", 1234, "ILS", 12.34),
        (None, None, None, None),
    ],
)
def test_saved_snapshot_preserves_metadata_and_normalizes_only_quote_units(
    currency, price, display_currency, display_price
):
    candidate = sample_candidate()
    candidate.currency, candidate.price = currency, price
    result = asyncio.run(discovery_graph.run_discovery_graph(candidate, None))
    assert isinstance(result, IdeaOut)
    snapshot = result.snapshot
    assert snapshot is not None
    assert (snapshot.currency, snapshot.price) == (display_currency, display_price)
    assert snapshot.price_as_of == candidate.price_as_of
    assert snapshot.exchange == candidate.exchange
    assert snapshot.country == candidate.country
    assert snapshot.sector == candidate.sector
    assert snapshot.industry == candidate.industry
    assert snapshot.fundamentals == candidate.fundamentals
    assert snapshot.coverage == candidate.coverage
    assert (candidate.currency, candidate.price) == (currency, price)


def test_headline_is_a_bounded_excerpt_of_validated_thesis(providers):
    _, _, extraction = providers
    thesis = "Revenue growth supports further research. " * 20
    extraction.return_value = {**prose(), "thesis": thesis}
    result = run(MagicMock())
    assert isinstance(result, IdeaOut)
    assert result.thesis == thesis
    assert result.headline is not None and len(result.headline) <= 180
    assert result.headline.endswith("...")
    assert thesis.startswith(result.headline.removesuffix("..."))
    assert extraction.await_count == 1


def test_quant_and_research_run_in_parallel_and_join_before_normalization(monkeypatch, providers):
    original_quant = discovery_graph.quant
    original_extract = discovery_graph.extract_evidence

    async def scenario():
        quant_started, research_started = asyncio.Event(), asyncio.Event()
        completed = set()

        async def quant(state):
            quant_started.set()
            await asyncio.wait_for(research_started.wait(), timeout=2)
            completed.add("quant")
            return original_quant(state)

        async def research_node(state):
            research_started.set()
            await asyncio.wait_for(quant_started.wait(), timeout=2)
            completed.add("research")
            return {"evidence": evidence()}

        def extract(state):
            assert completed == {"quant", "research"}
            assert state["quant_evaluation"] is not None
            return original_extract(state)

        monkeypatch.setattr(discovery_graph, "quant", quant)
        monkeypatch.setattr(discovery_graph, "research_node", research_node)
        monkeypatch.setattr(discovery_graph, "extract_evidence", extract)
        return await discovery_graph.run_discovery_graph(sample_candidate(), MagicMock())

    assert isinstance(asyncio.run(scenario()), IdeaOut)


def test_synthesis_preserves_numeric_identity_and_untrusted_data_boundary(providers):
    initial, follow_up, extraction = providers
    candidate = sample_candidate()
    candidate.price_as_of = datetime.now(UTC)
    base = candidate.peers[0]
    candidate.peers.extend(
        base.model_copy(update={"metric": name, "value": value, "peer_p25": p25, "peer_p75": p75})
        for name, value, p25, p75 in [
            ("returnOnEquity", 0.26, 0.1, 0.3),
            ("operatingMargins", 0.12, 0.05, 0.15),
            ("priceToSalesTrailing12Months", 2.0, 1.0, 3.0),
        ]
    )
    result = asyncio.run(discovery_graph.run_discovery_graph(candidate, MagicMock()))
    expected = evaluate(candidate, initial.return_value)
    assert isinstance(result, IdeaOut)
    assert result.scores == expected.scores
    assert result.overall == expected.overall and result.overall is not None
    assert result.risk == sample_candidate().risk
    assert result.peers == candidate.peers
    assert result.origin == sample_candidate().origin
    assert result.catalysts == prose()["catalysts"]
    assert "Not a licensed advisor" in result.conclusion
    extraction.assert_awaited_once()
    args = extraction.await_args.args
    assert "untrusted DATA" in args[1]
    assert args[2]["numeric_scores"] == [score.model_dump(mode="json") for score in result.scores]
    assert args[2]["untrusted_data"]["candidate"]["ticker"] == result.ticker
    follow_up.assert_not_awaited()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("scores", []),
        ("overall", 100),
        ("ticker", "ATTACK"),
        ("origin", "reddit"),
        ("confidence", "high"),
    ],
)
def test_synthesis_cannot_override_code_output(providers, field, value):
    _, _, extraction = providers
    extraction.return_value = {**prose(), field: value}
    result = run(MagicMock())
    assert isinstance(result, IdeaOut)
    assert result.ticker == sample_candidate().ticker
    assert result.overall != 100
    assert result.origin == "universe"
    assert result.catalysts == []
    assert any("Synthesis unavailable" in note for note in result.data_notes)


@pytest.mark.parametrize(
    "field",
    ["thesis", "catalysts", "outlook", "bear_case", "fit_summary", "community_note", "conclusion"],
)
def test_invented_citation_in_any_prose_field_rejects_synthesis(providers, field):
    _, _, extraction = providers
    data = prose()
    invented = "Claim: https://invented.example/not-fetched"
    data[field] = [invented] if field == "catalysts" else invented
    extraction.return_value = data
    result = run(MagicMock())
    assert isinstance(result, IdeaOut)
    assert result.catalysts == []
    assert "Quantitative screening only" in result.thesis
    assert "invented.example" not in result.model_dump_json()
    assert any("Synthesis unavailable" in note for note in result.data_notes)


def test_catalyst_requires_a_claim_citation(providers):
    _, _, extraction = providers
    extraction.return_value = {**prose(), "catalysts": ["A product might launch."]}
    result = run(MagicMock())
    assert isinstance(result, IdeaOut)
    assert result.catalysts == []
    assert any("Synthesis unavailable" in note for note in result.data_notes)


def test_financial_comparisons_and_numeric_markers_preserve_valid_synthesis(providers):
    _, _, extraction = providers
    thesis = "EBITDA margin >20% and P/E <15 support further research [1]."
    catalyst = f"Coverage > 5x was reported [1]; source: {URL}."
    extraction.return_value = {**prose(), "thesis": thesis, "catalysts": [catalyst]}
    result = run(MagicMock())
    assert isinstance(result, IdeaOut)
    assert result.thesis == thesis
    assert result.catalysts == [catalyst]
    assert not any("Synthesis unavailable" in note for note in result.data_notes)


@pytest.mark.parametrize("stage", ["research", "follow_up", "reassessment", "synthesis"])
def test_rejected_key_aborts_every_graph_provider_stage(providers, stage, caplog):
    initial, follow_up, extraction = providers
    error = AuthenticationError(
        "private-token",
        response=httpx.Response(401, request=httpx.Request("POST", "https://api.anthropic.com")),
        body={},
    )
    if stage == "research":
        initial.side_effect = error
    elif stage in {"follow_up", "reassessment"}:
        initial.return_value = evidence(negative=True, status="disputed")
        if stage == "follow_up":
            follow_up.side_effect = error
        else:
            extraction.side_effect = error
    else:
        extraction.side_effect = error
    with pytest.raises(research.ResearchKeyRejected):
        run(MagicMock())
    assert "private-token" not in caplog.text


def test_failed_synthesis_cannot_replace_researched_advice_or_create_buy(providers):
    _, _, extraction = providers
    extraction.side_effect = RuntimeError("provider down")
    result = run(MagicMock())
    assert isinstance(result, IdeaOut)
    assert result.confidence == "low" and result.catalysts == []


@pytest.mark.parametrize(
    "untrusted_link",
    [
        "[support](//invented.example/fake-report)",
        "[support](/fake-report)",
        "[support](../fake-report)",
        "[support][fake]\n[fake]: //invented.example/report",
        "<//invented.example/report>",
        "<https://www.sec.gov/Archives/company-report>",
        "//invented.example/report",
        "mailto:attacker@invented.example",
        "javascript:alert(1)",
    ],
)
def test_only_plain_text_absolute_fetched_citations_are_accepted(providers, untrusted_link):
    _, _, extraction = providers
    extraction.return_value = {
        **prose(),
        "catalysts": [f"Known source ({URL}). Read {untrusted_link}."],
    }
    result = run(MagicMock())
    assert isinstance(result, IdeaOut)
    assert result.catalysts == []
    assert any("Synthesis unavailable" in note for note in result.data_notes)


def test_confirmed_official_thesis_invalidation_excludes_without_follow_up(providers):
    initial, follow_up, extraction = providers
    developed = evidence(negative=True)
    initial.return_value = developed
    extraction.return_value = reassessment(developed)
    result = run(MagicMock())
    assert isinstance(result, Exclusion)
    assert result.reason == "thesis_invalidated"
    assert result.evidence == [URL]
    assert developed.claims[0].text in result.explanation
    extraction.assert_awaited_once()
    follow_up.assert_not_awaited()


def test_invented_url_in_reassessment_explanation_cannot_reach_an_exclusion(providers):
    initial, _, extraction = providers
    developed = evidence(negative=True)
    initial.return_value = developed
    assessment = reassessment(developed)
    assessment["explanation"] += " More: https://invented.example/not-fetched"
    extraction.side_effect = [assessment, prose()]
    result = run(MagicMock())
    assert isinstance(result, IdeaOut)
    assert "invented.example" not in result.model_dump_json()
    assert any("Thesis reassessment unavailable" in note for note in result.data_notes)


def test_valid_non_invalidating_reassessment_is_retained_with_its_reason(providers):
    initial, _, extraction = providers
    developed = evidence(negative=True)
    initial.return_value = developed
    assessment = {
        **reassessment(developed),
        "invalidates_thesis": False,
        "explanation": (
            f'"{developed.claims[0].text}" ({URL}); replacement activity preserves the thesis.'
        ),
    }
    extraction.side_effect = [assessment, prose()]
    result = run(MagicMock())
    assert isinstance(result, IdeaOut)
    retained = result.negative_developments[0]
    assert retained.status == "confirmed"
    assert retained.invalidates_thesis is False
    assert retained.thesis_impact == assessment["explanation"]
    assert retained.evidence == developed.negative_developments[0].evidence
    assert retained.summary == developed.negative_developments[0].summary


@pytest.mark.parametrize("invalidates", [True, False])
def test_unsupported_reassessment_discloses_uncertainty_without_invalidating_flag(
    providers, invalidates
):
    initial, _, extraction = providers
    initial.return_value = evidence(negative=True)
    extraction.side_effect = [
        {"invalidates_thesis": invalidates, "explanation": "It is resolved.", "evidence": []},
        prose(),
    ]
    result = run(MagicMock())
    assert isinstance(result, IdeaOut)
    retained = result.negative_developments[0]
    assert retained.status == "confirmed"  # the event remains verified; its thesis effect does not
    assert retained.invalidates_thesis is False
    assert "unverified" in retained.thesis_impact
    assert any("Thesis invalidation was not verified" in note for note in result.data_notes)


def test_forum_allegation_never_excludes_and_has_one_follow_up(providers):
    initial, follow_up, extraction = providers
    developed = evidence(negative=True, forum=True, url="https://www.reddit.com/r/stocks/abc")
    initial.return_value = developed
    extraction.side_effect = [reassessment(developed), prose(developed.claims[0].url)]
    result = run(MagicMock())
    assert isinstance(result, IdeaOut)
    assert result.negative_developments[0].status == "unverified"
    assert result.negative_developments[0].invalidates_thesis is False
    assert result.confidence == "low"
    assert "Unverified" in result.community_note
    follow_up.assert_awaited_once()
    assert extraction.await_count == 2  # one reassessment, one synthesis


def test_unknown_host_cannot_promote_itself_to_official_evidence(providers):
    initial, follow_up, extraction = providers
    developed = evidence(negative=True, url="https://unknown.example/report")
    initial.return_value = developed
    extraction.side_effect = [reassessment(developed), prose(developed.claims[0].url)]
    result = run(MagicMock())
    assert isinstance(result, IdeaOut)
    assert result.sources[0].source_tier == "other"
    assert result.negative_developments[0].status == "unverified"
    follow_up.assert_awaited_once()


def test_independently_verified_issuer_host_can_support_an_exclusion(providers):
    initial, follow_up, extraction = providers
    developed = evidence(negative=True, url="https://issuer.example/report")
    initial.return_value = developed
    extraction.return_value = reassessment(developed)
    result = run(MagicMock(), official_hosts=("issuer.example",))
    assert isinstance(result, Exclusion)
    assert result.evidence == [developed.claims[0].url]
    follow_up.assert_not_awaited()
    assert initial.await_args.kwargs["official_hosts"] == ("issuer.example",)


def test_ambiguous_article_citation_does_not_assign_retained_impact_to_an_arbitrary_event(
    providers,
):
    initial, _, extraction = providers
    developed = evidence(negative=True)
    developed.negative_developments.append(
        developed.negative_developments[0].model_copy(
            update={"summary": "A separate material event."}
        )
    )
    initial.return_value = developed
    assessment = {
        **reassessment(developed),
        "invalidates_thesis": False,
        "explanation": f'"{developed.claims[0].text}" does not invalidate this thesis.',
    }
    extraction.side_effect = [assessment, prose()]
    result = run(MagicMock())
    assert isinstance(result, IdeaOut)
    assert len(result.negative_developments) == 2
    assert all(item.status == "confirmed" for item in result.negative_developments)
    assert all("unverified" in item.thesis_impact for item in result.negative_developments)
    assert any("not verified" in note for note in result.data_notes)


@pytest.mark.parametrize(
    "url", ["https://stocktwits.com/symbol/EXM", "https://news.ycombinator.com/item?id=1"]
)
def test_community_research_from_general_search_never_raises_confidence(providers, url):
    initial, follow_up, extraction = providers
    developed = evidence(negative=True, url=url)
    initial.return_value = developed
    extraction.side_effect = [reassessment(developed), prose(url)]
    result = run(MagicMock())
    assert isinstance(result, IdeaOut)
    assert result.confidence == "low"
    assert result.sources[0].kind == result.sources[0].source_tier == "forum"
    assert "Unverified" in result.community_note
    assert not result.negative_developments[0].invalidates_thesis
    follow_up.assert_awaited_once()


def test_follow_up_confirmation_is_rechecked_before_single_reassessment(providers):
    initial, follow_up, extraction = providers
    allegation = evidence(negative=True, forum=True, url="https://www.reddit.com/r/stocks/abc")
    confirmed = evidence(negative=True)
    initial.return_value = allegation
    follow_up.return_value = confirmed
    follow_up.side_effect = None
    extraction.return_value = reassessment(confirmed)
    result = run(MagicMock())
    assert isinstance(result, Exclusion)
    follow_up.assert_awaited_once()
    extraction.assert_awaited_once()
    assert extraction.await_args.args[2]["untrusted_data"]["evidence"]["claims"][0]["url"] == URL


def test_unresolved_dispute_never_loops(providers):
    initial, follow_up, extraction = providers
    disputed = evidence(negative=True, status="disputed")
    initial.return_value = disputed
    extraction.side_effect = [reassessment(disputed), prose()]
    result = run(MagicMock())
    assert isinstance(result, IdeaOut)
    assert result.negative_developments[0].status == "disputed"
    assert result.confidence == "low"
    follow_up.assert_awaited_once()
    assert extraction.await_count == 2


@pytest.mark.parametrize("stage", ["research", "follow_up", "reassessment", "synthesis"])
def test_provider_failures_preserve_quant_and_never_log_exception_secrets(providers, caplog, stage):
    initial, follow_up, extraction = providers
    failure = RuntimeError("SECRET-API-KEY-AND-REQUEST")
    if stage == "research":
        initial.side_effect = failure
    elif stage in {"follow_up", "reassessment"}:
        developed = evidence(negative=True, status="disputed")
        initial.return_value = developed
        extraction.side_effect = [reassessment(developed), prose()]
        if stage == "follow_up":
            follow_up.side_effect = failure
        else:
            extraction.side_effect = [failure, prose()]
    else:
        extraction.side_effect = failure
    result = run(MagicMock())
    assert isinstance(result, IdeaOut)
    assert any("unavailable" in note for note in result.data_notes)
    assert "SECRET-API-KEY-AND-REQUEST" not in caplog.text
    assert "SECRET-API-KEY-AND-REQUEST" not in result.model_dump_json()
    assert follow_up.await_count <= 1
    assert extraction.await_count <= 2


@pytest.mark.parametrize("stage", ["research", "follow_up", "reassessment", "synthesis"])
def test_task_cancellation_is_not_swallowed(providers, stage):
    initial, follow_up, extraction = providers

    async def scenario():
        started = asyncio.Event()

        async def pending(*args, **kwargs):
            started.set()
            await asyncio.Future()

        if stage == "research":
            initial.side_effect = pending
        elif stage == "follow_up":
            initial.return_value = evidence(negative=True, status="disputed")
            follow_up.side_effect = pending
        else:
            if stage == "reassessment":
                initial.return_value = evidence(negative=True)
            extraction.side_effect = pending
        task = asyncio.create_task(
            discovery_graph.run_discovery_graph(sample_candidate(), MagicMock())
        )
        await asyncio.wait_for(started.wait(), timeout=2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(scenario())


def test_no_peers_and_empty_portfolio_still_produce_full_result():
    candidate = sample_candidate()
    candidate.peers = []
    result = asyncio.run(discovery_graph.run_discovery_graph(candidate, None))
    assert isinstance(result, IdeaOut)
    assert result.overall is None
    assert all(score.score is None for score in result.scores)
    assert result.confidence == "low"
    assert result.fit_summary is None
    assert result.bear_case and result.conclusion


def test_non_applicable_fit_cannot_gain_a_model_fit_summary(providers):
    _, _, extraction = providers
    extraction.return_value = {**prose(), "fit_summary": "This portfolio will become perfect."}
    fit = CandidateFit(
        ticker=sample_candidate().ticker,
        applicable=False,
        avg_correlation_to_portfolio=None,
        portfolio_vol_before=None,
        portfolio_vol_after=None,
        hhi_before=None,
        hhi_after=None,
        sector_weight_before=None,
        sector_weight_after=None,
        hypothetical_weight=0.05,
        notes=["No holdings to compare."],
    )
    result = run(MagicMock(), fit=fit)
    assert isinstance(result, IdeaOut)
    assert result.fit_summary is None
    assert next(score for score in result.scores if score.name == "fit").score is None


def test_other_company_research_is_rejected(providers):
    initial, _, extraction = providers
    initial.return_value.ticker = "OTHER"
    result = run(MagicMock())
    assert isinstance(result, IdeaOut)
    assert result.sources == []
    assert result.ticker == sample_candidate().ticker
    extraction.assert_not_awaited()
