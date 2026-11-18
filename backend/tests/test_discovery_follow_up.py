import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agents import research
from app.config import settings
from tests.discovery_fixtures import sample_candidate
from tests.test_discovery_thesis import FACT, evidence


def test_follow_up_has_one_search_and_one_extraction_and_preserves_old_evidence(
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "tavily_api_key", "test-key")
    previous = evidence()
    url = "https://www.sec.gov/filing"
    sources = {url: research._Source(url, "Licence", FACT, None, "tavily")}
    claim = previous.claims[0].model_copy(update={"url": url}).model_dump(mode="json")
    data = {
        "claims": [claim],
        "negative_developments": [],
        "competitors": [],
        "mentions": [],
        "conflicts": [],
        "gaps": [],
    }
    with (
        patch.object(research, "_gather", AsyncMock(return_value=(sources, [], True))) as search,
        patch.object(research, "_extract", AsyncMock(return_value=data)) as extract,
        patch.object(research, "_get_client") as fallback,
    ):
        result = asyncio.run(
            research.follow_up_candidate(
                sample_candidate(), previous, MagicMock(), "licence " * 200
            )
        )
    search.assert_awaited_once()
    assert len(search.await_args.args[0]) == 1
    assert len(search.await_args.args[0][0][1]["query"]) <= 500
    extract.assert_awaited_once()
    fallback.assert_not_called()
    assert {c.url for c in result.claims} == {previous.claims[0].url, url}
    assert result.negative_developments == previous.negative_developments


def test_follow_up_failure_preserves_original_evidence_and_sanitizes_errors(
    monkeypatch, caplog
) -> None:
    monkeypatch.setattr(settings, "tavily_api_key", "test-key")
    previous = evidence()
    url = previous.claims[0].url
    sources = {url: research._Source(url, "Licence", FACT, None, "tavily")}
    with (
        patch.object(research, "_gather", AsyncMock(return_value=(sources, [], True))),
        patch.object(research, "_extract", AsyncMock(side_effect=ValueError("private-token"))),
    ):
        result = asyncio.run(
            research.follow_up_candidate(sample_candidate(), previous, MagicMock(), "licence")
        )
    assert result.claims == previous.claims
    assert result.negative_developments == previous.negative_developments
    assert any("Follow-up extraction unavailable" in gap for gap in result.gaps)
    assert "private-token" not in caplog.text


def test_follow_up_key_rejection_is_not_swallowed(monkeypatch):
    monkeypatch.setattr(settings, "tavily_api_key", "test-key")
    previous = evidence()
    url = previous.claims[0].url
    sources = {url: research._Source(url, "Licence", FACT, None, "tavily")}
    with (
        patch.object(research, "_gather", AsyncMock(return_value=(sources, [], True))),
        patch.object(research, "_extract", AsyncMock(side_effect=research.ResearchKeyRejected())),
        pytest.raises(research.ResearchKeyRejected),
    ):
        asyncio.run(
            research.follow_up_candidate(sample_candidate(), previous, MagicMock(), "licence")
        )


def test_follow_up_never_falls_back_to_the_server_key() -> None:
    with (
        patch.object(research, "_get_client") as fallback,
        pytest.raises(research.ResearchUnavailable),
    ):
        asyncio.run(research.follow_up_candidate(sample_candidate(), evidence(), None, "licence"))
    fallback.assert_not_called()


def test_follow_up_preserves_different_claims_from_the_same_article(monkeypatch) -> None:
    monkeypatch.setattr(settings, "tavily_api_key", "test-key")
    previous = evidence()
    url = previous.claims[0].url
    new_fact = "Revenue declined ten percent."
    sources = {url: research._Source(url, "Update", FACT + " " + new_fact, None, "tavily")}
    claim = (
        previous.claims[0]
        .model_copy(update={"text": new_fact, "event_id": "earnings"})
        .model_dump(mode="json")
    )
    with (
        patch.object(research, "_gather", AsyncMock(return_value=(sources, [], True))),
        patch.object(research, "_extract", AsyncMock(return_value={"claims": [claim]})),
    ):
        result = asyncio.run(
            research.follow_up_candidate(sample_candidate(), previous, MagicMock(), "update")
        )
    assert {item.text for item in result.claims} == {FACT, new_fact}
    assert len(result.claims) == 2


def test_follow_up_applies_trusted_issuer_hosts_before_confirmation(monkeypatch) -> None:
    monkeypatch.setattr(settings, "tavily_api_key", "test-key")
    url = "https://issuer.example/report"
    previous = evidence(url)
    sources = {url: research._Source(url, "Licence", FACT, None, "tavily")}
    data = previous.model_dump(mode="json")
    with (
        patch.object(research, "_gather", AsyncMock(return_value=(sources, [], True))),
        patch.object(research, "_extract", AsyncMock(return_value=data)),
    ):
        result = asyncio.run(
            research.follow_up_candidate(
                sample_candidate(),
                previous,
                MagicMock(),
                "licence",
                official_hosts=("issuer.example",),
            )
        )
    assert result.claims[0].source_tier == "official"
    assert result.negative_developments[0].status == "confirmed"
    assert result.negative_developments[0].invalidates_thesis


def _run_follow_up(urls, official_hosts=()):
    previous = evidence()
    sources = {u: research._Source(u, "Title", FACT, None, "tavily") for u in urls}
    data = {
        "claims": [],
        "negative_developments": [],
        "competitors": [],
        "mentions": [],
        "conflicts": [],
        "gaps": [],
    }
    with (
        patch.object(research, "_gather", AsyncMock(return_value=(sources, ["search note"], True))),
        patch.object(research, "_extract", AsyncMock(return_value=data)) as extract,
        patch.object(research, "_get_client"),
    ):
        result = asyncio.run(
            research.follow_up_candidate(
                sample_candidate(), previous, MagicMock(), "question", official_hosts=official_hosts
            )
        )
    return previous, result, extract


def test_follow_up_makes_no_claude_call_when_no_result_is_authoritative(monkeypatch) -> None:
    monkeypatch.setattr(settings, "tavily_api_key", "test-key")
    previous, result, extract = _run_follow_up(
        ["https://www.reddit.com/r/stocks/abc", "https://unknown-blog.example/post"]
    )
    extract.assert_not_awaited()
    assert result.claims == previous.claims
    assert result.negative_developments == previous.negative_developments
    assert result.gaps == [*previous.gaps, "search note", research.NO_AUTHORITY_GAP]


@pytest.mark.parametrize(
    "url", ["https://www.reuters.com/business/licence", "https://www.sec.gov/Archives/filing"]
)
def test_follow_up_extracts_when_a_result_is_reliable_reporting_or_official(
    monkeypatch, url
) -> None:
    monkeypatch.setattr(settings, "tavily_api_key", "test-key")
    _, _, extract = _run_follow_up(["https://www.reddit.com/r/stocks/abc", url])
    extract.assert_awaited_once()


def test_follow_up_extracts_for_a_verified_issuer_host(monkeypatch) -> None:
    monkeypatch.setattr(settings, "tavily_api_key", "test-key")
    url = "https://ir.example-issuer.com/news/licence"
    _, _, without_host = _run_follow_up([url])
    without_host.assert_not_awaited()
    _, _, with_host = _run_follow_up([url], official_hosts=("example-issuer.com",))
    with_host.assert_awaited_once()
