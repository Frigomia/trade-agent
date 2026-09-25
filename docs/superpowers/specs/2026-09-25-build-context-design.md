# `build_context()` (4c) — Design Spec

Sub-project 4c of the analysis-agent evolution (ARCHITECTURE.md §15.1
step 4), the last piece of that roadmap item. 4a (chat agent) and 4b
(investment preferences capture) are both merged. This is where they —
plus long-term memory (step 3, merged earlier) — actually reach an
agent's reasoning for the first time.

`agents/graph.py` has never touched the database. `jobs.py` opens a
session only *after* the graph finishes, to persist the resulting
`Recommendation`. This spec is the first time a graph node reads from
Postgres mid-run.

## Scope

In scope:
- `backend/app/agents/context.py` — `build_context(db, ticker,
  asset_type, action, reasoning) -> str`, assembling preferences +
  long-term memory + session memory into one text block.
- A new graph node, `context_agent`, in `agents/graph.py`, between
  `synthesizer` and `news_agent`. `AnalysisState` gains `context: str |
  None`.
- `agents/news.py`'s `run_news_agent` gains an optional `context: str |
  None = None` parameter, included in the Claude prompt when present.

Out of scope:
- Any change to `analysis/recommend.py` or `analysis/technical.py` — the
  deterministic gate logic stays exactly as untouched as 4b left it.
  `context_agent` runs after `synthesizer` has already decided `action`
  and `suggested_position_pct`; nothing it produces can feed back into
  that decision. This is the same boundary 4b drew, extended to graph.py.
- Threading a `Session` through `AnalysisState` or changing
  `run_graph_for_ticker`'s signature. `context_agent` opens and closes
  its own `SessionLocal()`, the same way `market_data.py`/`news.py`
  manage their own external clients. `jobs.py`'s `MAX_CONCURRENT_TICKERS
  = 3` concurrent `asyncio.gather` means a shared session across tickers
  would be unsafe anyway — a self-contained session per node call sidesteps
  that entirely.
- A schema change to add a `ticker` column to `ChatMessage`. Session
  memory is found via a substring match on the existing `content` column.
- Any special "untrusted data" prompt framing for the new context. Unlike
  `news_agent`'s web-search results (external, adversarial-by-default),
  everything `build_context` gathers is the user's own first-party data —
  their own stored preferences, their own past recommendations, their
  own chat messages. Same treatment `chat.py` already gives
  `build_portfolio_context`.
- Frontend work. Nothing here is user-facing beyond `ai_analysis`
  potentially reading slightly differently.

## `backend/app/agents/context.py`

```python
async def build_context(
    db: Session, ticker: str, asset_type: str, action: str, reasoning: list[str]
) -> str:
```

Three sections, joined into one text block (`"\n\n".join(...)`), each
with a `chat.py`-style empty-state fallback rather than an empty string:

**1. Investment preferences.** `db.query(InvestmentPreferences).filter_by(
user_id=settings.default_user_id).one_or_none()`. If found, formats
`risk_tolerance`, `sector_avoid_list`, `notes` (whichever are non-empty).
If no row exists: `"No stated investment preferences."`

**2. Long-term memory.** Builds the same situation-text shape
`routers/memory.py`'s `embed_recommendations` already uses to embed rows
— `f"{ticker} ({asset_type}): {action}. {'; '.join(reasoning)}."` — then:
```python
try:
    embedding = await embed_text(situation)
    similar = find_similar(db, embedding, top_k=3)
except Exception:
    logger.exception("Long-term memory lookup failed for %s", ticker)
    similar = []
```
Caught broadly and logged, not raised — a missing `VOYAGE_API_KEY` (the
common case in dev, per `embed_text`'s existing `RuntimeError`) or a
Voyage API failure must never abort the graph. If `similar` is empty:
`"No similar past recommendations found."` Otherwise, one line per match:
ticker, action, reasoning, and `outcome_forward_return_pct` if it's been
evaluated.

**3. Session memory.** `db.query(ChatMessage).filter(ChatMessage.content.ilike(
f"%{ticker}%")).order_by(ChatMessage.created_at.desc()).limit(5).all()` —
not scoped to `user_id` or any particular `session_id`; this is a
single-user system, so every `ChatMessage` row is "this user's," and the
point is finding any prior conversation that touched this ticker,
regardless of which chat session it happened in. If empty:
`"No relevant chat history."` Otherwise, one line per message: role and
content (truncated to a reasonable length if very long — reuse
`PreferencesIn`'s 2000-char intuition, but this is display truncation,
not a validation cap, so a simple `content[:500]` is enough).

## `agents/graph.py` changes

`AnalysisState` gains one field: `context: str | None`.

New node:
```python
async def context_agent(state: AnalysisState) -> dict[str, Any]:
    if state["action"] is None or state["action"] == "HOLD":
        return {"context": None}
    db = SessionLocal()
    try:
        context = await build_context(
            db, state["ticker"], state["asset_type"], state["action"], state["reasoning"]
        )
    except Exception:
        logger.exception("build_context failed for %s", state["ticker"])
        context = None
    finally:
        db.close()
    return {"context": context}
```

Same skip condition as `news_agent` — action must be decided and
non-`HOLD` before context assembly runs at all, which is also what keeps
`context_agent` from ever being on a path that could influence the
decision it comes after.

Graph edges: `synthesizer -> context_agent -> news_agent -> END`
(replacing the current `synthesizer -> news_agent -> END`).

## `agents/news.py` changes

```python
async def run_news_agent(
    ticker: str, action: str, reasoning: list[str], context: str | None = None
) -> str | None:
```

When `context` is not `None`, it's appended to `user_message` before the
"Search for recent news..." instruction, under its own heading (e.g. `"##
Additional context\n{context}"`). `NEWS_AGENT_SYSTEM_PROMPT` is unchanged
— the existing "quantitative signals are ground truth, this is a
qualitative second opinion only" framing already covers how `context`
should be weighed, same as it covers web search results.

`graph.py`'s `news_agent` node passes `state["context"]` through:
```python
ai_analysis = await news.run_news_agent(
    state["ticker"], state["action"], state["reasoning"], state["context"]
)
```

## Testing

**`agents/context.py`** — mocks `embed_text`, real Postgres via the
`db_session` fixture for the DB queries (same pattern `chat.py`'s tests
use). Cases: preferences present/absent, long-term memory match/no-match/
embed-failure-doesn't-raise, session memory match/no-match, all three
combined.

**`agents/graph.py`'s existing tests must keep working with zero database
dependency** — they currently mock only `market_data` and
`news.run_news_agent`, and never touch Postgres. Adding `context_agent`
means every existing "action decided" test path (e.g.
`test_run_graph_for_stock_produces_buy_recommendation`) must also patch
`app.agents.context.build_context` (an `AsyncMock`), the same way they
already patch `news.run_news_agent`. Without that patch, those tests
would start requiring a real Postgres connection that they don't need
today — this is the one thing to get right, since it's easy to silently
break every existing graph test's no-DB-required property.

One new graph-level test: `context_agent` is skipped on `HOLD`/`None`
action (mirrors the existing `news_agent` skip test), asserting
`build_context` was never called.

**`agents/news.py`** — one new test asserting `context` appears in
`user_message` when provided, and is absent when `context=None` (existing
tests continue to pass with the new parameter defaulting to `None`).
