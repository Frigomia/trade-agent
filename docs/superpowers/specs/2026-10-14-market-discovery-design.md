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
| Snapshot, peer comparison, risk, and shortlist | Implemented in `app/discovery/`; resumable Redis refresh and the weekly `discovery_snapshot` command exist. |
| Provider setting | Phase 0 adds optional backend `TAVILY_API_KEY` and documents its ownership and absence behavior. No request is made. |
| Dynamic admission | Implemented in `app/discovery/admit.py`: untrusted mentions are resolved to one search result, deduplicated, put through the same safeguards, and capped. Nothing produces mentions yet. |
| Research, evaluation graph | Future Phases 2 and 6. Contract models are not implementations of these workflows. |
| Scan persistence, API, and scheduled user scans | Future Phases 6 and 7; no discovery scan endpoint or `ScanRun` table exists yet. |
| Easy onboarding and discovery UI | Future Phases 8 and 9. |

Phase 1 adds required `PortfolioExposure.notes` for partial valuation, FX/history limitations and
ETF proxy exposures; its producer and fixtures are updated together. The new endpoint has no
existing public response to break. `marginal_effect` takes keyword-only `ticker` and
`portfolio_returns` alongside the original inputs because the public summary does not contain raw
returns. See [architecture §6](../../ARCHITECTURE.md#portfolio-analytics-phase-1) for the exact
valuation, aligned-interval and missing-data rules. I1 still awaits Phase 2.

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
| Research budget | At most 4 initial Tavily searches per shortlisted candidate, one targeted follow-up per candidate, and one evidence-extraction Claude call before evaluation/synthesis. Daily theme discovery has a separate fixed global budget, specified and tested in Phase 2. | Phases 2 and 6 |
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

## Research and evaluation (future phases)

Phase 2 uses `httpx` against Tavily's HTTPS API, subject to verification of the current official
REST contract before implementation. Avoid a new SDK unless there is a concrete need. Search
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

## Configuration and cost ownership

`Settings.tavily_api_key: str | None` reads backend `TAVILY_API_KEY` and defaults to `None`.
`backend/.env.example` declares an empty value. The field is excluded from the settings repr;
never log/dump settings or provider headers/bodies, and log only exception class names.
Store the real key in backend secret configuration, with `api.tavily.com` as the future HTTPS
destination. Never put it in frontend `NEXT_PUBLIC_*` variables, examples, tests or source.

This phase does not contact Tavily, require credentials, add a dependency, or enable paid work.
The owner funds Tavily; per-user extraction/synthesis uses the resolved user's Claude client
and existing monthly quota. Missing or empty Tavily configuration and provider failures in Phase
2 mean research unavailable, not failed application startup. Preserve quant-only output with an
explicit limitation; do not present missing research as a fully researched idea. Background
theme work needs an explicit bounded budget and existing supported server authentication, not
an arbitrary user's stored Claude key. Provider-contract, availability and cost checks remain
Phase 2 implementation prerequisites.

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

Integration checkpoints remain outstanding: I1 runs analytics and research on three real
tickers; I2 exercises shortlist plus dynamic admission and records runtime; I3 runs a full scan
for both populated and empty real accounts. The universe reports are evidence for the limited
G1 data-coverage gate, not evidence that these end-to-end checks have happened. No future phase
is marked complete by the existence of its contract alone.
