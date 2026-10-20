# Market discovery — design

Status: Phase 0 design, completed 2026-10-18 for PR review. This records implementation decisions;
it does not claim that the complete discovery feature has shipped. The
[implementation plan](../plans/2026-10-14-market-discovery.md) remains the phase-by-phase handoff.
Where its original proposals differ from the decisions below, this spec and the existing shared
contracts describe the handoff for subsequent phases.

## Goal

A person can discover long-term investment opportunities beyond their holdings and watchlist,
including when their portfolio is empty. The system screens a worldwide universe, admits safely
resolved companies found through research, investigates a small shortlist, and returns ranked,
cited ideas or an explicit **no compelling opportunity** result. Each idea shows fundamentals,
valuation against comparable peers, risks, the strongest bear case, material negative
developments, portfolio fit when applicable, and data limitations.

The result is advice for human review. Approve and Dismiss only record decisions. Nothing here
places a trade or calls a broker. Price momentum and technical signals are context only; they
never determine discovery eligibility or numeric rank. The current holdings/watchlist analysis
keeps its existing graph and scoring behavior.

Out of scope: broker availability, order execution, another financial data provider, new agent
frameworks or services, strategy backtesting, user-configurable risk profiles, tax/dividend
accounting, and changes to the existing holdings-path technical signal. These remain Phase 10
or separate work. ETF-specific discovery scoring also needs a separate design: ETFs are kept in
the universe but currently excluded with an explicit explanation, rather than evaluated using
company fundamentals.

## What exists and what this phase delivers

| Area | State at this handoff |
| --- | --- |
| Shared Pydantic contracts and fixtures | Implemented in `app/schemas_discovery.py`, `tests/discovery_fixtures.py`, and `tests/test_schemas_discovery.py`. Reuse them without changing their shape in Phase 0. |
| Global FX and portfolio analytics | Implemented: `app/fx.py` plus Phase 1 pure analytics/candidate fit and `/portfolio/analytics`. Read-only profile/dates support exposure; holding auto-fill stays Phase 8. |
| Curated universe and coverage evidence | Implemented: 600 symbols, validator, [coverage report](universe-coverage.md), and [candidate-pool audit](universe-candidate-audit.md). |
| Snapshot, peer comparison, risk, and shortlist | Implemented in `app/discovery/`; resumable weekly Redis refresh and one ranked pool for universe and already-admitted candidates. User scan orchestration remains Phases 6 and 7. |
| Provider setting | Optional backend `TAVILY_API_KEY`; Phase 2 uses it only when research is explicitly invoked. Startup and existing analysis do not call Tavily. |
| Dynamic admission | Implemented in `app/discovery/admit.py`: untrusted mentions are resolved to one search result, deduplicated, put through the same safeguards, and capped. Phase 2 produces mentions; scan integration remains later work. |
| Research, evaluation graph | Phase 2 research implemented in `agents/research.py`; evaluation graph remains Phase 6. |
| Scan persistence, API, and scheduled user scans | Future Phases 6 and 7; no discovery scan endpoint or `ScanRun` table exists yet. |
| Easy onboarding and discovery UI | Future Phases 8 and 9. |

Phase 1 adds required `PortfolioExposure.notes` for partial valuation, FX/history limitations and
ETF proxy exposures; its producer and fixtures are updated together. The new endpoint has no
existing public response to break. `marginal_effect` takes keyword-only `ticker` and
`portfolio_returns` alongside the original inputs because the public summary does not contain raw
returns. See [architecture §6](../../ARCHITECTURE.md#portfolio-analytics-phase-1) for the exact
valuation, aligned-interval and missing-data rules. The live I1 checkpoint remains outstanding;
Phase 2 research is now implemented, but the combined live flow has not been verified.

## Decisions and defaults

These are the selected MVP defaults for the Phase 0 handoff. Existing implementations keep their
current values; future phases introduce their named constants when they have consumers. They are
not new environment-variable settings or a new user configuration system.

| Decision | Default and rule | Owner |
| --- | --- | --- |
| Universe | 600 securities; regional composition targets: 180 North America, 180 Europe, 150 Asia-Pacific, 60 other emerging markets, 30 global ETFs. Targets do not override validation. | Phase 3, implemented |
| Suitable peers | `MIN_PEERS=8`, counted per metric, excluding the candidate. Same industry when sufficient, otherwise global sector, within the same financial metric group. | `discovery/peers.py`, implemented |
| Core coverage | `MIN_CORE_METRICS=3` finite core fundamentals; missing stays `None`. A zero that is a valid measurement counts as present. | `discovery/eligibility.py`, implemented |
| Dimension coverage | `MIN_SCORED=2` valid peer comparisons per dimension; otherwise that dimension is `None`. | `discovery/scoring.py`, implemented |
| Price freshness | Use the exchange-aware rules below. The old blanket `STALE_DAYS=5` proposal is superseded; 5 calendar days remains only the sparse-exchange fallback. | `discovery/snapshot.py`, implemented |
| Research shortlist | `SHORTLIST_SIZE=8`. | `discovery/screen.py`, implemented |
| Dynamic admission | `DISCOVERY_MAX_DYNAMIC=10` per scan; all remaining mentions carry `cap_reached` or another rejection reason. | `discovery/admit.py`, implemented (at most 30 mentions are looked up at all) |
| Overall score | Equal-weight mean of available quality and valuation scores; `None` when neither exists. Fit never contributes to this mean. Serialize the final integer using Python `round`, matching current dimension scoring. | Phase 6 |
| Ranking | Descending overall, then lower risk (`low`, `medium`, `high`, `unknown`), then better available fit when applicable, then ticker for deterministic ordering. Current screening has no fit yet and uses ticker after risk. Missing overall is unrankable. | Phases 4 and 6 |
| Opportunity threshold | `NO_OPPORTUNITY_MIN_OVERALL=60` and confidence at least `medium`; otherwise persist `outcome="none"` with nearest misses. | Phase 6 |
| Quota | One user scan consumes one existing `analysis_run` unit; a refused overlapping scan refunds it. No new usage kind or limit columns. | Phase 7 |
| Research budget | At most 4 initial Tavily searches and one evidence-extraction Claude call per candidate (Phase 2). Daily themes: at most 14 searches and one extraction, once per UTC date. At most one targeted follow-up remains Phase 6. | Phases 2 and 6 |
| Portfolio comparison | Hypothetical candidate weight 5%; correlations need 60 overlapping daily returns. No usable portfolio means fit is not applicable. | Phase 1 |
| Risk labels | Micro below EUR 300M, small below EUR 2B, mid below EUR 10B, large above; thin liquidity below EUR 1M average traded daily value; high annualized volatility above 40%; high leverage above 2x debt/equity where meaningful. | `discovery/risk.py`, implemented |
| Risk level | `unknown` if nothing can be measured; otherwise 0 flags is low, 1 medium, 2 or more high. Never an eligibility filter or a penalty to the numeric overall. Lower risk breaks an otherwise equal score. | `discovery/risk.py`, implemented |
| Snapshot lifetime | Redis entries live 8 days; records written within 24 hours can be reused while resuming. Older entries are fetched again on refresh; failed refreshes preserve an older cached record until its TTL. | `discovery/refresh.py`, implemented |

Risk size/liquidity cutoffs are labels, never investment eligibility floors. Stability flags
respect sector meaning: banks and insurers are not judged by industrial-company leverage or
free-cash-flow rules. Fewer than 120 history bars leaves volatility/drawdown unavailable.

### Freshness and identity

`check_freshness` compares each last close with its own exchange: a close within the latest three
trading weekdays is current; with at least five usable exchange histories, missing at least
three observed sessions is stale. Independently verified closures and documented trading weeks
may explain gaps. If the whole exchange is silent, mark freshness uncertain rather than guessing
whether there is a holiday or provider outage; after more than 14 calendar days it is stale.
With too few exchange histories, use the 5-calendar-day fallback. No history is always stale.
Uncertain freshness is disclosed in `CandidateMetrics.data_notes` and is an input to final
confidence, not an automatic exclusion.

`CandidateMetrics.country` is the listing country, not automatically Yahoo's issuer domicile.
Identity must match the intended company, symbol and exchange; the universe's coverage report
and audit retain observed discrepancies. A dynamically discovered name is untrusted input:
admission must resolve exactly one matching security, reject ambiguous names, validate quote
type/currency/data, deduplicate against the universe, holdings and earlier admissions, and apply
the same safeguards. Its origin carries zero scoring weight.

### Peer comparison and missing data

Use economically comparable metric groups: general companies, banks, insurers, other financials,
REITs, and utilities, as encoded in `discovery/peers.py`. Invalid ratios (for example earnings
multiples without positive earnings) are unavailable. REIT FFO and utility interest coverage are
explicitly unavailable where Yahoo cannot supply them. Show the raw value even when no valid
peer comparison is possible; never manufacture a value or score of zero.

The existing implementation uses inclusive p25/median/p75 of valid peer observations, without
an additional winsorization pass. This replaces the plan's proposed winsorization step and
retains the current tested scoring behavior. Each metric is mapped across a range from one IQR
below p25 to one IQR above p75, clamped to 0..1 and reversed where lower is better; dimension
scores are the rounded mean times 100. The dimension is unavailable with fewer than two valid
comparisons. An eligible symbol with no scored dimensions is retained as an explained
`insufficient_data` exclusion instead of disappearing.

`shortlist_for_user` accepts Phase 5's validated output as `mentions_admitted`. Admission must
use the same snapshot and current holdings. Entrants retain their peer comparisons and never
become peers for one another or for universe symbols. Universe candidates win duplicate ticker
matches; otherwise the same quality/valuation, risk and ticker order selects up to eight total
ideas, with holdings and avoided sectors applied to both sources. Provenance never affects rank.
Both sources disclose fiscal-period and accounting-standard differences in `data_notes`.

## Data flow

```text
GLOBAL, weekly
  curated universe -> Yahoo data -> per-symbol Redis snapshot

GLOBAL, daily (future)
  fixed theme research + forum queries -> cited mentions, zero scoring weight

PER USER (future)
  snapshot + safely admitted mentions
    -> remove held tickers and explicitly avoided sectors
    -> safeguards + peer-based rank -> shortlist up to 8
    -> one graph per candidate: quant || research
    -> thesis check -> at most one follow-up -> exclusion or evaluation
    -> deterministic overall/confidence -> synthesis from evidence and numbers
    -> ranked ideas or stored no-opportunity result, including exclusions/rejections
```

Do not introduce nested graphs, a second agent framework or a parallel broker workflow. Snapshot
and daily theme work are shared globally; user portfolio data, scans and results remain private.
The selected-universe coverage report is not proof of universal Yahoo coverage: carry the
candidate-pool audit's provider limitations into the coverage gate and UI.

## Shared contracts and ownership

`backend/app/schemas_discovery.py` is the executable source of field names and validation. The
plan's Section 4.5 is the original sketch. Both lanes use the existing fixture instances and
JSON round-trip tests until producer and consumer implementations land.

| Contract group | Producer | Consumer and invariants |
| --- | --- | --- |
| `Exposure`, `PositionValue`, `PortfolioExposure`, `CandidateFit` | Portfolio analytics, Phase 1 | Portfolio UI and candidate quant node. EUR values, bounded weights; unavailable pairwise correlations and empty-portfolio fit are explicit `None`/not applicable. |
| `Coverage`, `PeerComparison`, `RiskProfile`, `CandidateMetrics` | Snapshot and screening, Phase 4; admission, Phase 5 | Evaluation and idea detail. Core counts match the missing list; listing country and required short `data_notes` travel with the candidate. |
| `Mention`, `RejectedMention` | Research discovers; admission resolves | Dynamic admission and scan results. Origin/reason explain provenance and carry no score; all rejected mentions have a typed reason. |
| `Claim`, `NegativeDevelopment`, `ResearchEvidence` | Research, Phase 2 | Thesis check and synthesis. Claims have HTTP(S) citations, dates only when known, event identity, materiality, source tier and stance; forum kind and tier must agree. |
| `Exclusion` | Safeguards or thesis check | Stored scan/UI. A thesis-invalidated exclusion requires citations; data exclusions explain the missing/invalid data. |
| `DimensionScore`, `IdeaOut` | Evaluation and synthesis, Phase 6 | Stored recommendation and UI. Exactly one quality, valuation and fit dimension, explicit unavailable scores, numeric overall based only on quality/valuation. |

Every contract forbids unknown fields and nonfinite numbers. Required nullable fields cannot be
silently omitted. `CandidateMetrics.data_notes` is required; each entry is nonblank and at most
500 characters. Format validation of URLs is not proof of truth, independence or membership in
the fetched sources. Those semantic checks belong to research/evaluation and must be tested
there. Do not fetch arbitrary citation URLs or trust a model-provided source tier as authority.

No new contract fields or database tables are needed in Phase 0. A later contract change gets a
small explicit producer/consumer PR with matching fixtures, not an ad hoc field in `schemas.py`.

## Research and evaluation

Phase 2 uses `httpx` against Tavily's HTTPS API; the request contract was checked against the
official Python client (details below). No new SDK is needed. Search
news/catalysts, bull case, bear case with equal effort, and forums; prefer relevant local-language
sources where practical. No source date is invented.

Fetched content is **untrusted data, never instructions** in every extraction, reassessment and
synthesis prompt. Drop claims without valid source URLs, normalize URLs for deduplication, group
claims by the underlying event, preserve conflicts/gaps, and keep forum discussion explicitly
unverified with zero scoring weight. A repeated story is not independent corroboration.

Thesis exclusion requires a confirmed high-materiality development that invalidates the thesis
and qualifying evidence under the plan's Phase 6 rules. Forum-only evidence never qualifies.
Unverified or disputed allegations get at most one targeted follow-up; if unresolved, keep the
candidate with the uncertainty disclosed and reduced confidence. Phase 6 must validate source
membership and corroboration in code, rather than trusting the LLM's output flags.

The LLM writes thesis, catalysts, outlook, bear case, community note and conclusion from the
computed numbers and validated evidence; it never calculates scores or changes numeric rank.
Catalysts may cite only URLs in the evidence. Confidence is deterministic from metric coverage,
peer availability, staleness and unresolved conflicts; Phase 6 supplies a fixture-tested mapping
before exposing results. Quality/valuation rank is separate from qualitative outlook. A scan
with no qualifying overall/confidence persists `outcome="none"` and nearest misses.

### Phase 2 implementation

`agents/research.py` now implements `research_candidate` and `discover_mentions`, using the
existing shared contracts unchanged. Candidate research makes four basic Tavily searches with
five results each: monthly news, bull case, bear case and Reddit. Bull/bear get equal effort.
News queries include home-market terms for the committed language map; country targeting is
used only on general searches. Unknown/multilingual markets retain English terms. Each source
contributes at most 1,500 content characters. There are no automatic Tavily retries and only one
Claude extraction attempt (60-second timeout, SDK retries disabled).

Post-processing accepts only fetched HTTP(S) citations and checks each `Claim.text` as a short
verbatim excerpt in that citation's source content after whitespace/case normalization. It
removes tracking/fragment differences and deduplicates by URL, event id and text, preserving
different claims from one article. Ten reports of one event retain their citations; neither
URL counts nor distinct hostnames alone prove independent corroboration.
Publication dates come from parseable source metadata only; unknown dates stay null. Proposed
negative-development dates survive only if present in cited source metadata; content-only dates
remain unavailable. `discovery/sources.py` derives authority from regulatory/reporting hostname
allowlists; unknown publishers remain `other` and cannot confirm a development. Trusted internal
callers may supply independently verified issuer hosts. Actual community hosts, forum-query
provenance and explicit Seeking Alpha comment/blog URLs force forum kind/tier; editorial article
URLs are not all treated as forums. Confirmation requires an authoritative fact and invalidation
also requires high materiality. Phase 6 verifies the final exclusion rules in code. Mentions need
a fetched citation and a name present in its supplied text; unsupported ticker/exchange hints
are cleared. Short legitimate names remain valid. Extracted text is cleaned and capped using
the existing 300-character admission helper; oversized claim excerpts are rejected rather than
silently cut. Model notes are prefixed so they cannot masquerade as code-written coverage gaps.

The committed seven `DISCOVERY_THEMES` are the only input for `discover_mentions()`, which
accepts no client or theme arguments and resolves the server's Claude client internally.
There is one industry and one Reddit search
each (14 searches total), one extraction and at most 30 mentions. Mentions have zero scoring
weight. Redis stores `discovery:mentions:v2:YYYY-MM-DD` for 24 hours, including empty batches and
unavailable (`null`) results. The version change ignores older unverified cache entries. An
atomic daily budget claim is deliberately retained even if a worker fails or the result cannot
be cached, preventing paid repeats that day. Unavailable Redis means no paid work. A failed or
interrupted batch waits until the next UTC date; there is no in-day retry. This batch uses only
explicit global/server Claude authentication, never a stored user's key. The original unversioned
daily lock key is retained across cache upgrades, so deployments cannot repeat paid work that
day. `[]` means a completed empty batch; `None` means unavailable or in progress. Nothing schedules
it yet. Per-candidate research requires an explicit user client and rejects `None`, even when a
server key is configured.

The REST endpoint, bearer authentication and search options were verified on 2026-10-18 against
[Tavily's official Python client at `46505f1`](https://github.com/tavily-ai/tavily-python/blob/46505f119e6ac0f30d63a4dce0ed9f923705ad97/tavily/tavily.py).
The documentation website was inaccessible from this workspace. Fixtures are representative
provider-shaped test data, not a claim of a successful live paid search. Actual Reddit coverage,
current provider billing and live availability remain integration checks; sparse/empty results
are explicitly supported and disclosed. Tests make no external provider calls.

## Configuration and cost ownership

`Settings.tavily_api_key: str | None` reads backend `TAVILY_API_KEY` and defaults to `None`.
`backend/.env.example` declares an empty value. The field is excluded from the settings repr;
never log/dump settings or provider headers/bodies, and log only exception class names.
Store the real key in backend secret configuration, with `api.tavily.com` as the future HTTPS
destination. Never put it in frontend `NEXT_PUBLIC_*` variables, examples, tests or source.

Phase 0 did not contact Tavily, require credentials, add a dependency, or enable paid work.
The owner funds Tavily; per-user extraction/synthesis uses the resolved user's Claude client
and existing monthly quota. Missing or empty Tavily configuration raises `ResearchUnavailable`;
provider failures return empty/partial evidence with explicit gaps, not failed application
startup. Callers preserve quant-only output with an explicit limitation; never present missing
research as a fully researched idea. Background
theme work uses the bounded global budget and existing supported server authentication, not
an arbitrary user's stored Claude key. The REST request contract is verified; live availability,
Reddit coverage and provider billing remain deployment integration checks.

## Persistence, API and lifecycle (future phases)

Phase 6 adds nullable `Recommendation.idea` JSON, `source="discovery"`, and a user-owned `ScanRun`
with counts, outcome/summary, exclusions, rejected mentions and coverage summary. Supersede old
pending ideas for the same ticker using the existing recommendation pattern. The new table gets
forced owner-only RLS, runtime grants, `USER_TABLES`, export and deletion coverage in the same
migration. Writes use scoped sessions and recheck active-account status before saving.

Phase 7 adds authenticated `POST /discovery/run` (202), owner-checked `GET
/discovery/run/{job_id}`, and `GET /discovery/ideas`. Require a usable caller key, rate limit
starts to 2/minute, reuse the `analysis_run` monthly counter and a per-user single-flight marker,
refund a refused start, and release markers only when owned by this run. Polling exposes the
screening/admission/research/evaluation/writing stages. Data access must never use the migration
owner connection to bypass RLS.

The weekly `discovery_snapshot` command already exists. Future `discovery_mentions` runs bounded
global theme discovery daily; future `discovery` runs opted-in user scans with key, pause and
usage checks. Telegram adds one high-confidence idea line while retaining opt-in behavior,
no private amounts and the advisory footer. These commands are not activated by Phase 0.

## Portfolio and frontend handoff

Phase 1 computes EUR position weights, exposure, concentration, aligned-history correlation and
marginal candidate fit. No holdings or too few usable histories is a valid response, not an error.
Local-currency returns do not include FX moves: disclose the limitation. Phase 8 makes profile
autofill and ticker/shares-only entry possible, with nullable basis/date and all dependent
calculations updated together; never replace unknown basis with zero.

Phase 9 needs the repository's design-first process before implementation: three directions and
the owner's selection. Build a ranked idea feed, equal-weight bull/bear detail with citations and
risks, exclusions/rejections and coverage, progress, and analytics. Support empty portfolio,
first run, no opportunity, missing key and provider outage/aged-results states. Quant shortlist
visibility with research locked is a UI requirement; it needs a separately authorized read path
when implementing the key-gated scan API. Decisions are Approve, Dismiss, Watch and Ask in Chat,
with no trade execution.

## Validation and completion gates

For Phase 0: run existing contract round-trip/invariant tests, configuration tests, full backend
lint/format/type checks and tests against local Postgres/Redis. Verify configuration accepts an
absent/empty key and loads an injected key without exposing it in repr. No live secret, Supabase
login, Tavily, Claude or Yahoo call is required for this handoff.

Later unit/API tests mock external providers and cover ambiguous admissions, missing metrics,
peer coverage, currencies/subunits, injection attempts, fabricated citations, repeated events,
forum-only allegations, bounded follow-up, quant-only degradation, no-opportunity results,
quota refunds, owner isolation, removed users and empty portfolios. Existing Phase 1–9 acceptance
criteria in the plan remain required.

I2 passed locally on 2026-10-18: all 600 Yahoo symbols refreshed, the cache-only repeat made no
symbol fetches, three real names passed dynamic admission, and combined screening preserved
universe peer comparisons. Runtime and limitations are recorded in the plan's Phase 4 completion
notes. I1 (analytics and research on three real tickers) and I3 (full scans for populated and empty
real accounts) remain outstanding. The universe reports are evidence for the limited
G1 data-coverage gate, not evidence that these end-to-end checks have happened. No future phase
is marked complete by the existence of its contract alone.
