# build_context (4c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire long-term memory (step 3) + investment preferences (4b) +
session memory (4a) into `news_agent`, the qualitative-only LLM step in
`agents/graph.py` — the last piece of ARCHITECTURE.md §15.1 step 4.

**Architecture:** A new `agents/context.py` assembles three text sections
from the database. A new graph node, `context_agent`, calls it and stores
the result in `AnalysisState`. `news_agent` (both the `agents/news.py`
function and the graph node) is extended to include that context in its
Claude prompt. `context_agent` opens and closes its own DB session —
`agents/graph.py` has never touched the database before this, and this
keeps it that way for every other node.

**Tech Stack:** FastAPI, SQLAlchemy 2 (sync ORM), LangGraph, Anthropic
SDK, pytest.

**Spec:** `docs/superpowers/specs/2026-09-25-build-context-design.md`

## Global Constraints

- `context_agent` opens its own `SessionLocal()` and closes it before
  returning — no `Session` threaded through `AnalysisState`, no signature
  change to `run_graph_for_ticker`.
- `context_agent` has the exact same skip condition as `news_agent`:
  `state["action"] is None or state["action"] == "HOLD"`. This is also
  what guarantees nothing it produces can influence the decision it comes
  after — `synthesizer` has already run by the time either node executes.
- Any failure inside `build_context` (DB error, missing
  `VOYAGE_API_KEY`, Voyage API error) is caught and logged, never raised
  — the graph must complete with `context: None` rather than abort.
- No change to `analysis/recommend.py` or `analysis/technical.py`, at all.
- No "untrusted data" framing needed for `build_context`'s output — it's
  the user's own first-party data (their preferences, their past
  recommendations, their own chat messages), not external content.
- **Every existing test in `tests/test_agents_graph.py` currently needs
  zero database connection** (only `market_data` and `news.run_news_agent`
  are mocked). Adding `context_agent` means every test path where
  `action` is decided must also mock `app.agents.context.build_context`
  — otherwise a previously DB-free test starts requiring real Postgres.
  This is the single easiest thing to get wrong in this plan.
- Session memory lookup is a plain `ILIKE '%{ticker}%'` on
  `ChatMessage.content`, not scoped by `user_id` or `session_id` — every
  `ChatMessage` row belongs to this single-user system's one user.

## Review Focus

- A ticker containing a `.` (e.g. `"BRK.B"`, a real, already-allowed
  ticker format per `schemas.py`'s `Ticker` pattern) used in the `ILIKE`
  substring match — SQL `LIKE`/`ILIKE` treats `.` as a literal character,
  not a wildcard, so this should just work, but it's new code and worth
  pinning with a test rather than assuming.
- `VOYAGE_API_KEY` not configured (the common local-dev case, and
  `embed_text`'s own documented failure mode) — `build_context` must
  return its "no similar past recommendations" fallback text, not raise,
  and the whole graph must still complete with `ai_analysis` populated.
- A `Recommendation` row that has an `embedding` (so it's a real
  similarity match) but `outcome_forward_return_pct` still `None` (not
  yet evaluated, e.g. inside the 20-day lookback window) — formatting
  must handle this without crashing or printing the literal string
  `"None"` into the prompt text.
- A `ChatMessage.content` longer than the 500-char display truncation —
  confirm slicing doesn't crash on the boundary (Python string slicing is
  unicode-safe by default, but this is new code, worth a test).
- Concurrent ticker runs under `jobs.py`'s `asyncio.gather` with
  `MAX_CONCURRENT_TICKERS = 3` — each `context_agent` call opens its own
  `SessionLocal()`, so there's no shared-session hazard by construction.
  Not separately tested (a real concurrency test would be disproportionate
  for a personal, 3-concurrent-max tool); noted here as a design property
  to verify by inspection during review, not by a new test.

---

## Task 1: `agents/context.py`

**Files:**
- Create: `backend/app/agents/context.py`
- Test: `backend/tests/test_agents_context.py`

**Interfaces:**
- Consumes: `app.memory.embeddings.embed_text(text: str) -> list[float]`
  (existing), `app.memory.similarity.find_similar(db: Session,
  query_embedding: list[float], top_k: int) -> list[Recommendation]`
  (existing), `app.models.InvestmentPreferences`, `app.models.ChatMessage`
  (existing).
- Produces: `async def build_context(db: Session, ticker: str, asset_type:
  str, action: str, reasoning: list[str]) -> str` — used by Task 3's
  `context_agent` node.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_agents_context.py
import asyncio
from unittest.mock import AsyncMock, patch

from app.agents.context import build_context
from app.config import settings
from app.models import ChatMessage, InvestmentPreferences, Recommendation


def test_build_context_reports_no_preferences_when_none_exist(db_session):
    with patch("app.agents.context.embed_text", AsyncMock(return_value=[0.1] * 1024)):
        context = asyncio.run(
            build_context(db_session, "AAPL", "STOCK", "BUY", ["PEG 1.1"])
        )

    assert "No stated investment preferences." in context


def test_build_context_includes_preferences_fields(db_session):
    db_session.add(
        InvestmentPreferences(
            user_id=settings.default_user_id,
            risk_tolerance="conservative",
            sector_avoid_list=["tobacco"],
            notes="Prefer dividend growth.",
        )
    )
    db_session.commit()

    with patch("app.agents.context.embed_text", AsyncMock(return_value=[0.1] * 1024)):
        context = asyncio.run(
            build_context(db_session, "AAPL", "STOCK", "BUY", ["PEG 1.1"])
        )

    assert "conservative" in context
    assert "tobacco" in context
    assert "Prefer dividend growth." in context


def test_build_context_finds_similar_past_recommendation_with_outcome(db_session):
    rec = Recommendation(
        user_id=settings.default_user_id,
        ticker="AAPL",
        asset_type="STOCK",
        action="BUY",
        reasoning=["PEG 1.0"],
        embedding=[0.1] * 1024,
        outcome_forward_return_pct=0.05,
    )
    db_session.add(rec)
    db_session.commit()

    with patch("app.agents.context.embed_text", AsyncMock(return_value=[0.1] * 1024)):
        context = asyncio.run(
            build_context(db_session, "AAPL", "STOCK", "BUY", ["PEG 1.1"])
        )

    assert "AAPL" in context
    assert "5.00%" in context or "5%" in context


def test_build_context_handles_unevaluated_outcome_without_crashing(db_session):
    rec = Recommendation(
        user_id=settings.default_user_id,
        ticker="AAPL",
        asset_type="STOCK",
        action="BUY",
        reasoning=["PEG 1.0"],
        embedding=[0.1] * 1024,
        outcome_forward_return_pct=None,
    )
    db_session.add(rec)
    db_session.commit()

    with patch("app.agents.context.embed_text", AsyncMock(return_value=[0.1] * 1024)):
        context = asyncio.run(
            build_context(db_session, "AAPL", "STOCK", "BUY", ["PEG 1.1"])
        )

    assert "None" not in context.split("## Relevant chat history")[0].split(
        "## Similar past recommendations"
    )[1]


def test_build_context_handles_embed_failure_without_raising(db_session):
    with patch(
        "app.agents.context.embed_text", AsyncMock(side_effect=RuntimeError("no key"))
    ):
        context = asyncio.run(
            build_context(db_session, "AAPL", "STOCK", "BUY", ["PEG 1.1"])
        )

    assert "No similar past recommendations found." in context


def test_build_context_finds_relevant_chat_history_case_insensitive(db_session):
    db_session.add(
        ChatMessage(
            user_id=settings.default_user_id,
            session_id="s1",
            role="user",
            content="what do you think about aapl right now?",
        )
    )
    db_session.commit()

    with patch("app.agents.context.embed_text", AsyncMock(return_value=[0.1] * 1024)):
        context = asyncio.run(
            build_context(db_session, "AAPL", "STOCK", "BUY", ["PEG 1.1"])
        )

    assert "aapl right now" in context


def test_build_context_matches_ticker_containing_dot(db_session):
    db_session.add(
        ChatMessage(
            user_id=settings.default_user_id,
            session_id="s1",
            role="user",
            content="should I add to my BRK.B position?",
        )
    )
    db_session.commit()

    with patch("app.agents.context.embed_text", AsyncMock(return_value=[0.1] * 1024)):
        context = asyncio.run(
            build_context(db_session, "BRK.B", "STOCK", "ADD", ["strong fundamentals"])
        )

    assert "BRK.B position" in context


def test_build_context_reports_no_chat_history_when_none_match(db_session):
    db_session.add(
        ChatMessage(
            user_id=settings.default_user_id,
            session_id="s1",
            role="user",
            content="how's my portfolio doing overall?",
        )
    )
    db_session.commit()

    with patch("app.agents.context.embed_text", AsyncMock(return_value=[0.1] * 1024)):
        context = asyncio.run(
            build_context(db_session, "AAPL", "STOCK", "BUY", ["PEG 1.1"])
        )

    assert "No relevant chat history." in context


def test_build_context_truncates_long_chat_message(db_session):
    long_content = "AAPL " + "x" * 600
    db_session.add(
        ChatMessage(
            user_id=settings.default_user_id,
            session_id="s1",
            role="user",
            content=long_content,
        )
    )
    db_session.commit()

    with patch("app.agents.context.embed_text", AsyncMock(return_value=[0.1] * 1024)):
        context = asyncio.run(
            build_context(db_session, "AAPL", "STOCK", "BUY", ["PEG 1.1"])
        )

    assert len(context) < len(long_content) + 2000  # sanity: not the full 600+ chars verbatim twice over
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run python -m pytest tests/test_agents_context.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.agents.context'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/agents/context.py
import logging

from sqlalchemy.orm import Session

from app.config import settings
from app.memory.embeddings import embed_text
from app.memory.similarity import find_similar
from app.models import ChatMessage, InvestmentPreferences

logger = logging.getLogger(__name__)

CHAT_HISTORY_LIMIT = 5
CHAT_MESSAGE_DISPLAY_LIMIT = 500
SIMILAR_RECOMMENDATIONS_LIMIT = 3


def _build_preferences_section(db: Session) -> str:
    pref = (
        db.query(InvestmentPreferences)
        .filter_by(user_id=settings.default_user_id)
        .one_or_none()
    )
    if pref is None:
        return "No stated investment preferences."

    parts = []
    if pref.risk_tolerance:
        parts.append(f"Risk tolerance: {pref.risk_tolerance}")
    if pref.sector_avoid_list:
        parts.append(f"Avoid sectors: {', '.join(pref.sector_avoid_list)}")
    if pref.notes:
        parts.append(f"Notes: {pref.notes}")
    return "\n".join(parts) if parts else "No stated investment preferences."


async def _build_memory_section(
    db: Session, ticker: str, asset_type: str, action: str, reasoning: list[str]
) -> str:
    situation = f"{ticker} ({asset_type}): {action}. {'; '.join(reasoning)}."
    try:
        embedding = await embed_text(situation)
        similar = find_similar(db, embedding, top_k=SIMILAR_RECOMMENDATIONS_LIMIT)
    except Exception:
        logger.exception("Long-term memory lookup failed for %s", ticker)
        similar = []

    if not similar:
        return "No similar past recommendations found."

    lines = []
    for rec in similar:
        rec_reasoning = "; ".join(rec.reasoning)
        line = f"- {rec.ticker}: {rec.action}. {rec_reasoning}"
        if rec.outcome_forward_return_pct is not None:
            line += f" (outcome: {float(rec.outcome_forward_return_pct):+.2%})"
        lines.append(line)
    return "\n".join(lines)


def _build_session_memory_section(db: Session, ticker: str) -> str:
    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.content.ilike(f"%{ticker}%"))
        .order_by(ChatMessage.created_at.desc())
        .limit(CHAT_HISTORY_LIMIT)
        .all()
    )
    if not messages:
        return "No relevant chat history."

    lines = [f"- {m.role}: {m.content[:CHAT_MESSAGE_DISPLAY_LIMIT]}" for m in messages]
    return "\n".join(lines)


async def build_context(
    db: Session, ticker: str, asset_type: str, action: str, reasoning: list[str]
) -> str:
    preferences_text = _build_preferences_section(db)
    memory_text = await _build_memory_section(db, ticker, asset_type, action, reasoning)
    session_text = _build_session_memory_section(db, ticker)

    return (
        f"## Investment preferences\n{preferences_text}\n\n"
        f"## Similar past recommendations\n{memory_text}\n\n"
        f"## Relevant chat history\n{session_text}"
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run python -m pytest tests/test_agents_context.py -v`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/agents/context.py backend/tests/test_agents_context.py
git commit -m "feat: add build_context, assembles preferences + long-term memory + session memory"
```

---

## Task 2: `agents/news.py` — optional context parameter

**Files:**
- Modify: `backend/app/agents/news.py`
- Test: `backend/tests/test_agents_news.py`

**Interfaces:**
- Produces: `run_news_agent(ticker: str, action: str, reasoning: list[str],
  context: str | None = None) -> str | None` — used by Task 3's
  `news_agent` graph node.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_agents_news.py` (existing imports and the
two existing tests stay as they are):

```python
def test_run_news_agent_includes_context_when_provided(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    news._client = None

    fake_block = MagicMock()
    fake_block.type = "text"
    fake_block.text = "Qualitative read."
    fake_response = MagicMock()
    fake_response.content = [fake_block]

    with patch("app.agents.news.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = fake_response
        mock_anthropic_cls.return_value = mock_client

        asyncio.run(
            news.run_news_agent(
                "AAPL", "BUY", ["PEG 1.1"], context="## Investment preferences\nConservative."
            )
        )

    call_kwargs = mock_client.messages.create.call_args.kwargs
    user_message = call_kwargs["messages"][0]["content"]
    assert "Additional context" in user_message
    assert "Conservative." in user_message


def test_run_news_agent_omits_context_section_when_none(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    news._client = None

    fake_block = MagicMock()
    fake_block.type = "text"
    fake_block.text = "Qualitative read."
    fake_response = MagicMock()
    fake_response.content = [fake_block]

    with patch("app.agents.news.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = fake_response
        mock_anthropic_cls.return_value = mock_client

        asyncio.run(news.run_news_agent("AAPL", "BUY", ["PEG 1.1"]))

    call_kwargs = mock_client.messages.create.call_args.kwargs
    user_message = call_kwargs["messages"][0]["content"]
    assert "Additional context" not in user_message
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run python -m pytest tests/test_agents_news.py -v`
Expected: FAIL — `TypeError: run_news_agent() got an unexpected keyword argument 'context'`

- [ ] **Step 3: Write minimal implementation**

In `backend/app/agents/news.py`, change the `run_news_agent` signature and
body:

```python
async def run_news_agent(
    ticker: str, action: str, reasoning: list[str], context: str | None = None
) -> str | None:
    client = _get_client()
    if client is None:
        return None

    quant_summary = "; ".join(reasoning)
    user_message = (
        f"Ticker: {ticker}\nQuantitative recommendation: {action}\n"
        f"Quantitative reasoning: {quant_summary}\n"
    )
    if context:
        user_message += f"\n## Additional context\n{context}\n"
    user_message += (
        "\nSearch for recent news on this ticker and give a brief qualitative second opinion."
    )

    def _create() -> Message:
        return client.messages.create(
            model=settings.anthropic_model,
            max_tokens=4096,
            system=NEWS_AGENT_SYSTEM_PROMPT,
            tools=[{"type": "web_search_20260209", "name": "web_search"}],
            messages=[{"role": "user", "content": user_message}],
        )

    response = await asyncio.to_thread(_create)

    text_blocks = [block.text for block in response.content if block.type == "text"]
    return "\n".join(text_blocks) if text_blocks else None
```

Everything else in the file (imports, `NEWS_AGENT_SYSTEM_PROMPT`,
`_client`, `_get_client`) stays exactly as it is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run python -m pytest tests/test_agents_news.py -v`
Expected: PASS (4 tests — 2 existing + 2 new)

- [ ] **Step 5: Commit**

```bash
git add backend/app/agents/news.py backend/tests/test_agents_news.py
git commit -m "feat: run_news_agent accepts optional context, included in the Claude prompt"
```

---

## Task 3: Wire `context_agent` into `agents/graph.py`

**Files:**
- Modify: `backend/app/agents/graph.py`
- Modify: `backend/tests/test_agents_graph.py`

**Interfaces:**
- Consumes: `app.agents.context.build_context` (Task 1),
  `app.agents.news.run_news_agent` with its new `context` parameter
  (Task 2).
- Produces: `AnalysisState` gains `context: str | None`. Graph shape
  becomes `... -> synthesizer -> context_agent -> news_agent -> END`.

- [ ] **Step 1: Update the three existing tests to mock `build_context`**

This step comes before writing any new code, because it's what proves the
"existing tests must stay DB-free" constraint — run them against the
*current* graph first to see them pass for the old reason, then again
after Step 3 to see them still pass for the new reason.

Replace the full contents of `backend/tests/test_agents_graph.py` with:

```python
import asyncio
from unittest.mock import AsyncMock, patch

from app.agents.graph import run_graph_for_ticker


def test_run_graph_for_stock_produces_buy_recommendation():
    quote = {
        "price": 86.0,
        "closes": [100.0] * 200 + [100.0 - i for i in range(1, 15)],
    }
    fundamentals = {
        "peg_ratio": 0.9,
        "roe": 0.22,
        "debt_to_equity": 0.3,
        "revenue_growth": 0.18,
        "profit_margin": 0.20,
    }
    with (
        patch("app.agents.market_data.fetch_quote_and_history", AsyncMock(return_value=quote)),
        patch("app.agents.market_data.fetch_fundamentals", AsyncMock(return_value=fundamentals)),
        patch("app.agents.context.build_context", AsyncMock(return_value="Some context")),
        patch("app.agents.news.run_news_agent", AsyncMock(return_value="Qualitative color")),
    ):
        result = asyncio.run(run_graph_for_ticker("AAPL", "STOCK", is_held=False))

    assert result["fundamental_score"] == 100
    assert result["technical_signal"] == "OVERSOLD"
    assert result["action"] == "BUY"
    assert result["suggested_position_pct"] == 0.15
    assert result["context"] == "Some context"
    assert result["ai_analysis"] == "Qualitative color"


def test_run_graph_for_etf_skips_fundamentals_news_and_context_on_hold():
    quote = {"price": 100.0, "closes": [100.0] * 220}
    with (
        patch("app.agents.market_data.fetch_quote_and_history", AsyncMock(return_value=quote)),
        patch("app.agents.market_data.fetch_fundamentals", AsyncMock()) as mock_fundamentals,
        patch("app.agents.context.build_context", AsyncMock()) as mock_context,
        patch("app.agents.news.run_news_agent", AsyncMock(return_value=None)) as mock_news,
    ):
        result = asyncio.run(run_graph_for_ticker("VWCE", "ETF", is_held=True))

    mock_fundamentals.assert_not_called()
    assert result["fundamental_score"] is None
    assert result["action"] == "HOLD"
    mock_context.assert_not_called()
    assert result["context"] is None
    mock_news.assert_not_called()
    assert result["ai_analysis"] is None


def test_run_graph_for_stock_with_no_fundamentals_data_skips_scoring():
    quote = {"price": 100.0, "closes": [100.0] * 220}
    empty_fundamentals = {
        "peg_ratio": None,
        "roe": None,
        "debt_to_equity": None,
        "revenue_growth": None,
        "profit_margin": None,
    }
    with (
        patch("app.agents.market_data.fetch_quote_and_history", AsyncMock(return_value=quote)),
        patch(
            "app.agents.market_data.fetch_fundamentals",
            AsyncMock(return_value=empty_fundamentals),
        ),
        patch("app.agents.context.build_context", AsyncMock()) as mock_context,
        patch("app.agents.news.run_news_agent", AsyncMock(return_value=None)) as mock_news,
    ):
        result = asyncio.run(run_graph_for_ticker("AAPL", "STOCK", is_held=True))

    assert result["fundamental_score"] is None
    assert result["action"] is None
    mock_context.assert_not_called()
    assert result["context"] is None
    mock_news.assert_not_called()
```

- [ ] **Step 2: Run the tests against the current (pre-Task-3) graph to confirm the baseline**

Run: `cd backend && uv run python -m pytest tests/test_agents_graph.py -v`
Expected: FAIL — `KeyError: 'context'` (the field doesn't exist in
`AnalysisState` yet) or similar, since the graph hasn't been changed yet.
This confirms the tests are exercising the not-yet-built behavior.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `backend/app/agents/graph.py`:

```python
import logging
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from app.agents import context, market_data, news
from app.analysis import fundamental, recommend, technical
from app.db import SessionLocal

logger = logging.getLogger(__name__)


class AnalysisState(TypedDict):
    ticker: str
    asset_type: str
    is_held: bool
    quote: dict[str, Any]
    fundamentals: dict[str, Any]
    fundamental_score: int | None
    technical_signal: str
    action: str | None
    suggested_position_pct: float | None
    reasoning: list[str]
    context: str | None
    ai_analysis: str | None


async def fetch_data(state: AnalysisState) -> dict[str, Any]:
    quote = await market_data.fetch_quote_and_history(state["ticker"])
    fundamentals_data: dict[str, Any] = {}
    if state["asset_type"] == "STOCK":
        fundamentals_data = await market_data.fetch_fundamentals(state["ticker"])
    return {"quote": quote, "fundamentals": fundamentals_data}


def fundamental_agent(state: AnalysisState) -> dict[str, Any]:
    if state["asset_type"] != "STOCK":
        return {"fundamental_score": None}
    fundamentals = state["fundamentals"]
    if not fundamentals or all(value is None for value in fundamentals.values()):
        return {"fundamental_score": None}
    score = fundamental.score_fundamentals(fundamentals)
    return {"fundamental_score": score}


def technical_agent(state: AnalysisState) -> dict[str, Any]:
    signal = technical.score_technical(state["quote"]["closes"])
    return {"technical_signal": signal}


def synthesizer(state: AnalysisState) -> dict[str, Any]:
    action, suggested_position_pct, reasoning = recommend.synthesize(
        asset_type=state["asset_type"],
        is_held=state["is_held"],
        fundamental_score=state["fundamental_score"],
        technical_signal=state["technical_signal"],
    )
    return {
        "action": action,
        "suggested_position_pct": suggested_position_pct,
        "reasoning": reasoning,
    }


async def context_agent(state: AnalysisState) -> dict[str, Any]:
    if state["action"] is None or state["action"] == "HOLD":
        return {"context": None}
    db = SessionLocal()
    try:
        built_context = await context.build_context(
            db, state["ticker"], state["asset_type"], state["action"], state["reasoning"]
        )
    except Exception:
        logger.exception("build_context failed for %s", state["ticker"])
        built_context = None
    finally:
        db.close()
    return {"context": built_context}


async def news_agent(state: AnalysisState) -> dict[str, Any]:
    if state["action"] is None or state["action"] == "HOLD":
        return {"ai_analysis": None}
    ai_analysis = await news.run_news_agent(
        state["ticker"], state["action"], state["reasoning"], state["context"]
    )
    return {"ai_analysis": ai_analysis}


def build_graph() -> Any:
    graph = StateGraph(AnalysisState)
    graph.add_node("fetch_data", fetch_data)
    graph.add_node("fundamental_agent", fundamental_agent)
    graph.add_node("technical_agent", technical_agent)
    graph.add_node("synthesizer", synthesizer)
    graph.add_node("context_agent", context_agent)
    graph.add_node("news_agent", news_agent)

    graph.add_edge(START, "fetch_data")
    graph.add_edge("fetch_data", "fundamental_agent")
    graph.add_edge("fetch_data", "technical_agent")
    graph.add_edge("fundamental_agent", "synthesizer")
    graph.add_edge("technical_agent", "synthesizer")
    graph.add_edge("synthesizer", "context_agent")
    graph.add_edge("context_agent", "news_agent")
    graph.add_edge("news_agent", END)

    return graph.compile()


async def run_graph_for_ticker(ticker: str, asset_type: str, is_held: bool) -> AnalysisState:
    app_graph = build_graph()
    initial_state: AnalysisState = {
        "ticker": ticker,
        "asset_type": asset_type,
        "is_held": is_held,
        "quote": {},
        "fundamentals": {},
        "fundamental_score": None,
        "technical_signal": "NEUTRAL",
        "action": None,
        "suggested_position_pct": None,
        "reasoning": [],
        "context": None,
        "ai_analysis": None,
    }
    result: AnalysisState = await app_graph.ainvoke(initial_state)
    return result
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run python -m pytest tests/test_agents_graph.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/agents/graph.py backend/tests/test_agents_graph.py
git commit -m "feat: wire context_agent into the analysis graph, between synthesizer and news_agent"
```

---

## Task 4: Full suite, lint, typecheck, docs

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§6 agent graph description, §15.1)

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && uv run python -m pytest tests/ -v`
Expected: all tests pass, including the new `test_agents_context.py` and
the updated `test_agents_graph.py`/`test_agents_news.py`.

- [ ] **Step 2: Lint and format**

Run: `cd backend && uv run ruff check . && uv run ruff format --check .`
Expected: clean. Fix any findings.

- [ ] **Step 3: Typecheck**

Run: `cd backend && uv run mypy app`
Expected: clean (strict mode).

- [ ] **Step 4: Update ARCHITECTURE.md**

Read §6 (the agent graph description) first — search for "## 6." — and
add `context_agent` to the described node sequence between `synthesizer`
and `news_agent`, matching the existing prose style. In §15.1 step 4,
mark 4c (`build_context()`) as done, and note that step 4 as a whole is
now complete (all three of 4a/4b/4c done).

- [ ] **Step 5: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: mark build_context (4c) and step 4 as done"
```
