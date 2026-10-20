"""Validate plain-text citations without interpreting model-supplied Markdown or HTML."""

import re
from collections.abc import Collection

from app.agents.research import _normalize_url

_URL = re.compile(
    r"(?i)(?:\b(?:[a-z][a-z0-9+.-]*://|(?:javascript|data|mailto):|www\.)|(?<!:)//)"
    r"[^\s]+"
)
# Reject link syntax, not financial comparisons or standalone numeric markers such as [1].
_MARKDOWN_DESTINATION = re.compile(r"\]\s*(?:\(|\[|:)")
_HTML_OR_AUTOLINK = re.compile(r"<\s*(?:/?[A-Za-z]|!|\?)")


def prose_urls(text: str) -> set[str]:
    # Plain-text citations avoid needing a Markdown/HTML parser to validate link destinations.
    if _MARKDOWN_DESTINATION.search(text) or _HTML_OR_AUTOLINK.search(text):
        raise ValueError("Markdown links, HTML and autolinks are not supported")
    urls: set[str] = set()
    for match in _URL.finditer(text):
        value = match.group().rstrip(".,;:!?")
        while value.endswith(")") and value.count(")") > value.count("("):
            value = value[:-1]
        normalized = _normalize_url(value)
        if normalized is None:
            raise ValueError("Unsupported prose citation")
        urls.add(normalized)
    return urls


def validate_citations(text: str, allowed: Collection[str]) -> None:
    known = {url for raw in allowed if (url := _normalize_url(raw)) is not None}
    if not prose_urls(text) <= known:
        raise ValueError("Prose cited a source outside the fetched evidence")
