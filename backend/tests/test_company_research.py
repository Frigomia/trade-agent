import asyncio
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.agents.discovery_graph import run_discovery_graph
from app.agents.research import ResearchUnavailable
from app.discovery import company
from tests.auth_support import USER_ID
from tests.discovery_fixtures import sample_candidate
from tests.test_discovery_admit import raw
from tests.test_discovery_screen import snap


def test_an_outside_universe_ticker_gets_only_its_own_fresh_snapshot(monkeypatch):
    today = datetime.now(UTC).date().isoformat()
    peers = [snap(i, dates=[today]) for i in range(1, 13)]
    monkeypatch.setattr(company, "load_universe", lambda: peers)
    monkeypatch.setattr(
        company,
        "load_snapshot",
        AsyncMock(side_effect=lambda keys: [] if keys == ["NEW"] else peers),
    )
    fetch = MagicMock(return_value=raw(last=today))
    monkeypatch.setattr(company, "fetch_yfinance", fetch)
    monkeypatch.setattr(company, "_user_inputs", lambda uid: ([], []))
    monkeypatch.setattr(company, "_rates", AsyncMock(return_value={"USD": Decimal("0.9")}))
    prepared = asyncio.run(company.prepare_company(USER_ID, "NEW"))
    assert prepared.candidate is not None and prepared.candidate.ticker == "NEW"
    assert prepared.candidate.origin == "watchlist"
    fetch.assert_called_once_with("NEW")


def test_company_request_cannot_charge_for_the_graphs_quant_only_fallback():
    with pytest.raises(ResearchUnavailable):
        asyncio.run(run_discovery_graph(sample_candidate(), None, require_research=True))


@pytest.mark.parametrize("quote_type", [None, "INDEX", "MUTUALFUND"])
def test_unknown_instrument_type_is_refused_before_normalization(monkeypatch, quote_type):
    monkeypatch.setattr(company, "load_universe", lambda: [])
    monkeypatch.setattr(company, "load_snapshot", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        company, "fetch_yfinance", lambda ticker: raw(info={"quoteType": quote_type})
    )
    result = asyncio.run(company.prepare_company(USER_ID, "UNKNOWN"))
    assert result.candidate is None
    assert "not a verified stock" in result.reason
