# Discover company overview and single-company Analyze

Approved 2026-10-26 for #193 and #194. The owner said **"Use the proposed layout and policies"**.
See [the approval record](direction-approved.md). The reviewed mock came from
[PR #224](https://github.com/Frigomia/trade-agent/pull/224); the implementation is on
`feature/discover-company-analysis`.

## Decisions for you

- **Resolved 2026-10-26, #194:** desktop and phone layout, with independent quote/history failures.
- **Resolved 2026-10-26, #193:** one shared monthly run per completed research, including a
  non-opportunity. Refusals and failures cost zero; refund any reservation exactly once in its
  original month. Provider billing already incurred is separate from the app's monthly allowance.
- **Resolved 2026-10-26, #193:** persist completed outcomes and bounded eligibility refusals.
  No paid repeat action for a completed outcome or unchanged refusal. Changed relevant data or
  preferences can enable a refused company again, but never start research automatically.

## User journey and states

Every company name in Discover opens its report or `/discover/company/<encoded ticker>`.
The basic page is free: identity, dated quote, keyboard-readable price chart, sector, industry,
exchange, country (provider domicile, not verified listing country) and currency. No empty report
sections, recommendation score or approval actions appear before a report exists.

Desktop: chart/facts beside a 300px research panel. Phone: identity, research, chart, then facts.
Reuse the Soft panels, company monogram, sector icon and price chart. Actions have 44px targets.

| State | Behavior |
|---|---|
| Ready | Explicit Analyze with one-run cost, actual usage and renewal date |
| Running | Analyzing and researching stage; no second start; leaving and returning reconnects |
| Report saved | View report; hide Analyze and its cost line; refresh Discover |
| Ineligible | Saved bounded reason; no research label or charge; disable unchanged retry |
| Researched, no opportunity | Saved conclusion and date, AI analyzed; no invented BUY or paid retry |
| Key missing/rejected | Link to `/more/account`; overview remains usable |
| Quota exhausted | Actual allowance; no paid action; overview remains usable |
| Failed | Safe error and refund/settlement state; explicit retry only once settlement is known |
| Provider unavailable | Retain known facts; identify missing quote/history; no invented series. Overview failure alone does not disable Analyze; research independently checks its own data |
| Not saved by caller / removed | 404 before provider work or job disclosure |

## Implemented contract

| Endpoint | Behavior |
|---|---|
| `GET /discover/{ticker}/overview` | Owner-only saved company, current facts and bounded missing-data indicators; no research or quota increment |
| `GET /discover/{ticker}/history?range=1m` | Owner-only daily closes; same five ranges and major-unit rules as saved-idea history |
| `POST /discover/{ticker}/analyze` | Explicit single-company request; 202 with durable CompanyAnalysisOut including job_id, outcome, research flag, reason, timestamps, report_id, charge_state and can_analyze |
| `GET /discovery/run/{job_id}` | Existing owner-only polling shape, extended with a company outcome for company jobs; durable after Redis expiry |

Watchlist ownership is checked before key resolution, quota or provider work. The normal user's
own usable Claude key is required; only the existing admin policy permits server-key fallback.
GET responses are no-store. Provider strings stay bounded/plain text. History never guesses an
unknown pence/pound unit and uses the same shared service for idea and company routes.

`POST /analysis/run` remains the holdings graph and saves manual recommendations. The Discover
route uses the discovery candidate evaluator because its Workbench needs structured citations,
peers, risks and portfolio fit. No third research engine is introduced; manual reports are not
silently relabeled. All manual/scheduled holdings, scan and company entry points now share the
atomic per-user `analysis_active` claim. An owning job alone can renew or release it.

Preparation is bounded to 120 seconds and does no paid work: read the requested cached snapshot,
refresh only that ticker if absent/stale, reject unverified instrument types before normalization,
check freshness/currency/user eligibility, and build peers from the cached universe. A saved ticker
outside the static universe is accepted if it passes the same safeguards. No universe ranking,
mention admission, full-universe refresh or global paid theme search occurs. The shared candidate
path computes portfolio fit and evaluates only the requested company. Company research requires
completed cited synthesis; the graph's quantitative-only fallback is a failed company run, refunded.

The shared claim is renewed and checked atomically with quota reservation before paid work. The
900-second research timeout fits inside its fresh 1200-second claim. A per-job reservation token
makes refunds idempotent and retains the original month key. A lost worker is reconciled on a later
read. Pending settlement blocks retry; reconnecting/polling never increments quota. This is an
in-process job, not a durable worker queue. Drain current discovery jobs before deploying the
shared-lock namespace change.

`CompanyAnalysis` records attempts separately from `ScanRun`: user, ticker, unique job ID, dates,
outcome, whether research ran, bounded reason, validated optional idea, optional report association,
admission-input fingerprint, original usage key and settlement state. The generated Alembic
migration enables/forces owner-only RLS and grants runtime access in the same revision. The table
is exported and removed with the account's other data. Company outcomes survive temporary job
expiry; failed attempts cannot erase prior saved reports. A company write never replaces the latest
market-scan summary or supersedes unrelated recommendations. Only a qualifying opportunity creates
a discovery BUY; all other completed outcomes retain their honest reason without a fake report.

## Validation

The original [mock](overview.html) and six captures cover
[desktop light](shots/ready-light-1280.png), [desktop dark](shots/ready-dark-1280.png),
[390px light](shots/ready-light-390.png), [390px dark](shots/ready-dark-390.png),
[320px light](shots/ready-light-320.png) and [320px dark](shots/ready-dark-320.png).
Regenerate the proposal captures with
`node docs/design/discover-company/check.cjs <installed-playwright-module-directory>`.

Implementation checks cover ownership before provider/paid work; minor-unit conversion and missing
history; an outside-universe ticker; instrument refusal; unchanged-refusal and completed-result
repeats; shared locks; stale preparers and orphan recovery; one charge or refund, including month
rollover, timeout/cancellation and persistence failure; no unrelated supersession or ScanRun write;
plain rendering, explicit clicks, key/quota states, actual allowance and saved non-opportunities.
Run scoped lint, typecheck, tests and frontend build. Review the final diff with Ponytail Review
and the auth/RLS/quota paths with an independent security reviewer. Browser-check both themes at
1280, 390 and 320px, including keyboard focus, long names, running, saved, refused and failed states.
