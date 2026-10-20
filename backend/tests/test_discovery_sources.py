"""URL authority comes from explicit host policy, with community evidence kept separate."""

import pytest

from app.discovery.sources import is_forum_url, source_tier


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://www.sec.gov/Archives/report", "official"),
        ("https://fca.org.uk/report", "official"),
        ("https://www.justice.gov/press-release", "official"),
        ("https://ec.europa.eu/competition", "official"),
        ("https://www.reuters.com/business/company", "reliable_reporting"),
        ("https://apnews.com/article/company", "reliable_reporting"),
        ("https://markets.ft.com/research", "reliable_reporting"),
        ("https://www.wsj.com/business/company", "reliable_reporting"),
        ("https://www.bloomberg.com/news/articles/company", "reliable_reporting"),
        ("HTTPS://WWW.REUTERS.COM./business", "reliable_reporting"),
        ("https://reporting.example/article", "other"),
        ("https://sec.gov.evil.example/report", "other"),
        ("https://reuters.com.evil.example/article", "other"),
        ("https://notreuters.com/article", "other"),
        ("https://www.sec.gov../report", "other"),
        ("https://www.reddit.com/r/stocks/comments/123", "forum"),
        ("https://stocktwits.com/symbol/TEST", "forum"),
        ("https://news.ycombinator.com/item?id=123", "forum"),
        ("https://investorshub.advfn.com/boards/read_msg.aspx?message_id=123", "forum"),
        ("https://reddit.com.evil.example/post", "other"),
        ("https://ycombinator.com/company", "other"),
        ("https://advfn.com/news", "other"),
    ],
)
def test_authority_uses_exact_host_or_subdomain(url: str, expected: str) -> None:
    assert source_tier(url) == expected
    assert is_forum_url(url) is (expected == "forum")


@pytest.mark.parametrize(
    "url",
    [
        "",
        "https:///sec.gov/report",
        "//sec.gov/report",
        "ftp://sec.gov/report",
        "javascript:https://sec.gov/report",
        "https://name:password@sec.gov/report",
        "https://@reuters.com/article",
        "https://name@reddit.com/post",
        "https://sec.gov:invalid/report",
        "https://sec.gov:65536/report",
        "https://sec.gov:0/report",
        "https://[bad/report",
        "https://sec.gov/has space",
        "https://sec.gov\n/report",
        "https://sec.gov/\x00report",
        "https://sec.gov/\u202ereport",
        "https://sec.gov\\@evil.example/report",
    ],
)
def test_invalid_or_credential_bearing_url_never_gets_authority(url: str) -> None:
    assert source_tier(url) == "other"
    assert not is_forum_url(url)


def test_only_verified_internal_metadata_can_extend_official_issuer_hosts() -> None:
    url = "https://investors.example-corp.test/filing"

    assert source_tier(url) == "other"
    assert source_tier(url, ["EXAMPLE-CORP.TEST."]) == "official"
    assert (
        source_tier("https://example-corp.test.evil.test/filing", ["example-corp.test"]) == "other"
    )
    assert source_tier("https://reddit.com/post", ["reddit.com"]) == "forum"
    assert source_tier("https://unknown.test/report", ["", "  "]) == "other"


@pytest.mark.parametrize(
    ("url", "forum"),
    [
        ("https://seekingalpha.com/article/123-industrial-update", False),
        ("https://seekingalpha.com/news/123-results", False),
        ("https://seekingalpha.com/article/123-commentary-on-results", False),
        ("https://seekingalpha.com/article/123#section-2", False),
        ("https://seekingalpha.com/article/123?comments=false", False),
        ("https://seekingalpha.com/comments", True),
        ("https://seekingalpha.com/comment/123", True),
        ("https://seekingalpha.com/user/123/comments", True),
        ("https://seekingalpha.com/user-blog/123-market-view", True),
        ("https://seekingalpha.com/instablog/123-market-view", True),
        ("https://seekingalpha.com/user/123/instablogs", True),
        ("https://seekingalpha.com/article/123/comments", True),
        ("https://seekingalpha.com/article/123#comments", True),
        ("https://seekingalpha.com/article/123#comment-123", True),
        ("https://seekingalpha.com/article/123#comment_123", True),
        ("https://seekingalpha.com/article/123#%63omment-123", True),
        ("https://seekingalpha.com/%63omments", True),
        ("https://seekingalpha.com.evil.example/comments", False),
    ],
)
def test_seeking_alpha_editorial_and_explicit_community_urls_are_distinct(
    url: str, forum: bool
) -> None:
    assert is_forum_url(url) is forum
    assert source_tier(url) == ("forum" if forum else "other")
