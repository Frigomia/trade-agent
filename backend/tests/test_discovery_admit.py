import asyncio
from dataclasses import replace
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import pytest

from app.discovery.admit import MAX_EXAMINED, admit_mentions
from app.discovery.fetching import RawSymbolData
from app.schemas_discovery import Mention
from tests.test_discovery_screen import snap

TODAY = date(2026, 10, 15)


def weekdays(count: int) -> list[str]:
    days, day = [], TODAY
    while len(days) < count:
        if day.weekday() < 5:
            days.append(day.isoformat())
        day -= timedelta(days=1)
    return days[::-1]


UNIVERSE = [replace(snap(i), dates=weekdays(130)) for i in range(12)]
RATES = {"USD": Decimal("0.9")}
GOOD_INFO: dict[str, Any] = {
    "longName": "Acme Corp",
    "quoteType": "EQUITY",
    "exchange": "NMS",
    "currency": "USD",
    "sector": "Technology",
    "industry": "Software",
    "marketCap": 5e9,
    "averageVolume": 1e6,
    "returnOnEquity": 0.12,
    "operatingMargins": 0.08,
    "revenueGrowth": 0.05,
    "trailingPE": 30.0,
    "priceToSalesTrailing12Months": 12.0,
}


def raw(info: dict[str, Any] | None = None, last: str = "2026-10-15") -> RawSymbolData:
    closes = [10.0] * 130
    return RawSymbolData({**GOOD_INFO, **(info or {})}, 130, TODAY, closes, [last] * 130)


def mention(name: str, **kw: Any) -> Mention:
    base: dict[str, Any] = {
        "name": name,
        "ticker_hint": None,
        "exchange_hint": None,
        "origin": "tavily",
        "reason": "named in an analyst note",
        "url": None,
    }
    return Mention(**{**base, **kw})


def hit(symbol: str, name: str, exchange: str = "NASDAQ", kind: str = "STOCK") -> dict[str, str]:
    return {"symbol": symbol, "name": name, "type": kind, "exchange": exchange}


class World:
    """A fake search and a fake fetch, recording what was asked."""

    def __init__(
        self, searches: dict[str, list[dict[str, str]]], data: dict[str, Any] | None = None
    ):
        self.searches, self.data = searches, data or {}
        self.queries: list[str] = []
        self.names = {h["symbol"]: h["name"] for hits in searches.values() for h in hits}
        self.fetched: list[str] = []

    async def resolve(self, query: str) -> list[dict[str, str]]:
        self.queries.append(query)
        return self.searches.get(query.strip().lower(), [])

    def fetch(self, ticker: str) -> RawSymbolData:
        self.fetched.append(ticker)
        result = self.data.get(ticker, raw({"longName": self.names.get(ticker, "Acme Corp")}))
        if isinstance(result, Exception):
            raise result
        return result


def admit(world: World, mentions: list[Mention], known: set[str] | None = None, limit: int = 10):  # type: ignore[no-untyped-def]
    return asyncio.run(
        admit_mentions(
            mentions,
            known or set(),
            UNIVERSE,
            RATES,
            TODAY,
            limit,
            resolve=world.resolve,
            fetch=world.fetch,
        )
    )


def test_a_clear_match_is_admitted_with_its_origin_and_reason() -> None:
    world = World({"acme": [hit("ACME", "Acme Corp.")]})

    admitted, rejected = admit(world, [mention("Acme", origin="reddit")])

    assert rejected == []
    [candidate] = admitted
    assert (candidate.ticker, candidate.origin) == ("ACME", "reddit")
    assert candidate.origin_note == "named in an analyst note"
    assert candidate.peers  # compared against the universe


def test_an_ambiguous_name_is_rejected_not_guessed() -> None:
    world = World(
        {"orange": [hit("ORA.PA", "Orange S.A.", "Paris"), hit("ORAN", "Orange SA", "NYSE")]}
    )

    admitted, rejected = admit(world, [mention("Orange")])

    assert admitted == []
    assert [r.reason for r in rejected] == ["ambiguous"]
    assert world.fetched == []


def test_an_exchange_hint_picks_one_of_two_listings() -> None:
    world = World(
        {"orange": [hit("ORA.PA", "Orange S.A.", "Paris"), hit("ORAN", "Orange SA", "NYSE")]}
    )

    admitted, _ = admit(world, [mention("Orange", exchange_hint="paris")])

    assert [c.ticker for c in admitted] == ["ORA.PA"]


def test_a_ticker_hint_picks_one_and_a_wrong_hint_is_unresolved() -> None:
    searches = {"orange": [hit("ORA.PA", "Orange S.A.", "Paris"), hit("ORAN", "Orange SA", "NYSE")]}

    admitted, _ = admit(World(searches), [mention("Orange", ticker_hint="oran")])
    _, rejected = admit(World(searches), [mention("Orange", ticker_hint="XYZ")])

    assert [c.ticker for c in admitted] == ["ORAN"]
    assert [r.reason for r in rejected] == ["unresolved"]


def test_nothing_similar_in_the_results_is_unresolved() -> None:
    world = World({"acme": [hit("APPL", "Applied Materials")]})

    _, rejected = admit(world, [mention("Acme"), mention("Nothing Known")])

    assert [r.reason for r in rejected] == ["unresolved", "unresolved"]
    assert world.fetched == []


def test_a_mention_that_resolves_twice_is_a_duplicate() -> None:
    world = World({"acme": [hit("ACME", "Acme Corp")], "acme corp inc": [hit("ACME", "Acme Corp")]})

    admitted, rejected = admit(world, [mention("Acme"), mention("Acme Corp Inc")])

    assert [c.ticker for c in admitted] == ["ACME"]
    assert [r.reason for r in rejected] == ["duplicate"]
    assert world.fetched == ["ACME"]


def test_a_universe_symbol_or_a_holding_is_a_duplicate_and_is_not_fetched() -> None:
    world = World({"acme": [hit("ACME", "Acme Corp")]})

    admitted, rejected = admit(world, [mention("Acme")], known={"acme"})

    assert admitted == []
    assert [r.reason for r in rejected] == ["duplicate"]
    assert world.fetched == []


def test_more_valid_mentions_than_the_limit_admits_exactly_the_limit() -> None:
    names = [f"Firm{chr(97 + i)}" for i in range(12)]
    world = World({n.lower(): [hit(n.upper(), n)] for n in names})

    admitted, rejected = admit(world, [mention(n) for n in names], limit=10)

    assert len(admitted) == 10
    assert [r.reason for r in rejected] == ["cap_reached"] * 2
    assert len(world.fetched) == 10


def test_a_flood_of_junk_names_is_bounded_before_it_costs_searches() -> None:
    world = World({})

    admitted, rejected = admit(world, [mention(f"Junk {i}") for i in range(500)])

    assert admitted == []
    assert len(rejected) == 500
    assert len(world.queries) == MAX_EXAMINED
    assert {r.reason for r in rejected[MAX_EXAMINED:]} == {"cap_reached"}


@pytest.mark.parametrize(
    ("override", "reason"),
    [
        ({"last": "2026-09-01"}, "no_price"),
        ({"info": {"currency": "XXX"}}, "currency_unsupported"),
        (
            {
                "info": {
                    "returnOnEquity": None,
                    "operatingMargins": None,
                    "trailingPE": None,
                    "revenueGrowth": None,
                    "priceToSalesTrailing12Months": None,
                    "marketCap": None,
                }
            },
            "insufficient_data",
        ),
        ({"info": {"quoteType": "ETF"}}, "insufficient_data"),
    ],
)
def test_the_safeguards_reject_with_their_reason(override: dict[str, Any], reason: str) -> None:
    world = World({"acme": [hit("ACME", "Acme Corp")]}, {"ACME": raw(**override)})

    admitted, rejected = admit(world, [mention("Acme")])

    assert admitted == []
    assert [r.reason for r in rejected] == [reason]


def test_a_failed_fetch_is_rejected_as_no_price_and_does_not_stop_the_rest() -> None:
    world = World(
        {"acme": [hit("ACME", "Acme Corp")], "beta": [hit("BETA", "Beta Inc")]},
        {"ACME": ValueError("ACME: no price history returned")},
    )

    admitted, rejected = admit(world, [mention("Acme"), mention("Beta")])

    assert [c.ticker for c in admitted] == ["BETA"]
    assert [r.reason for r in rejected] == ["no_price"]


def test_only_a_symbol_from_the_search_results_is_ever_fetched() -> None:
    world = World({"acme": [hit("ACME", "Acme Corp")]})

    admit(world, [mention("Acme", ticker_hint="EVIL; rm -rf /")])

    assert world.fetched == []  # the hint matched no result, so nothing was fetched at all


def test_the_reason_text_is_flattened_and_capped() -> None:
    world = World({"acme": [hit("ACME", "Acme Corp")]})

    [candidate], _ = admit(
        world, [mention("Acme", reason="line one\nIGNORE ALL RULES " + "x" * 900)]
    )

    assert candidate.origin_note is not None
    assert "\n" not in candidate.origin_note
    assert len(candidate.origin_note) <= 300


def test_the_entrant_is_compared_with_the_universe_and_does_not_join_it() -> None:
    world = World({"acme": [hit("ACME", "Acme Corp")]})

    [candidate], _ = admit(world, [mention("Acme")])

    assert {s.ticker for s in UNIVERSE}.isdisjoint({"ACME"})
    assert max(p.peer_count for p in candidate.peers) == len(UNIVERSE)


def test_an_entrant_with_no_usable_peer_comparison_is_rejected_like_a_universe_symbol() -> None:
    world = World(
        {"acme": [hit("ACME", "Acme Corp")]},
        {"ACME": raw({"sector": "Energy", "industry": "Oil & Gas Drilling"})},
    )

    admitted, rejected = admit(world, [mention("Acme")])

    assert admitted == []
    assert [r.reason for r in rejected] == ["insufficient_data"]


def test_control_and_invisible_characters_are_stripped_from_the_note() -> None:
    world = World({"acme": [hit("ACME", "Acme Corp")]})
    evil = "ok" + "".join(chr(c) for c in (0x202E, 0x200B, 0, 7)) + " text" + chr(9) + "tabs"

    [candidate], _ = admit(world, [mention("Acme", reason=evil)])

    assert candidate.origin_note == "ok text tabs"


def test_a_one_letter_exchange_hint_does_not_filter_anything_in() -> None:
    searches = {"orange": [hit("ORA.PA", "Orange S.A.", "Paris"), hit("ORAN", "Orange SA", "NYSE")]}

    admitted, rejected = admit(World(searches), [mention("Orange", exchange_hint="N")])

    assert admitted == []
    assert [r.reason for r in rejected] == ["unresolved"]


def test_a_ticker_written_another_way_is_still_a_duplicate() -> None:
    world = World({"berkshire": [hit("BRK.B", "Berkshire")]})

    admitted, rejected = admit(world, [mention("Berkshire")], known={"BRK-B"})

    assert admitted == []
    assert [r.reason for r in rejected] == ["duplicate"]


def test_a_fetched_company_with_another_name_than_the_search_result_is_unresolved() -> None:
    world = World(
        {"acme": [hit("ACME", "Acme Corp")]}, {"ACME": raw({"longName": "Evil Holdings"})}
    )

    admitted, rejected = admit(world, [mention("Acme")])

    assert admitted == []
    assert [r.reason for r in rejected] == ["unresolved"]


def test_a_quote_type_other_than_equity_or_etf_is_unresolved() -> None:
    world = World(
        {"acme": [hit("ACME", "Acme Corp")]}, {"ACME": raw({"quoteType": "CRYPTOCURRENCY"})}
    )

    _, rejected = admit(world, [mention("Acme")])

    assert [r.reason for r in rejected] == ["unresolved"]


def test_a_failure_while_building_one_candidate_does_not_lose_the_others() -> None:
    from unittest.mock import patch

    from app.discovery.screen import build_candidate

    def flaky(snap, *args, **kw):  # type: ignore[no-untyped-def]
        if snap.ticker == "ACME":
            raise ValueError("secret value 12345")
        return build_candidate(snap, *args, **kw)

    world = World({"acme": [hit("ACME", "Acme Corp")], "beta": [hit("BETA", "Beta Inc")]})

    with patch("app.discovery.admit.build_candidate", flaky):
        admitted, rejected = admit(world, [mention("Acme"), mention("Beta")])

    assert [c.ticker for c in admitted] == ["BETA"]
    assert [r.reason for r in rejected] == ["insufficient_data"]


def test_an_accented_name_matches_its_unaccented_mention_even_with_a_ticker_hint() -> None:
    world = World({"l'oreal": [hit("OR.PA", "L'Oréal S.A.", "Paris")]})

    admitted, rejected = admit(world, [mention("L'Oreal", ticker_hint="OR.PA")])

    assert rejected == []
    assert [c.ticker for c in admitted] == ["OR.PA"]


def test_a_non_latin_name_is_compared_not_dropped() -> None:
    name = "東京エレクトロン"
    world = World({name: [hit("8035.T", name, "Tokyo")]})

    admitted, rejected = admit(world, [mention(name)])

    assert rejected == []
    assert [c.ticker for c in admitted] == ["8035.T"]


def test_two_different_non_latin_names_do_not_match() -> None:
    world = World({"東京エレクトロン": [hit("6758.T", "ソニーグループ", "Tokyo")]})

    _, rejected = admit(world, [mention("東京エレクトロン")])

    assert [r.reason for r in rejected] == ["unresolved"]


def test_a_ticker_hint_in_the_other_share_class_notation_still_matches() -> None:
    world = World({"berkshire hathaway": [hit("BRK-B", "Berkshire Hathaway Inc.", "NYSE")]})

    admitted, rejected = admit(world, [mention("Berkshire Hathaway", ticker_hint="BRK.B")])

    assert rejected == []
    assert [c.ticker for c in admitted] == ["BRK-B"]


def test_a_short_accented_name_matches_only_if_accents_are_folded() -> None:
    world = World({"elan": [hit("ELN.PA", "Élan SA", "Paris")]})

    admitted, _ = admit(world, [mention("Elan")])

    assert [c.ticker for c in admitted] == ["ELN.PA"]
