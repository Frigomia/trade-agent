"""Conservative source authority and community classification, independent of model labels."""

import unicodedata
from collections.abc import Collection
from typing import Literal
from urllib.parse import SplitResult, unquote, urlsplit

SourceTier = Literal["official", "reliable_reporting", "other", "forum"]

REPORTING_HOSTS = frozenset({"reuters.com", "apnews.com", "ft.com", "wsj.com", "bloomberg.com"})
OFFICIAL_HOSTS = frozenset({"sec.gov", "fca.org.uk", "justice.gov", "ec.europa.eu"})
FORUM_HOSTS = frozenset(
    {"reddit.com", "stocktwits.com", "news.ycombinator.com", "investorshub.advfn.com"}
)
_COMMENT_PATHS = {"comment", "comments", "user-blog", "user-blogs", "instablog", "instablogs"}


def _parts(url: str) -> SplitResult | None:
    # Reject characters that parsers might strip or interpret differently before checking hosts.
    if any(c.isspace() or unicodedata.category(c)[0] == "C" for c in url) or "\\" in url:
        return None
    try:
        parts = urlsplit(url)
        if (
            parts.scheme.lower() not in {"http", "https"}
            or not parts.hostname
            or parts.username is not None
            or parts.password is not None
            or parts.port == 0
        ):
            return None
        return parts
    except ValueError:
        return None


def _under(host: str, domains: Collection[str]) -> bool:
    return any(host == domain or host.endswith("." + domain) for domain in domains)


def _forum(parts: SplitResult) -> bool:
    host = (parts.hostname or "").lower().removesuffix(".")
    if _under(host, FORUM_HOSTS):
        return True
    if not _under(host, {"seekingalpha.com"}):
        return False
    segments = set(unquote(parts.path).casefold().split("/"))
    fragment = unquote(parts.fragment).casefold()
    return (
        bool(segments & _COMMENT_PATHS)
        or fragment in {"comment", "comments"}
        or fragment.startswith(("comment-", "comment_", "comments-", "comments_"))
    )


def is_forum_url(url: str) -> bool:
    """Classify the raw URL, before normalization drops a comment-identifying fragment."""
    parts = _parts(url)
    return parts is not None and _forum(parts)


def source_tier(url: str, official_hosts: Collection[str] = ()) -> SourceTier:
    """Classify authority without fetching a URL or accepting a model-provided reputation.

    Additional issuer hosts must be independently verified metadata from trusted internal
    callers, never model output, public request parameters or discovered company mentions.
    Community classification takes precedence over any supplied issuer-host metadata.
    """
    parts = _parts(url)
    if parts is None:
        return "other"
    if _forum(parts):
        return "forum"
    host = (parts.hostname or "").lower().removesuffix(".")
    verified_hosts = OFFICIAL_HOSTS | {
        value.lower().strip().removesuffix(".") for value in official_hosts if value.strip()
    }
    if _under(host, verified_hosts):
        return "official"
    if _under(host, REPORTING_HOSTS):
        return "reliable_reporting"
    return "other"
