import pytest

from app.discovery.citations import prose_urls, validate_citations

URL = "https://www.sec.gov/Archives/company-report"


@pytest.mark.parametrize(
    "text",
    [
        "EBITDA margin >20% and P/E <15.",
        "Growth of 12% [1].",
        "Coverage > 5x.",
        "Valuation range [10, 15] remains uncertain.",
    ],
)
def test_financial_notation_is_prose_rather_than_a_link(text: str) -> None:
    assert prose_urls(text) == set()
    validate_citations(text, ())
    cited = f"{text} See {URL}."
    assert prose_urls(cited) == {URL}
    validate_citations(cited, {URL})


@pytest.mark.parametrize(
    "link",
    [
        "[support](/fake-report)",
        "![image](../fake-report)",
        "[support] [ref]\n[ref]: /fake-report",
        "[ref]\n> [ref]: /fake-report",
        "[ref]\n- [ref]: /fake-report",
        r"[escaped\]]" + "\n> [escaped\\]]: /fake-report",
        "[ref]\n[ref]: &#x2f;fake-report",
        '<a href="/fake-report">support</a>',
        '<A HREF="&#x2f;fake-report">support</A>',
        '<img src="/fake-report">',
        '<svg onload="alert(1)">',
        '<img src="/fake-report" alt="P/E<15">',
        '<img src=x onerror="alert(1<2)">',
        '<a href="/fake-report" title="P/E<15">',
        f"<{URL}>",
        "//invented.example/report",
        "javascript:alert(1)",
        "mailto:attacker@invented.example",
        "https://invented.example/report",
    ],
)
def test_safe_citation_cannot_hide_a_second_unvalidated_destination(link: str) -> None:
    with pytest.raises(ValueError):
        validate_citations(f"Known source {URL}. More: {link}", {URL})


@pytest.mark.parametrize("delimiter", ["'", '"', "<", ">", "[", "]"])
def test_citation_cannot_truncate_an_unvalidated_authority(delimiter: str) -> None:
    trusted = "https://known.example"
    with pytest.raises(ValueError):
        validate_citations(f"{trusted}{delimiter}@invented.example/report", {trusted})
