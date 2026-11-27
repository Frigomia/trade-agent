"""Application-owned retrieval for the web second opinion (ticket #306).

Two fixed Tavily searches per ticker give Claude a small, bounded block of sources instead of the
hosted web search, which cost 39k to 138k input tokens per call. Any `fallback` means the caller
uses the hosted search as before. Everything fetched is untrusted data.
"""

import json
import logging
from dataclasses import dataclass
from itertools import zip_longest
from typing import Any

import httpx
from redis.exceptions import RedisError

from app.agents import market_data, research
from app.config import settings
from app.discovery.sources import is_forum_url
from app.redis_client import get_redis

logger = logging.getLogger(__name__)

NEWS_SEARCHES = 2
MIN_SOURCES = 3
MAX_URL_CHARS = 500
MAX_TITLE_CHARS = 300
MAX_BLOCK_CHARS = 20_000

# Claims every search of one call or none, and only below the ceiling that leaves discovery its
# reserve. Same daily counter and lifetime as research._CLAIM_SEARCH_BUDGET.
_CLAIM_NEWS_SEARCHES = """
local count = tonumber(redis.call('get', KEYS[1]) or '0')
if count + tonumber(ARGV[2]) > tonumber(ARGV[1]) then return 0 end
redis.call('incrby', KEYS[1], ARGV[2])
redis.call('expire', KEYS[1], 172800)
return 1
"""


@dataclass
class Retrieval:
    block: str | None = None  # JSON list of numbered sources; None means use the hosted search
    source_count: int = 0
    searches_claimed: int | None = 0  # None: Redis failed, the claim may or may not have counted
    fallback: str | None = None  # a fixed reason code, safe to log


async def _claim_searches() -> bool:
    ceiling = settings.tavily_daily_search_limit - settings.tavily_discovery_reserve
    return bool(
        await get_redis().eval(
            _CLAIM_NEWS_SEARCHES, 1, research._search_budget_key(), ceiling, NEWS_SEARCHES
        )
    )


def _utf8(text: str) -> str:
    # A lone surrogate from a provider's JSON would make the whole Claude request unencodable.
    return text.encode("utf-8", "replace").decode("utf-8")


async def _subject(ticker: str) -> str:
    try:
        name = (await market_data.fetch_profile(ticker)).get("name")
    except Exception as exc:  # the name only sharpens the query
        logger.warning("News search name unavailable: %s", type(exc).__name__)
        name = None
    return f"{name} {ticker}" if name else ticker


def _queries(subject: str, asset_type: str) -> list[dict[str, Any]]:
    if asset_type == "ETF":
        news = f"{subject} ETF issuer index news"
        risks = f"{subject} ETF closure merger index change fee increase risks"
    else:
        news = f"{subject} stock news"
        risks = f"{subject} downgrade lawsuit guidance regulation risks"
    return [
        {"query": news, "topic": "news", "time_range": "month"},
        {"query": risks, "topic": "general", "time_range": "month"},
    ]


def _sources(results: list[list[Any]]) -> list[dict[str, Any]]:
    """Usable results, taken alternately from each search so a cap never drops one side."""
    sources: list[dict[str, Any]] = []
    seen: set[str] = set()
    # zip_longest pairs the 1st results of both searches, then the 2nd, padding with None.
    for pair in zip_longest(*results):
        for item in pair:
            if not isinstance(item, dict):
                continue
            # The normalized form only finds duplicates; the link cited is the one returned,
            # because normalizing can drop parts a page needs.
            identity = research._normalize_url(item.get("url"))
            text = item.get("content")
            if identity is None or identity in seen:
                continue
            url = str(item["url"])
            # Forum posts are unverified, and this prompt asks for every claim to cite its source.
            if len(url) > MAX_URL_CHARS or is_forum_url(url):
                continue
            if not isinstance(text, str) or not text.strip():
                continue
            seen.add(identity)
            published = research._published_date(item.get("published_date"))
            sources.append(
                {
                    "n": len(sources) + 1,
                    "url": url,
                    "title": _utf8(str(item.get("title") or "")[:MAX_TITLE_CHARS]),
                    "published": published.isoformat() if published else None,
                    "text": _utf8(text[: research.MAX_CONTENT_CHARS]),
                }
            )
    return sources


async def retrieve(ticker: str, asset_type: str) -> Retrieval:
    key = (settings.tavily_api_key or "").strip()
    if not key or settings.tavily_daily_search_limit == 0:
        return Retrieval(fallback="disabled")
    try:
        if not await _claim_searches():
            return Retrieval(fallback="no_headroom")
    except RedisError as exc:
        # Never retried: a timeout can arrive after the claim was already written.
        logger.warning("News search budget unavailable: %s", type(exc).__name__)
        return Retrieval(searches_claimed=None, fallback="budget_error")
    queries = _queries(await _subject(ticker), asset_type)
    results: list[list[Any]] = []
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as http:
            for query in queries:
                results.append(await research._search(http, query, key))
    except Exception as exc:  # claims stay counted: a failed request may still be billed
        logger.warning("News search unavailable: %s", type(exc).__name__)
        return Retrieval(searches_claimed=NEWS_SEARCHES, fallback="search_error")
    sources = _sources(results)
    # Encoded as JSON so a source's text cannot add lines or fields to the prompt.
    block = json.dumps(sources, ensure_ascii=False)
    while len(block) > MAX_BLOCK_CHARS:
        sources.pop()
        block = json.dumps(sources, ensure_ascii=False)
    if len(sources) < MIN_SOURCES:
        return Retrieval(searches_claimed=NEWS_SEARCHES, fallback="too_few_sources")
    return Retrieval(block=block, source_count=len(sources), searches_claimed=NEWS_SEARCHES)
