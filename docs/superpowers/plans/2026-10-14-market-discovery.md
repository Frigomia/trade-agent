# Market discovery: implementation plan and handoff brief

Status: revision 3, 2026-10-18. Incorporates the review decisions on PR #105 (see Section 1.3)
and the discovery foundation already merged into master. Two people execute it in two lanes.
The [Phase 0 design spec](../specs/2026-10-14-market-discovery-design.md) records the selected
defaults and reconciles this original plan with the existing implementation. Use the spec and
`app/schemas_discovery.py` for the current shared contract; the code sketch in Section 4.5 is
historical guidance. No end-to-end discovery scan has shipped yet.

| Phase | Implementation status at the Phase 0 handoff |
| --- | --- |
| 0: spec and contracts | Complete in this handoff: design/defaults, existing tested shared contracts, optional Tavily setting and configuration documentation. |
| 1: analytics and FX | Implemented: existing global FX support plus pure analytics/candidate fit, cached dated histories and profiles, and authenticated `/portfolio/analytics`. See the Phase 1 completion notes below. |
| 2: research | Not implemented; evidence models alone do not perform research. |
| 3: universe | Implemented: 600 symbols, validator, coverage report and candidate-pool audit. The audit limits what the coverage evidence proves. |
| 4: refresh and screening | Implemented: resumable weekly Redis refresh, peers, risk, eligibility and one ranked shortlist for universe and admitted candidates. User scan wiring remains Phases 6 and 7. |
| 5: dynamic admission | Implemented: `app/discovery/admit.py` resolves, validates and caps (10 per scan, 30 looked up) mentions as candidates; the research that produces mentions (Phase 2) is not. |
| 6: evaluation and persistence | Not implemented; idea contracts exist, graph and database changes do not. |
| 7: run and schedule | Partial: weekly snapshots exist; user scan API/jobs, theme discovery and Telegram ideas remain. |
| 8: easy onboarding | Not implemented. |
| 9: frontend | Not implemented for discovery. |
| 10: deferred | Still deferred; separate specs and decisions required. |

I2 passed locally on 2026-10-18 (see Phase 4); I1 and I3 remain outstanding. See the design spec
for freshness, ETF, peer-statistic and ranking decisions that supersede the initial proposals below.

**Audience.** An engineer, and the coding LLM that engineer drives, who knows this repo only from
the code. Everything the work depends on is stated here: the product goal, the hard rules, what
already exists (with file names), the target design, per-phase briefs with acceptance criteria,
and the traps. Where something was *not* verified, it is marked **VERIFY**.

---

## 1. Goal, scope and decisions

### 1.1 Goal

Today the agent analyzes only tickers the user already holds or watches. The change: the agent
**discovers** investment opportunities worldwide. It screens a global universe, lets companies
found through research enter the pipeline, researches a shortlist in depth, and returns a ranked
shortlist, or an explicit "no compelling opportunity". Each idea shows:

- the investment thesis and catalysts
- fundamentals and valuation, compared with economically comparable peers where possible
- risks (size, liquidity, volatility, financial stability), displayed rather than hidden
- fit with the user's portfolio, when holdings exist
- the strongest bear case, and any material negative development
- unverified community discussion, labelled as such
- sources, each with a URL and a date, and the data limitations

The user then approves or dismisses with the existing human-in-the-loop flow.

The goal is **long-term, fundamentals-first research**. It is not a short-term trading system,
and it is not restricted to large, established, low-risk companies. Small caps and
high-growth businesses are in scope.

### 1.2 Non-goals (do not build)

- Any order execution or broker call. This system never places a trade (root `CLAUDE.md`).
- Broker-specific availability checks. Discovery is worldwide and broker-agnostic.
- A second financial data provider (document `yfinance` limitations first; see Phase 3 gate G1).
- New agent frameworks, nested graphs, extra agents, or microservices.
- Strategy statistics, strategy backtesting infrastructure, or parameter tuning (deferred, Phase 10).
- A user-facing strategy or risk-profile configuration system (a future preference, see 1.4).
- Fixed market-cap or liquidity floors for eligibility.
- Any score derived from forum popularity, sentiment, or discussion volume.
- Tax, dividend accounting, or personal P&L features beyond what already exists.

### 1.3 Decisions log (source: PR #105 review and replies)

| # | Decision | Where it lands |
|---|---|---|
| D1 | Global universe from day one: about 600 securities (180 North America, 180 Europe, 150 Asia-Pacific, 60 other emerging markets, 30 global ETFs). Targets, not quotas. | Phase 3 |
| D2 | Companies found through Tavily, industry research or Reddit may enter the pipeline even when outside the universe, if they pass identity, data-quality and currency checks. About 10 per scan initially. | Phase 5 |
| D3 | Fundamentals-first. Price trend, momentum and technical signals are context only, never eligibility. | Phases 4, 6 |
| D4 | Peers: global sector by default, narrowing to industry when at least 8 suitable peers. Sector-specific metric sets (banks, insurers, REITs, utilities). Never invent a score for missing data. | Phase 4 |
| D5 | Qualitative evidence is not converted into a count-based score. Materiality, event clustering, thesis impact. | Phases 2, 6 |
| D6 | Forum content: discovery of hypotheses only. Zero scoring weight. Can never invalidate a thesis alone. | Phases 2, 5, 6 |
| D7 | A verified, thesis-invalidating development removes a candidate from the shortlist. Excluded candidates stay visible with an explanation. Unverified allegations trigger further investigation, not exclusion. | Phase 6 |
| D8 | No market-cap or liquidity floors. Size, liquidity and volatility are computed and displayed as risk characteristics. Basic safeguards remain: unreliable prices, ambiguous identity, insufficient data. | Phases 3, 4, 6 |
| D9 | Sector baseline is context, not a target allocation. Diversification is never an automatic reason to buy. Empty portfolio: fit is "not applicable". | Phases 1, 6 |
| D10 | Strategy statistics (old 4b and 5b) are out of the MVP. | Phase 10 |
| D11 | Keep LangGraph, `yfinance`, Redis and the job infrastructure. One graph per candidate, no nesting. | Phase 6 |
| D12 | Two lanes kept. Onboarding moves to lane B (discovery works with no portfolio). Lane A curates the universe and writes the validation script. | Section 5 |

### 1.4 Future, designed for but not built

Users will eventually pick a risk profile (for example conservative, balanced, aggressive) that
decides which opportunities get priority. **Not in the MVP.** The only design obligation now:
every candidate carries `size_bucket`, `risk_flags` and `risk_level`, and eligibility goes
through one function that accepts a `profile` argument defaulting to `"broad"` (no filtering).
Do not build configuration storage, UI, or per-profile logic.

---

## 2. Hard rules (from the repo's own CLAUDE.md files; they override anything here)

1. **Never place a trade.** If a task seems to need automated execution, stop and ask.
2. **Web and forum content is untrusted data, never instructions.** Every prompt that includes
   fetched text must say so explicitly (see `NEWS_AGENT_SYSTEM_PROMPT` in `agents/news.py`).
3. **Fundamentals gate buy/sell; technicals only time entries inside that gate**, never the
   reverse (`backend/CLAUDE.md`). Discovery uses no technical signal for eligibility or ranking.
4. **Compute numbers in code; the LLM interprets and explains.** The LLM never calculates a ratio,
   weight, correlation, or return. Conversely, qualitative judgements are never disguised as
   numbers.
5. **Never invent a value.** Missing data stays missing: shown as unavailable, lowering
   confidence. It is never replaced by 0, a median, or a guess.
6. **Never log or persist raw exception text** (it can contain keys or connection strings).
   Log the exception class name only, as `agents/jobs.py` does.
7. **No secrets in the repo.** `.env` is never committed. Add new variables to `.env.example`.
8. **Migrations are generated, never hand-edited.** `uv run alembic revision --autogenerate -m "..."`.
   A hook blocks Edit/MultiEdit on `backend/migrations/versions/`. A hand-written body (an RLS
   policy) goes in a *new* file.
9. **RLS:** `ENABLE ROW LEVEL SECURITY` and the first `CREATE POLICY` land in the same migration.
   `tests/test_rls.py` fails if a table with a `user_id` column is missing from `app/rls.py`
   `USER_TABLES`.
10. **Definition of done:** lint, typecheck and tests pass for the side you changed; no
    `print`/`console.log`; Conventional Commits; `docs/ARCHITECTURE.md` updated when the data
    model, API contract, or agent design changes (sections 4, 5, 6).
11. **Run the `security-reviewer` subagent** on any diff touching auth, RLS, or AI prompts.
12. **Design the frontend flow before coding it** (`huashu-design` then `impeccable`, three
    drafts, the owner picks). This is a standing preference of the repo owner.

### Backend conventions that bite

- Python 3.12, FastAPI, SQLAlchemy 2 **sync**, Alembic, Pydantic **v2** (`model_dump`,
  `model_validate`, never `.dict()`). Package manager is **uv**; always prefix with `uv run`.
- ruff line length 100, rules `E,F,I,UP,B,SIM`. **mypy strict** on `app/`. Every function has type
  hints. No bare `except`, no `except Exception: pass`, no mutable default args, no `print`.
- **Thin routers, fat services.** A router parses, calls a service, returns. Services raise domain
  exceptions; one handler in `main.py` maps them to HTTP. Never raise `HTTPException` from a service.
- `def` routes for DB-only work; `async def` where the route awaits. **Never call blocking code
  (`yfinance`, the sync Anthropic client) directly in an `async def`**; wrap it in
  `asyncio.to_thread`, as `agents/market_data.py` does.
- User data sessions come from `Depends(get_user_db)`; background jobs use
  `app.db.scoped_session(user_id)`. Never open a session for user data another way. Every write has
  try/except with an explicit `rollback()`.
- LangGraph nodes return a dict of updates; they never mutate the input state.
- The author is not fluent in Python: prefer explicit, boring code; comment non-obvious idioms.

### Test conventions

- Pure functions (`analysis/*`, `planner.py`): plain unit tests, no mocks. Highest value.
- Mock the Anthropic client and `yfinance` in any test touching `agents/` or `market_data.py`.
  **Never call a real external API in tests**, Tavily included.
- Patch an external call by the name the code under test looks it up by
  (`app.snapshots.fetch_quote_and_history`), not where it is defined.
- Database tests need Docker Postgres (`docker compose up -d`) and the `engine`/`db_session`
  fixtures in `tests/conftest.py`. API tests run as the restricted `trading_agent_app` role with
  real JWTs (`tests/auth_support.py`); never point the `client` fixture at a superuser.
- Redis is real in tests. A test that calls `asyncio.run()` more than once must reset
  `app.redis_client._redis = None` in between.
- Commands (run from `backend/`):

| Task | Command |
|---|---|
| Test all / one | `uv run python -m pytest tests/ -v` / `uv run python -m pytest path::name -v` |
| Lint + format | `uv run ruff check . && uv run ruff format .` |
| Type check | `uv run mypy app` |
| New migration | `uv run alembic revision --autogenerate -m "..."` |
| Scheduled jobs | `uv run python -m app.scheduled daily` (also `snapshots`, `outcomes`) |

Frontend (`frontend/`): Next.js 16 App Router, TypeScript strict, MUI 9, SWR, Vitest. Commands:
`npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`. All backend calls go through
`apiFetch` (`lib/api/client.ts`). No Redux, no Tailwind, no chart library, no Axios. Colours come
from CSS variables and the theme, never hex in a component. Read `DESIGN.md` before building a
screen. There are no Buy/Sell controls; decisions are Approve and Dismiss.

---

## 3. What exists today (map of the code you will touch)

### Data model (`backend/app/models.py`)

| Model | Relevant fields | Notes |
|---|---|---|
| `Holding` | `ticker`, `name`, `asset_type` ("ETF"/"STOCK"), `shares`, **`cost_basis` NOT NULL**, **`first_purchase_date` NOT NULL**, `target_weight`, `sector` (manual free text), `isin` | Per user. No industry, country, or currency columns. |
| `WatchlistItem` | `ticker`, `asset_type`, `note`, `target_weight`, `isin` | |
| `Recommendation` | `ticker`, `asset_type`, `action` String(6) (BUY/ADD/HOLD/TRIM/SELL/WATCH), `reasoning: list[str]` JSON, `ai_analysis` Text, `suggested_position_pct`, `status` String(10) (PENDING/APPROVED/REJECTED/SUPERSEDED), `source` String(10) ("manual"/"scheduled"), `price_at_recommendation`, `fundamental_score`, `technical_signal`, outcome fields, `embedding` Vector(1024) | `source="discovery"` is 9 chars and fits. |
| `InvestmentPreferences` | `risk_tolerance`, `sector_avoid_list` JSON, `notes`, `auto_analysis`, `monthly_contribution`, `drift_threshold_pct` | `sector_avoid_list` is an explicit user preference and is honoured. |
| `BacktestResult` | single-ticker, per-user | Stays as is. |
| `AppSettings` | single global row (id=1) | Pattern for a global (non-user) table, if one is ever needed. |

### Market data (`backend/app/agents/market_data.py`)

All functions are `async`, Redis-cached, and retried via `_retry_fetch` (3 attempts, exponential
backoff). Blocking `yfinance` runs inside `asyncio.to_thread`.

| Function | Returns | Cache |
|---|---|---|
| `fetch_quote_and_history(ticker)` | `{"price": float\|None, "closes": list[float]}` for `period="1y"`. **No dates, no timestamp.** | 300 s |
| `fetch_fundamentals(ticker)` | `peg_ratio, roe, debt_to_equity (÷100), revenue_growth, profit_margin` | 900 s |
| `fetch_price_history(ticker, start, end)` | `list[float]` closes | 86400 s |
| `search_symbols(query)` | `[{symbol, name, type, exchange}]` (stocks and ETFs only, max 8) | 3600 s |
| `fetch_currency(ticker)` | currency code or None | 86400 s |

### FX (`backend/app/fx.py`)

`eur_prices(tickers: set[str]) -> (dict[str, EurPrice], dict[str, str])`: EUR price, source
currency and rate per ticker, plus a `skipped` map ticker → reason. **Supported today:** EUR,
USD, GBP, CHF, JPY, CAD, AUD, SEK, NOK, DKK, PLN, plus pence (GBp/GBX). `RATE_SYMBOLS` maps a
currency to a Yahoo `EUR<ccy>=X` symbol. A global universe needs more (Phase 1).

### Analysis (`backend/app/analysis/`)

- `technical.py`: `score_technical(closes)`. Used by the holdings path; **not used by discovery**.
  Known flaw (checks RSI before trend, so it can return OVERSOLD in a downtrend) is deferred to
  Phase 10 and does not affect discovery.
- `fundamental.py`: `score_fundamentals(metrics) -> int`: absolute, sector-blind thresholds
  (PEG ≤ 1, ROE ≥ 20%, D/E ≤ 0.5 ...). **Leave it alone for the holdings path.** Discovery gets
  its own sector-aware scoring in a new module; do not change this function's behaviour.
- `recommend.py`: `synthesize(...)`. Holdings path only.

### Agent pipeline (`backend/app/agents/`)

- `graph.py`: LangGraph `AnalysisState`. Flow: `fetch_data` → (`fundamental_agent` ∥
  `technical_agent`) → `synthesizer` → `context_agent` → `news_agent`. Invoked once per ticker by
  `run_graph_for_ticker`. **Discovery follows the same shape: its own graph, invoked once per
  candidate from a job.**
- `news.py`: `run_news_agent(...)` calls Claude with the server-side `web_search` tool,
  `max_uses=3`, one markdown blob out.
- `jobs.py`: `create_job`, `run_job`, `get_job_status`. Redis hash `job:{id}` (status, total, done,
  owner), results list `job:{id}:results`, single-flight marker `analysis_active:{user_id}` set with
  `SET NX`. `MAX_CONCURRENT_TICKERS = 3`, `MAX_RUN_TICKERS = 50`. `_save_recommendation` marks the
  ticker's older PENDING rows SUPERSEDED, then inserts. **Copy this job pattern for discovery.**
- `context.py`: `build_context(...)` assembles preferences, similar past recommendations, chat memory.

### API (`backend/app/routers/`)

`portfolio.py`: `GET/PUT/POST/DELETE /portfolio/holdings`, watchlist routes, `/snapshots`, and a
summary route computing P&L (lines ~275-301). `analysis.py`: `POST /analysis/run` (202, depends on
`require_claude_key`, `rate_limiter("analysis_run", limit=5)`,
`check_monthly_usage("analysis_run")`), `GET /analysis/run/{job_id}`, list/approve/reject
recommendations. `preferences.py`, `backtest.py`, `chat.py`, `plans.py`, `market.py`.

### Cross-cutting

- **Claude key:** each user connects their own key. `claude_keys.resolve_client(db, user_id,
  role)` returns the user's Anthropic client; `require_claude_key` is the route dependency.
  `is_key_problem(exc)` and `mark_needs_attention(user_id)` handle a rejected key.
- **Usage limits:** `usage.py`, Redis monthly counters per kind (`"analysis_run"`, `"chat"`),
  `check_monthly_usage(kind)`, `refund_usage(kind, user_id)`. Only two kinds exist and each has a
  limit column on `app_users`; a new kind would need new columns.
- **Rate limit:** `rate_limit.rate_limiter(name, limit=N)` per user per minute.
- **RLS:** `rls.py` holds `USER_TABLES` and `RUNTIME_TABLES`.
- **Scheduled jobs:** `scheduled.py`, commands `daily`, `snapshots`, `outcomes`, plus automatic
  analysis and Telegram notify. Run with `uv run python -m app.scheduled <command>`.
- **Config:** `config.py` `Settings` (pydantic-settings). Add `tavily_api_key: str | None = None`.
- **Where cost_basis is read** (matters for Phase 8): `routers/portfolio.py:275-301`,
  `snapshots.py:39`, `trades.py:34-38`, `agents/chat.py:40`, `plans.py:445` (creates a holding with
  `cost_basis=0`), `schemas.py:44-45`, and the frontend `HoldingForm`, `FirstHolding`,
  `PortfolioChart`, portfolio page.

### Design docs to read first

`docs/ARCHITECTURE.md` (it is under `docs/`, not the repo root; §4 data model, §5 API, §6 agent
graph, §12 scheduled jobs), `DESIGN.md`, `PRODUCT.md`, and the existing specs in
`docs/superpowers/specs/`. Copy the format of `2026-10-08-contribution-planner-design.md` for the
Phase 0 spec.

---

## 4. Target design

```
GLOBAL, weekly batch, user-independent (cached; fundamentals change quarterly)
  universe file (~600) ─► fetch market data + fundamentals (coverage recorded per symbol)
    ─► per-sector (and per-industry when >= 8 peers) peer statistics
    ─► cached as universe snapshot

GLOBAL, daily, user-independent
  theme research + Reddit discovery (Tavily + one LLM extraction)
    ─► Mention(name, ticker/exchange hint, origin, reason)  [zero scoring weight]

PER USER SCAN (on demand or scheduled; uses the user's Claude key)
  candidates = universe snapshot  +  admitted dynamic mentions (cap ~10, Phase 5)
  − already held − user's sector_avoid_list − failed safeguards
  → rank by fundamentals (quality, valuation vs peers) → shortlist N (default 8)
  per candidate, one LangGraph run, branches in parallel:
      quant: metrics, peer comparison, risk profile, portfolio fit
      research: news/catalysts · bull · bear · competitors · forums (Tavily)
    → extract evidence (claims, events, materiality)
    → thesis_check ── confirmed invalidating? ──► EXCLUDED (kept, with explanation)
                      unverified/disputed?      ──► one more targeted search, re-check
    → evaluate (deterministic scores) → synthesize (LLM prose from the numbers)
  rank → ideas; or "no compelling opportunity"; excluded and rejected items stay visible
```

**Cost control is the central idea.** The universe snapshot and the theme/Reddit discovery are
shared across all users. The LLM and per-candidate Tavily calls run only on the shortlist, only
for the user who asked, and each scan counts against that user's monthly quota.

### 4.1 Eligibility and safeguards (D3, D8)

A security is **eligible for research** when all four hold:

1. Its identifier resolves unambiguously (ticker, exchange and company identity agree).
2. Sufficient market data exists (a finite positive price, recent enough, with history).
3. Its listing and quote currency can be handled correctly (`fx.py` supports it).
4. It can be evaluated from available information: at least `MIN_CORE_METRICS` core fundamentals
   (proposed default 3). Below that the candidate is reported as "insufficient data for meaningful
   analysis", not ranked and not scored.

There is **no** market-cap, liquidity, or broker-availability gate. Missing *some* metrics never
excludes a company: it lowers confidence and is stated in `data_notes`.

**Safeguards that do exclude (with a recorded reason):** unreliable price (missing, non-positive,
non-finite, or last bar older than `STALE_DAYS`, proposed 5 calendar days), ambiguous identity,
unsupported currency, insufficient data as defined above.

### 4.2 Risk characteristics (displayed, not gated)

Computed when data exists, otherwise `None` and noted:

- `market_cap_eur`, `avg_daily_value_eur` (average volume × price, via FX), `size_bucket`
  (`micro|small|mid|large`).
- `volatility_annualized`, `max_drawdown_1y`.
- Financial stability flags from fundamentals: leverage, negative free cash flow, negative equity,
  shrinking revenue.
- `risk_flags: list[str]` such as `thin_liquidity`, `small_cap`, `high_leverage`,
  `negative_fcf`, `high_volatility`, each with its numbers.
- `risk_level: low | medium | high | unknown`, derived by a deterministic rule from the flags.

Bucket and flag cut-offs (for example micro below about €300M, small below about €2B, thin
liquidity below about €1M per day) are named constants used **for labels only**, never for
eligibility. They are proposed defaults to confirm.

In the MVP `risk_level` is shown and does not reduce the ranking score. A future risk profile
(1.4) will filter or prioritise on it.

### 4.3 Peer comparison and scoring (D4)

- **Peer group:** the candidate's industry if at least `MIN_PEERS` (proposed 8) *suitable* peers
  exist in the universe snapshot, otherwise its global sector if at least `MIN_PEERS`, otherwise
  none. A peer is suitable when it shares the sector's metric set and has the metric in question.
  Counting is per metric. Region is **not** a peer dimension (valuation regimes differ by country;
  mention it in `data_notes` when relevant).
- **Sector-specific metric sets** (proposed; **VERIFY** field availability in `yfinance`):

| Group | Quality metrics | Valuation metrics | Not used |
|---|---|---|---|
| General (non-financial) | ROE, operating/profit margin, revenue growth, leverage, free-cash-flow margin | P/E, EV/EBITDA, PEG, P/S | none |
| Banks | ROE, ROA | P/B, P/E, dividend yield | D/E, EV/EBITDA |
| Insurers | ROE | P/B, P/E, dividend yield | D/E, EV/EBITDA |
| REITs | leverage, payout ratio | P/B, dividend yield (FFO is not in `yfinance`: state this) | P/E |
| Utilities | ROE, payout ratio, interest coverage if available | P/E, EV/EBITDA, dividend yield | D/E compared with non-utilities |

- **No forced percentiles.** Show the candidate's value against the peer median and the
  interquartile range, plus a coarse position (`below|within|above` peer range). A composite 0-100
  score is produced only from metrics that have a valid peer comparison, and only when there are
  at least 2 such metrics in the dimension. Otherwise the dimension is `None`: "peer comparison
  unavailable", with raw metrics shown.
- **Outliers and negatives:** negative earnings make P/E undefined (treat as unavailable, not
  zero). Winsorize peer statistics so one outlier does not move the median.
- **Dynamic entrants** are compared against the cached snapshot distribution and are not added to it.

### 4.4 Ranking and confidence

- Numeric dimensions: `quality`, `valuation` (each `int | None`), plus `fit` (`None` when there are
  no holdings or too few to compare).
- `overall` is the equal-weight mean of the available `quality` and `valuation` values; `None` if
  neither exists. Weights are named constants.
- **Rank** by `overall` descending. Ties break by lower `risk_level`, then by better `fit` when a
  portfolio exists. *(This is a proposed design choice to confirm: it keeps diversification from
  lifting a weak candidate, per D9.)*
- **Qualitative assessment is not a number** (D5): `outlook` is structured text plus
  `thesis_impact` and the list of material events. It never changes the numeric rank. A confirmed
  invalidating event excludes the candidate (D7); anything weaker lowers confidence and is shown.
- **Confidence** (`high|medium|low`) is a deterministic function of metric coverage, availability
  of peer comparison, data staleness, and unresolved conflicts or disputed material claims.
- "No compelling opportunity": no candidate reaches `NO_OPPORTUNITY_MIN_OVERALL` (proposed 60) with
  confidence at least `medium`. This is a first-class stored result with nearest misses.

### 4.5 Shared contracts (Phase 0 commits these; each lane codes against fixtures until the other lands)

```python
# app/schemas_discovery.py  (a new module; do not grow schemas.py further)
from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel, Field

# ---- portfolio (lane A) -------------------------------------------------------------------
class Exposure(BaseModel):
    label: str                      # "Technology", "USD", "Japan", "Unclassified"
    weight: float                   # 0..1 of total EUR value

class PositionValue(BaseModel):
    ticker: str
    name: str
    value_eur: float
    weight: float                   # 0..1
    currency: str
    price: float
    price_as_of: datetime | None
    stale: bool

class PortfolioExposure(BaseModel):
    as_of: datetime
    total_value_eur: float | None   # None: no holdings
    positions: list[PositionValue]
    by_sector: list[Exposure]
    by_industry: list[Exposure]
    by_country: list[Exposure]
    by_currency: list[Exposure]
    top_position_weight: float | None
    hhi: float | None
    effective_n: float | None
    volatility_annualized: float | None
    correlation: dict[str, dict[str, float]]
    skipped: dict[str, str]         # ticker -> reason
    notes: list[str]                # Phase 1: partial valuation, FX/history limits and ETF proxies

class CandidateFit(BaseModel):
    ticker: str
    applicable: bool                # False: no holdings or too few to compare
    avg_correlation_to_portfolio: float | None
    portfolio_vol_before: float | None
    portfolio_vol_after: float | None
    hhi_before: float | None
    hhi_after: float | None
    sector_weight_before: float | None
    sector_weight_after: float | None
    hypothetical_weight: float      # default 0.05
    notes: list[str]

# ---- universe and candidates (lane A) -------------------------------------------------------
class Coverage(BaseModel):
    core_metrics_present: int
    core_metrics_total: int
    missing: list[str]

class PeerComparison(BaseModel):
    metric: str
    value: float | None
    peer_group: Literal["industry", "sector", "none"]
    peer_count: int
    peer_median: float | None
    peer_p25: float | None
    peer_p75: float | None
    position: Literal["below", "within", "above", "unavailable"]

class RiskProfile(BaseModel):
    market_cap_eur: float | None
    avg_daily_value_eur: float | None
    size_bucket: Literal["micro", "small", "mid", "large", "unknown"]
    volatility_annualized: float | None
    max_drawdown_1y: float | None
    risk_flags: list[str]
    risk_level: Literal["low", "medium", "high", "unknown"]

class CandidateMetrics(BaseModel):
    ticker: str
    name: str
    asset_type: Literal["STOCK", "ETF"]
    exchange: str | None
    country: str | None
    sector: str | None
    industry: str | None
    currency: str | None
    price: float | None
    price_as_of: datetime | None
    fundamentals: dict[str, float | None]
    coverage: Coverage
    peers: list[PeerComparison]
    risk: RiskProfile
    origin: Literal["universe", "tavily", "reddit", "industry_research"]
    origin_note: str | None         # untrusted web text: zero scoring weight, prompt only in an untrusted block
    data_notes: list[str]           # what the reader should know: uncertain price date, unscored dimension

class Mention(BaseModel):            # produced by lane B discovery, consumed by lane A admission
    name: str
    ticker_hint: str | None
    exchange_hint: str | None
    origin: Literal["tavily", "reddit", "industry_research"]
    reason: str
    url: str | None

class RejectedMention(BaseModel):
    mention: Mention
    reason: Literal["ambiguous", "unresolved", "no_price", "currency_unsupported",
                    "insufficient_data", "cap_reached", "duplicate"]

# ---- research (lane B) ------------------------------------------------------------------
class Claim(BaseModel):
    text: str
    kind: Literal["fact", "opinion", "forecast", "forum"]
    stance: Literal["bull", "bear", "neutral"]
    materiality: Literal["high", "medium", "low"]
    source_tier: Literal["official", "reliable_reporting", "other", "forum"]
    event_id: str                   # claims about the same underlying event share an id
    url: str
    published_at: date | None

class NegativeDevelopment(BaseModel):
    summary: str                    # what happened
    occurred_on: date | None        # and when
    evidence: list[str]             # claim urls
    thesis_impact: str              # how it affects the thesis
    status: Literal["confirmed", "disputed", "unverified"]
    invalidates_thesis: bool

class ResearchEvidence(BaseModel):
    ticker: str
    claims: list[Claim]
    negative_developments: list[NegativeDevelopment]
    competitors: list[str]
    mentions: list[Mention]         # other companies discussed; feeds discovery only
    conflicts: list[str]
    gaps: list[str]

class Exclusion(BaseModel):
    ticker: str
    name: str
    reason: Literal["thesis_invalidated", "unreliable_price", "ambiguous_identity",
                    "currency_unsupported", "insufficient_data"]
    explanation: str
    evidence: list[str]             # urls, for thesis_invalidated

class DimensionScore(BaseModel):
    name: Literal["quality", "valuation", "fit"]
    score: int | None = Field(ge=0, le=100)   # None = unavailable; never a default
    reasons: list[str]              # derived from numbers, not from the LLM

class IdeaOut(BaseModel):
    ticker: str
    name: str
    asset_type: Literal["STOCK", "ETF"]
    origin: Literal["universe", "tavily", "reddit", "industry_research"]
    scores: list[DimensionScore]
    overall: int | None
    confidence: Literal["high", "medium", "low"]
    style_tags: list[str]           # derived from fundamentals: quality, value, growth, income, defensive
    risk: RiskProfile
    peers: list[PeerComparison]
    thesis: str                     # LLM
    catalysts: list[str]            # LLM, each tied to a Claim url
    outlook: str                    # LLM, qualitative; not a score
    bear_case: str                  # LLM
    negative_developments: list[NegativeDevelopment]
    fit_summary: str | None         # LLM, from CandidateFit numbers; None when not applicable
    community_note: str | None      # LLM, explicitly "unverified"
    conclusion: str                 # LLM
    sources: list[Claim]
    data_notes: list[str]           # stale prices, missing metrics, unavailable peers, conflicts
```

Persist an `IdeaOut` as one JSON column (`Recommendation.idea`), not many columns.

---

## 5. Lanes and phases

### Split

| | **Lane A: data and quant** | **Lane B: research and output** |
|---|---|---|
| Phases | 1, 3, 4, 5 | 2, 6, 7, 8 |
| Backend files owned | `analysis/portfolio.py`, `fx.py`, `discovery/` (new: universe, snapshot, peers, admit), `agents/market_data.py` | `agents/research.py` (new), `agents/discovery_graph.py` (new), `analysis/discovery_score.py` (new), `Recommendation`, `ScanRun`, `scheduled.py`, prompts, onboarding changes (`Holding`, schemas, portfolio router) |
| Frontend | Portfolio analytics view | Idea feed (Today), idea detail, scan results (excluded and rejected), onboarding forms, Preferences |

Both: Phase 0, Phase 9 (frontend integration), checkpoints I1 to I3.

Sizes: S under a day, M one to three days, L three to five.

### Phase map and the old numbering

| New | Phase | Owner | Size | Was (revision 1) |
|---|---|---|---|---|
| 0 | Spec and contracts | Both | S | 0 |
| 1 | Portfolio analytics and FX coverage | A | M | 1 (+ new FX work) |
| 2 | Research module | B | L | 3 |
| 3 | Universe curation and validation script | A | L | part of 4 |
| 4 | Global data refresh, peer scoring, shortlist | A | L | part of 4 |
| 5 | Dynamic candidate admission | A | M | new |
| 6 | Evaluation graph: thesis check, scoring, synthesis, output | B | L | 5 |
| 7 | Run and schedule | B | M | 6 |
| 8 | Easy onboarding | B | M | 2 |
| 9 | Frontend | A and B | L | 7 |
| 10 | Deferred: strategy stats, provider, risk profiles, technical fixes | n/a | n/a | 4b, 5b, 8 |

### Dependencies

```
Phase 0 (both)
  ├─ A: 1 ────────┐
  │     3 ──► 4 ──┼──► 5 ─────────┐
  └─ B: 2 ────────┘               ▼
                          6 ──► 7 ──► 9 ──► 10
                          8 (any time after 2; not on the critical path)
```

Phases 1, 2 and 3 are parallel after Phase 0. **Phase 3 is on the critical path**, so lane A
should start it immediately and run Phase 1 beside it, or hand Phase 1's FX piece to start first
(Phase 4 needs the FX coverage).

### Gates and checkpoints

- **G1 (end of Phase 3): data coverage gate.** The validation script writes a coverage report
  (below). If `yfinance` coverage is inadequate for important markets, **document the limitations
  in the spec before anyone proposes another provider.** A provider decision needs that document.
- **I1** (after 1 and 2): run both on three real tickers end to end. Check currency, stale flags.
- **I2** (after 4 and 5): completed locally on 2026-10-18; the 600-symbol snapshot plus three
  real admissions produced a combined shortlist. Runtime and limits are recorded under Phase 4.
- **I3** (after 7): full scan on a real account and on an empty account.

### Migration order (never two open migration branches)

1. B, Phase 6: `Recommendation.idea`, `ScanRun` (the first schema change).
2. B, Phase 8: `Holding` columns nullable.

Lane A needs no migration in the MVP (the universe is a committed file and the snapshot lives in
Redis). Rebase onto `master` before running `alembic revision`. If heads diverge,
`uv run alembic heads` then `alembic merge`.

---

## 6. Phase briefs

Each brief states what to build, where, the exact interfaces, acceptance criteria, tests, and
pitfalls. Branch per phase: `feature/<phase>-<name>`.

### Phase 0: Spec and contracts (both, S)

- [x] Shared contracts already committed in `app/schemas_discovery.py`, with fixtures and tests
  in `tests/discovery_fixtures.py` and `tests/test_schemas_discovery.py`. Preserve their stricter
  validation, nullable correlations, listing country and required `data_notes`.
- [x] Write `docs/superpowers/specs/2026-10-14-market-discovery-design.md` from this plan,
  separating implemented foundations from future workflows.
- [x] Add optional `tavily_api_key` to `config.py` and `TAVILY_API_KEY=` to `.env.example` (no
  value), with backend-only ownership, secret repr protection and §11 documentation. No request
  or SDK is introduced.
- [x] Record selected defaults: `MIN_PEERS=8`, `MIN_CORE_METRICS=3`, `MIN_SCORED=2`,
  `DISCOVERY_MAX_DYNAMIC=10`, shortlist size 8, `NO_OPPORTUNITY_MIN_OVERALL=60`, display-only
  risk labels, equal-weight quality/valuation and risk/fit/ticker tie-breaks. One scan counts as
  one existing `analysis_run` unit. Adopt the implemented exchange-aware freshness rules, with
  5 days only as the sparse-exchange fallback, instead of reinstating blanket `STALE_DAYS=5`.
- [x] Record implemented ETF exclusions and percentile-based peer statistics explicitly, rather
  than silently changing scoring while documenting it. ETF discovery needs its own criteria.

Validation for this handoff: contract/configuration tests, full backend tests with real local
Postgres and Redis, lint, formatting and strict type checking. Real-provider checkpoints remain
the responsibility of their later implementing phases.

### Phase 1: Portfolio analytics and FX coverage (A, M)

**Completed in the Phase 1 PR (2026-10-18).** `analysis/portfolio.py` contains pure valuation,
exposure, concentration, volatility/correlation and `marginal_effect` functions;
`portfolio_analytics.py` loads scoped holdings and bounded market data; `/portfolio/analytics`
returns the shared contract. Global FX conversions/subunits were already implemented and retain
their per-currency tests. No new FX symbols or credentials are needed.

Implementation details that make the original interface sketch concrete:

- `PortfolioExposure.notes` is a required additive disclosure field, with producer and fixture
  updates. `fetch_profile` is read-only metadata needed for exposures; auto-fill remains Phase 8.
- Valuation uses dated closes with the existing helper's conversion rates, so the displayed
  timestamp belongs to the actual valued close. Without history, keep the EUR quote and mark
  its timestamp unknown/stale. Unpriced positions are skipped explicitly.
- Returns are keyed by `(start_date, end_date)` to avoid comparing different intervals around
  exchange holidays. At least 60 matching return intervals (61 matching closes) are needed.
  Whole-portfolio risk requires all valued holdings on a common sample; do not silently drop
  weights when history is missing. Country exposure uses profile domicile with no ETF look-through.
- `marginal_effect` additionally takes keyword-only `ticker` and `portfolio_returns`: a public
  exposure summary alone cannot reconstruct covariance with the candidate. Both return inputs
  come from the pure `log_returns` helper. Before/after volatility uses identical observations.
  Identical equal-volatility candidate returns do not create a diversification benefit; perfect
  correlation alone does not imply equal volatility.
- PR review follow-up: offload pure analytics from the async route and compute the symmetric
  correlation matrix once per pair. Successful dated histories cache for 5 minutes (their last
  bar can be an in-progress intraday valuation); profile metadata caches for 24 hours;
  empty results and exhausted failures cache for 5 minutes. Bound profile strings at 100
  characters, disclose all-null profiles, normalize sector labels/aliases and treat provider
  labels/notes as untrusted in future prompts. Whole-portfolio risk remains unavailable when a
  valued holding lacks history; the API does not substitute an unlabeled partial-risk estimate.

Validation: synthetic math/interval/empty/partial-data tests, mocked provider cache/retry tests,
authenticated API tests with real local Postgres/RLS and Redis (including no-store and rate
limits), existing global FX tests, backend lint/format/type checks and the full backend suite.
The live I1 checkpoint requires Phase 2 research and remains outstanding.

**Goal:** deterministic portfolio math from holdings plus history, and currency support for a
global universe.

**1a. FX coverage.** Extend `RATE_SYMBOLS` in `fx.py` so the universe's quote currencies resolve.
Minimum additions to consider: HKD, CNY, INR, KRW, TWD, SGD, BRL, MXN, ZAR, NZD, plus whatever the
universe file needs (Phase 3 produces the list). Add subunit handling where Yahoo quotes in
minor units (for example ZAc for South African cents, ILA for Israeli agorot): **VERIFY** each
against `yfinance` output. Keep `MIN_RATE`/`MAX_RATE` bounds valid for the new currencies.

**1b. Analytics.** Create `backend/app/analysis/portfolio.py` (pure functions, no I/O) and one
endpoint `GET /portfolio/analytics` returning `PortfolioExposure`. The router stays thin.

New data access in `market_data.py` (same cache/retry pattern):
`fetch_dated_closes(ticker, period="1y") -> dict[str, float]` mapping ISO date → close. The
existing `fetch_quote_and_history` has no dates, so correlation cannot align series from it.

- Position value in EUR via `fx.eur_prices` × shares; weights = value / total.
- Exposures by sector, industry, country, currency. Unknown → `"Unclassified"`; never drop value.
- Concentration: `top_position_weight`, `hhi = Σ w²`, `effective_n = 1/hhi`.
- Volatility: annualized std of daily log returns × √252 per holding, and portfolio volatility
  `√(wᵀ Σ w)` from the covariance of aligned returns and EUR weights.
- Correlation: pairwise on the inner join of dates; at least 60 overlapping days, else `None`.
  Different exchange calendars mean fewer overlapping days: this is why the minimum is on the
  overlap, not on series length.
- `marginal_effect(exposure, candidate_returns, candidate_sector, hypothetical_weight=0.05) ->
  CandidateFit`: portfolio vol and HHI with and without the candidate, the candidate's average
  correlation to holdings, and the sector weight before and after.
- **No holdings, or fewer than 2 with usable history:** return `applicable=False` and note why.
  There is **no baseline allocation table and no target weights** (D9). Never raise on empty input.

**Acceptance:** weights sum to 1 within 1e-9; a holding with an unresolved price or currency
appears in `skipped` with a reason and does not break the rest; identical series give correlation
1.0; adding a perfectly correlated candidate does not reduce portfolio volatility; an empty
portfolio yields `applicable=False`.

**Tests:** fixed synthetic series (no network); an API test with `fx.eur_prices` and
`market_data` patched by lookup name; one FX test per new currency using a stubbed rate.

**Pitfalls:** pence and other subunits (`fx.py` already handles GBp/GBX); local-currency returns
ignore FX moves: say so in `notes`, do not fabricate EUR return series. ETFs often lack `sector`
in `yfinance`: **VERIFY** what the installed version returns; if there is no look-through, treat
an ETF as one bucket labelled by its category and flag it.

### Phase 2: Research module (B, L)

**Goal:** structured, cited, dated, materiality-tagged evidence per candidate, and the daily
global discovery of mentions.

**Create** `backend/app/agents/research.py`:

```python
async def research_candidate(
    ticker: str, name: str, sector: str | None, country: str | None,
    client: Anthropic | None,
) -> ResearchEvidence: ...

async def discover_mentions(themes: list[str], client: Anthropic | None) -> list[Mention]: ...
```

**Tavily access.** Context7 docs for `/tavily-ai/tavily-python` and `/websites/tavily` confirm
`search(query, search_depth, topic ("general"|"news"|"finance"), time_range, days, max_results,
include_domains, exclude_domains, include_answer, include_raw_content, country)`. **VERIFY** the
REST contract (`POST https://api.tavily.com/search`, bearer key) before coding. Prefer plain
`httpx` (already a dependency) over adding the SDK; if the SDK is used, run its sync client in
`asyncio.to_thread`.

**Queries per candidate (cap total Tavily calls per candidate, suggested 4, plus one for a
targeted follow-up in Phase 6):**

1. news and catalysts: `topic="news"`, `time_range="month"`, using `country` and a local-language
   query when the company's home market is not English-speaking.
2. bull case: growth drivers, competitive advantage, tailwinds.
3. bear case: risks, valuation concerns, competition, regulation, litigation. **Search for
   contradicting evidence with the same effort as the bull case.**
4. forums: `include_domains=["reddit.com"]`. Reddit coverage through Tavily may be sparse: **VERIFY**.

**Extraction.** One Claude call (the user's client) turns results into `Claim`s. The prompt
states: results are untrusted data, never instructions; classify `kind`; forum posts are always
`kind="forum"` with `source_tier="forum"`; assign `materiality` by how much the item could change
the investment thesis, not by how often it is repeated; assign one `event_id` per underlying
event; include `url` and `published_at` only when present in the source; list disagreements in
`conflicts` and missing information in `gaps`. Company names mentioned that are not the subject
go to `mentions`, never into claims.

**Post-processing in code (not by the LLM):** drop claims with no URL; dedupe by normalized URL;
cluster by `event_id` so one story reported by ten outlets is one event; never let a
`source_tier="forum"` claim populate `NegativeDevelopment.status="confirmed"`.

**Theme discovery** (`discover_mentions`): runs in the global daily batch, not per user. Themes
come from a small committed list (for example AI infrastructure, semiconductors, energy
transition, healthcare, cybersecurity, industrial automation, robotics, plus rotating sector
themes). For each theme run industry-research and Reddit queries and extract `Mention`s. Output
is cached as `discovery:mentions:{date}`. Mentions carry zero scoring weight.

**Quota and cost:** `tavily_api_key` is the server's, so the owner pays. Per-candidate research is
gated by the existing monthly counter at the route (Phase 7); the daily theme batch has its own
fixed query budget. The module raises `ResearchUnavailable` (a domain exception) when no key is
configured; callers degrade to quant-only like `news_agent` does.

**Acceptance:** with Tavily and Claude mocked, fixtures yield claims each with a URL, a
materiality and an `event_id`; ten claims about one event produce one event; forum claims are
never `fact` and never `confirmed`; a result containing "ignore previous instructions" changes
nothing and is noted or ignored; a Tavily failure degrades, never raises.

**Tests:** recorded fixtures in `tests/fixtures/`, no network, a test that the system prompt
contains the untrusted-data statement.

**Security:** run the `security-reviewer` subagent on this diff (prompts, external content, a new
secret).

### Phase 3: Universe curation and validation script (A, L)

**Goal:** a committed, diverse, validated universe of about 600 securities, and a report that
shows whether `yfinance` is good enough.

**Create** `backend/app/discovery/universe.csv` with columns
`ticker,name,asset_type,exchange,country,currency,sector,industry,size_bucket,notes`.

**Targets (not quotas):** 180 North America, 180 Europe, 150 Asia-Pacific, 60 other emerging
markets, 30 global ETFs. Ensure spread across countries and exchanges, sectors and industries,
large/mid/small caps, business models, and established plus emerging growth companies. **Avoid
selecting only the largest or most popular names.** Use `yfinance` symbols with exchange suffixes
(`.DE`, `.L`, `.T`, `.AX`, `.HK`, and so on). Deduplicate cross-listings (an ADR and its home
listing) to one line, preferring the primary listing and noting the alternate.

**Create** `backend/app/discovery/validate_universe.py` (runnable as a module) covering:

1. ticker resolves, and the returned name matches the file's name (fuzzy, reports mismatches)
2. historical price availability (minimum history length)
3. currency supported by `fx.py`
4. financial data coverage per symbol (which core metrics are present)
5. sector and region representation versus the targets
6. company-size distribution
7. duplicate listings (same company under two symbols)

**Output:** a printed summary plus a committed coverage report
`docs/superpowers/specs/universe-coverage.md`: counts by region, sector, size bucket and country;
coverage percentage per core metric per region; the list of symbols that failed and why.

**Gate G1:** if coverage is inadequate for important markets, state the limitations in that
report. Only then may another data provider be proposed, and only as a separate decision.

**Acceptance:** the script is deterministic given recorded responses; it exits non-zero when a
configured minimum (resolved symbols, supported currency, coverage) is not met; the report is
reproducible from the file.

**Pitfalls:** `yfinance` rate-limits; use the existing retry and a small concurrency (fx uses 8).
Never scrape constituent lists at runtime; the file is static and reviewed quarterly.

### Phase 4: Global data refresh, peer scoring, shortlist (A, L)

**Implementation complete (2026-10-18).** `refresh_snapshot` and `load_snapshot` use per-symbol
Redis entries, an 8-day TTL and a 24-hour resume window; failed refreshes preserve older entries.
The weekly GitHub schedule invokes `discovery_snapshot` and observes its machine exit status.
Inclusive peer quartiles and the existing score scale follow the selected defaults in the
design spec, superseding the original winsorization proposal below.

`shortlist_for_user(..., mentions_admitted=admitted)` ranks the Phase 5 output alongside the
universe, with one shared size limit and the same holdings/sector preferences. Pass candidates
admitted against this snapshot and current holdings. Their peers are retained rather than
recomputed with entrants in the population. Duplicate universe/admitted symbols appear once;
provenance has no ranking weight. Unscorable candidates remain explained exclusions. Both
sources carry the fiscal-period/accounting-standard disclosure through `data_notes`.
The existing pure-function interfaces intentionally replace the original sketch below; no new
endpoint, user scan orchestration or schema migration is part of this phase.

**I2 live validation (2026-10-18, local Windows machine).** Yahoo provided all 600 universe
symbols in 155.546 seconds with zero failures. All 600 records loaded from isolated local Redis
database 15. A second refresh took 0.485 seconds, reused all 600 and made zero symbol fetches.
Exchange-aware freshness found zero stale and zero uncertain prices; every quote currency had
an EUR conversion rate. The universe shortlist took 3.406 seconds and returned eight candidates;
39 symbols were excluded as `insufficient_data` (including the ETFs).

Three manually selected, non-universe names (Duolingo/DUOL, Datadog/DDOG, AppLovin/APP) passed
real Yahoo search, identity/data validation and admission in 2.078 seconds. Combined screening
took 5.938 seconds, kept the eight-place limit and preserved universe peer comparisons.
None of these three displaced a top-eight universe candidate. Total runtime, including FX,
was 169.766 seconds. The check used `refresh_snapshot`, `load_snapshot`, `check_freshness`,
`fx.eur_rate`, `admit_mentions` and `shortlist_for_user` directly; it made no Tavily/Claude calls
and wrote no production data. These are one machine's observed timings, not a throughput promise.
The temporary test harness selected the mentions manually; research generation remains Phase 2.

**Goal:** a cached weekly snapshot with peer statistics, and a per-user shortlist, all
fundamentals-first.

**Create** `backend/app/discovery/`:

- `snapshot.py`: `async def build_universe_snapshot() -> UniverseSnapshot`. For every universe
  symbol fetch fundamentals and market data (extend `fetch_fundamentals` with free cash flow,
  EV/EBITDA, P/B, P/S, operating margin, dividend yield, payout ratio, market cap, average volume,
  `financialCurrency`, `quoteType`: **VERIFY** each key in the installed `yfinance`). Record
  `Coverage` per symbol. Convert market cap and traded value to EUR through `fx.py`. Cache as
  `discovery:snapshot:{YYYY-MM-DD}`, TTL about 8 days; the refresh is a scheduled weekly command.
- `peers.py`: pure functions implementing 4.3: peer group selection with `MIN_PEERS`, per-metric
  counts, median and quartiles with winsorizing, `PeerComparison` output, sector-specific metric
  sets as a constant table.
- `risk.py`: pure function building `RiskProfile` per 4.2.
- `screen.py`: `shortlist_for_user(snapshot, mentions_admitted, holdings, preferences) ->
  list[CandidateMetrics]`: drop held tickers and `sector_avoid_list`, apply the 4.1 safeguards,
  rank by fundamentals (quality and valuation from peer comparison), take the top N. **Price
  history is used only to compute the risk profile; it never ranks or excludes (D3).**
- `eligibility.py`: the single function `is_eligible(candidate, profile="broad") -> (bool, reason)`
  that implements 4.1; `profile` exists for the future and has no effect now (1.4).

**Rule:** `risk_level` and `size_bucket` do not filter candidates or change numeric scores.
`risk_level` breaks equal-score ties per Section 4.4; size has no independent ranking weight.

**Acceptance:** the snapshot is deterministic for fixed inputs; a symbol with missing data is
recorded with its coverage and excluded only per 4.1, never scored as zero; with fewer than
`MIN_PEERS` suitable peers `peers` has `position="unavailable"` and the dimension score is `None`;
banks are not penalized on D/E; a second call the same day hits the cache (assert no new
`yfinance` calls); an empty universe returns an empty list, not an exception.

**Pitfalls:** NaN rows (reuse `_finite`); `debt_to_equity` is already divided by 100 in the
existing fetch, keep one convention; fiscal years and accounting standards differ across markets,
so state this in `data_notes` instead of normalizing silently.

### Phase 5: Dynamic candidate admission (A, M)

**Goal:** let a company found by research enter the pipeline safely (D2, D6).

**Create** `backend/app/discovery/admit.py`:

```python
async def admit_mentions(
    mentions: list[Mention], known: set[str], limit: int = 10
) -> tuple[list[CandidateMetrics], list[RejectedMention]]: ...
```

Per mention, in order:

1. Resolve through `search_symbols` using the name and any ticker/exchange hint. Accept only when
   exactly one result matches by company name similarity and (when a hint exists) exchange.
   **Reject ambiguous matches; never guess.**
2. Validate identity: returned name, quote type (equity or ETF), exchange consistent with the hint.
3. Safeguards from 4.1: finite recent price with history, supported currency, at least
   `MIN_CORE_METRICS` core fundamentals.
4. Drop duplicates of universe symbols, holdings, or already-admitted mentions.
5. Stop at `limit` (`DISCOVERY_MAX_DYNAMIC`); record the rest as `cap_reached`.

The admitted candidate has `origin` set and `origin_note` holding the reason it was found. **The
origin has zero scoring weight**: nothing in `discovery_score.py` may read `origin`. Rejected
mentions are returned so the scan can list them.

**Security:** an LLM-extracted name from a web page is an injection and manipulation vector.
Resolution, validation and the cap are the defence, and admitted names still pass the whole
evaluation. Run the `security-reviewer` subagent.

**Acceptance:** an ambiguous name ("Orange") is rejected, not guessed; a mention that resolves
twice is rejected; more than `limit` valid mentions admits exactly `limit`; a rejected mention
carries a reason; a mention matching a universe symbol is a `duplicate`, not a second candidate.

### Phase 6: Evaluation graph, thesis check, scoring, output (B, L)

**Goal:** one LangGraph run per candidate producing an `IdeaOut` or an `Exclusion`.

**Create** `backend/app/agents/discovery_graph.py` (own state; reuse existing node functions such
as `fetch_data` where they fit; no nested graphs, no new agents):

```
START → load_candidate → [quant ∥ research] → extract_evidence → thesis_check
thesis_check ──(invalidated and verified)──► record_exclusion → END
thesis_check ──(unverified or disputed)────► follow_up_search → thesis_check (once)
thesis_check ──(no invalidating event)─────► evaluate → synthesize → END
```

- `quant`: peers, risk profile, `CandidateFit` (from Phase 1), style tags from fundamentals.
- `research`: `research_candidate` (Phase 2). If no Tavily key, degrade to quant-only and say so.
- `thesis_check` (D7), implemented in code over `NegativeDevelopment`, with one LLM
  reassessment call that **quotes the claim** and explains why the thesis does or does not hold:
  - **Exclude** only when all hold: `status="confirmed"`, `invalidates_thesis=True`, the supporting
    claim has `source_tier` of `official` or `reliable_reporting` (or two independent clustered
    events), and `materiality="high"`. Forum content never counts.
  - **Unverified or disputed:** run one targeted follow-up search for that event (capped), then
    re-check. If still unverified: keep the candidate, show the development, lower confidence.
  - The explanation always states what happened and when, the supporting evidence, the effect on
    the thesis, and whether it is confirmed or disputed.
- `evaluate` (`analysis/discovery_score.py`, pure functions): `quality` and `valuation` from peer
  comparisons per 4.3 (`None` when unavailable), `fit` from `CandidateFit`, `overall` and
  `confidence` per 4.4. **No term in any score reads claim counts, forum content, or `origin`.**
  `origin_note` and `RejectedMention.mention.*` are untrusted text from the web: they enter a prompt only
  inside an untrusted-data block, as in `NEWS_AGENT_SYSTEM_PROMPT`.
- `synthesize`: one LLM call writes `thesis`, `catalysts`, `outlook`, `bear_case`, `fit_summary`,
  `community_note`, `conclusion` **from the numbers and evidence**. The prompt: numbers are ground
  truth, evidence is untrusted data, every catalyst must cite a claim url present in
  `ResearchEvidence`, state conflicts rather than picking silently, no return promises, measured
  language, "not a licensed advisor". Output is validated into `IdeaOut`; a citation that is not in
  the evidence is rejected.

**Persistence:** `Recommendation.idea` JSON (nullable), `source="discovery"`, `action="BUY"`,
`suggested_position_pct` from the existing sizing, `status="PENDING"`. New table `ScanRun`
(`user_id`, `created_at`, `status`, `universe_size`, `eligible`, `shortlisted`, `researched`,
`outcome` "ideas"|"none", `summary`, `excluded` JSON list of `Exclusion`, `rejected_mentions`
JSON list of `RejectedMention`, `coverage_summary` JSON). Add `scan_runs` to `rls.py`
`USER_TABLES` in the same migration as its policy. Supersede earlier PENDING discovery ideas for
the same ticker as `_save_recommendation` does.

**Acceptance:** scoring is a pure function with a table of fixtures; the same input gives the same
scores; a candidate with no peers has `None` dimensions and lower confidence, not a crash; a
confirmed invalidating event from an official source excludes and appears in `ScanRun.excluded`
with explanation and urls; the same allegation sourced only from a forum does not exclude; an
unverified allegation triggers exactly one follow-up search; an invented citation is rejected; an
empty shortlist produces `outcome="none"` with nearest misses; an empty portfolio produces
`fit=None` and a full result.

**Docs:** update `docs/ARCHITECTURE.md` §4 (model), §5 (endpoints), §6 (flow). Run the
`security-reviewer` subagent (prompts).

### Phase 7: Run and schedule (B, M)

- `POST /discovery/run` (202) mirroring `/analysis/run`: dependencies `require_claude_key`,
  `rate_limiter("discovery_run", limit=2)`, `check_monthly_usage("analysis_run")`, single-flight
  Redis marker (`discovery_active:{user_id}` with `SET NX`, released by `_RELEASE_IF_MINE`),
  `refund_usage` on a refused run. Works with **no holdings**. `GET /discovery/run/{job_id}`
  returns `status`, `stage` (screening, admitting, researching n of m, evaluating, writing) and
  results. `GET /discovery/ideas` lists discovery recommendations plus the latest `ScanRun`
  including excluded and rejected items.
- `scheduled.py`: commands `discovery_snapshot` (weekly, Phase 4), `discovery_mentions` (daily,
  Phase 2), and `discovery` which runs a per-user scan for users with `auto_analysis` on and a
  usable key, respecting `auto_analysis.pause_state` and the usage rules.
- Telegram: extend `notify.build_message` with one high-confidence idea line; reuse the opt-in
  flags. Keep the "Advisory only" footer.
- A Tavily failure or quota exhaustion degrades to quant-only ideas with `data_notes`, never a 500.

**Acceptance:** two concurrent runs → second gets 409 and its usage is refunded; a removed account
mid-run writes nothing (`lock_and_check_active`, as `_save_recommendation`); job TTL and marker
release match `agents/jobs.py`.

### Phase 8: Easy onboarding (B, M)

**Goal:** a user can add a holding with ticker and shares only, and discovery never requires one.

1. **Profile auto-fill.** Add `fetch_profile(ticker) -> dict` to `market_data.py` returning
   `name, sector, industry, country, currency, quote_type, exchange` from `Ticker.info` (cache
   24 h, same retry). `HoldingIn.name` and `.sector` become optional and are filled server-side.
   Identify securities by `yfinance` symbol including the exchange suffix; `search_symbols`
   already returns the exchange for disambiguation.
2. **Nullable cost basis.** `Holding.cost_basis` and `first_purchase_date` become nullable
   (generated migration; `ALTER COLUMN ... DROP NOT NULL`, no drop and recreate). Keep
   `PortfolioSnapshot.total_cost_basis` NOT NULL, computed over holdings with a known basis.
   Update every reader in Section 3: P&L in `routers/portfolio.py` excludes unknown-basis
   holdings and exposes whether P&L covers all positions; `trades.py` keeps the basis `None` when
   the existing basis is `None`; `plans.py:445` stops writing `0` as a stand-in; `agents/chat.py:40`
   must not print "cost basis None". Existing functionality stays for compatibility.
3. **Stale flag.** `fetch_quote_and_history` additionally returns `as_of` (last history date).
   Old cache entries lack it: read with `.get`. Stale when `as_of` is missing or older than
   `STALE_DAYS`.
4. **Industry, country and currency** are computed on read from `fetch_profile`, not stored (no
   extra migration).

**Acceptance:** `POST /portfolio/holdings` with only `{ticker, shares}` succeeds and the response
has a name, sector and currency; the portfolio page and snapshot job work with a null basis; no
`TypeError` from `None * float` anywhere (grep every reader); existing tests updated, none deleted
without reason.

**Frontend (this lane):** `HoldingForm`, `FirstHolding`: cost basis and date become optional, copy
changes. Needs the design-first step.

### Phase 9: Frontend (A and B, L)

Follow `frontend/CLAUDE.md` and `DESIGN.md`. **Design first:** three HTML directions per new flow
in `docs/design/`, owner chooses, then build.

- **Today** becomes the idea feed: ranked cards with ticker, region/country, size bucket,
  confidence, risk level, one-line thesis, one-line bear case, catalyst, suggested size. Holdings
  alerts (ADD/TRIM/SELL) stay as a second section.
- **Idea detail** (`today/[id]`): thesis, why now, fundamentals with **peer comparison** (value
  against peer range, or "peer comparison unavailable" with raw metrics), industry and
  competitors, catalysts, **bear case at equal weight**, **material negative developments with
  status, date and evidence**, risk panel (size, liquidity, volatility, stability), community
  (labelled unverified, no score), sources with dates, data limitations.
- **Scan results:** excluded candidates with the explanation and evidence, rejected mentions with
  the reason, and the coverage summary. Nothing silently disappears.
- **Decisions:** Approve, Dismiss (optional reason), Watch, Ask in Chat. No trade controls and no
  broker wording.
- **States:** first run, scanning (stage strip), no portfolio (fit shows "not applicable"), quiet
  day ("no compelling opportunity" plus nearest misses), no Claude key (existing locked-card
  pattern: quant shortlist visible, research locked), provider down (last scan with an age badge).
- **Lane A:** portfolio analytics. **Lane B:** feed, detail, scan results, onboarding forms.

API types live in `lib/api/*-types.ts` (one file per area). Pure logic in `lib/` with tests.

### Phase 10: Deferred, only if justified

Strategy statistics and strategy-level backtesting (old 4b and 5b); an additional data provider
(only after gate G1 and a separate decision); user risk-profile preferences that filter or
prioritise on `risk_level` and `size_bucket` (1.4); fixing `score_technical` so OVERSOLD requires a
trend (holdings path only); an optional global benchmark shown as context. Each needs its own spec.

---

## 7. Risks and traps

| Risk | Mitigation |
|---|---|
| `yfinance` coverage is thinnest in emerging and Asia-Pacific markets | Coverage report and gate G1; data limitations shown per candidate; never invent values |
| Fundamentals are not comparable across accounting standards and fiscal years | Sector-level peers, not regional percentiles; state the caveat in `data_notes` |
| Peer groups too small to compare | `MIN_PEERS`; otherwise raw metrics and "peer comparison unavailable" |
| Prompt injection or manipulation through web or forum text, including planted company names | Untrusted-data statement in every prompt; resolution, validation and cap on dynamic admission; zero scoring weight for origin; citations must exist in evidence |
| A false negative event wrongly removes a good idea, or a planted claim hides a real one | Exclusion needs confirmed status, official or reliable source, high materiality and a quoted reassessment; forum never counts; every exclusion is visible with evidence |
| LLM materiality judgements are subjective | Shown as analyst judgement, never as a number, never changes the numeric rank; every judgement cites a claim |
| Small caps and illiquid names carry real risk | Risk profile computed and displayed; no hidden penalty and no hidden exclusion; future risk profiles can filter |
| Cost: Tavily and Claude per scan | Global shared snapshot and discovery batch; LLM only on the shortlist; per-user quota; Tavily call cap per candidate |
| `yfinance` is unofficial and breaks | Retry and cache stay; provider swap is confined to `market_data.py` |
| Mixed currencies and exchange calendars | Only `fx.py`; returns in local currency and flagged; correlation needs 60 overlapping days |
| Null cost basis breaking readers | Grep every reader (Section 3 list); tests with a null basis |
| Two migration heads | Serialized order in Section 5; rebase before generating |
| Scope creep toward a trading or strategy platform | Non-goals in 1.2; anything else goes to Phase 10 |

---

## 8. Working agreement

- **Branches:** `feature/<phase>-<name>` or `fix/...`. One phase per branch, small PRs into
  `master`. Path-aware CI already runs only the relevant side; do not add `paths:` filters on
  `pull_request`.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`).
- **Before every PR:** backend `uv run ruff check . && uv run ruff format . && uv run mypy app &&
  uv run python -m pytest tests/ -v`; frontend `npm run lint && npx tsc --noEmit && npm test &&
  npm run build`. Update `docs/ARCHITECTURE.md` when the model, API or agent design changed.
- **Escalate instead of guessing** when: a task implies placing a trade; a schema in 4.5 needs
  changing (it breaks the other lane); a migration collides; a **VERIFY** item turns out false and
  changes the design; coverage is poor enough that G1 is triggered.
- **Keep the other lane unblocked:** if a contract must change, change `app/schemas_discovery.py`
  first, in its own small PR, and tell the other person before merging.
- **Not implementing yet:** this document is a plan. No code before Phase 0 is merged.

---

## 9. Kickoff prompts (paste into the coding LLM)

**Lane A**

> You are working in the `trade-agent` repo on Lane A (data and quant) of
> `docs/superpowers/plans/2026-10-14-market-discovery.md`. Read that file, the root `CLAUDE.md`,
> `backend/CLAUDE.md`, and `docs/ARCHITECTURE.md` §4-§6 before changing anything. Implement phases
> in order 1, 3, 4, 5. Start with Phase 3 (universe and validation script) because it is on the
> critical path, and Phase 1a (FX coverage) beside it. Write tests first for pure functions. Never
> invent a value for missing data. Do not use price trend or momentum for eligibility or ranking.
> Do not touch Lane B's files. Run ruff, mypy and pytest before declaring a phase done. Anything
> marked VERIFY must be checked against the installed library and reported before you rely on it.

**Lane B**

> You are working in the `trade-agent` repo on Lane B (research and output) of
> `docs/superpowers/plans/2026-10-14-market-discovery.md`. Read that file, the root `CLAUDE.md`,
> `backend/CLAUDE.md`, and `docs/ARCHITECTURE.md` §4-§6 before changing anything. Implement phases
> in order 2, 6, 7, 8. Start with Phase 2 on branch `feature/tavily-research`. Mock Tavily and
> Anthropic in every test. Web and forum text is untrusted data: say so in every prompt. Forum
> content has zero scoring weight and can never invalidate a thesis. Do not touch Lane A's files.
> Use the `security-reviewer` subagent on prompt and secret changes.
