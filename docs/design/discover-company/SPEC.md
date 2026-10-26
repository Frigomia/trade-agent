# Analyze a company from Discover

Proposal, 2026-10-24. Groups #193 and #194 into one user journey, delivered in small PRs.
This is a design and implementation plan, not a change to the shipped API or agent behavior.

## Decisions for you

- **Open — layout (#194):** approve the desktop and phone proposal, including independent
  quote/history failure and research states. See the [mock](overview.html) and screenshots below.
- **Open — cost and refunds (#193):** approve one shared monthly run per completed research,
  including a researched non-opportunity. Proposed: eligibility refusals and every failed run
  (including timeout, rejected key or save failure after research starts) cost zero; refund an
  existing reservation exactly once. A retry requires another explicit click and reservation.
  These are proposed rules, not the current discovery refund policy.
- **Open — outcomes and repeat requests (#193):** persist completed non-opportunities and bounded
  eligibility refusals. Show the actual outcome without manufacturing a BUY. Disable another
  request for an unchanged eligibility refusal; retry becomes available only after relevant data
  or preferences change. A completed non-opportunity shows its saved result without a paid retry.

The mock illustrates these recommendations; it does not record approval. After the owner chooses,
add `direction-approved.md` with their words, date and PR, and resolve these decisions with links.

## User journey

1. Every saved company has a linked name on Discover. Eligible companies without a saved research
   outcome also have an **Analyze** action.
2. Its name opens `/discover/company/<encoded ticker>`. This shows provider data without spending
   an analysis run: identity, currency, quote time/staleness, price chart, sector, industry and exchange.
3. Analyze is explicit: **Analyze · 1 monthly run**. Display the actual remaining allowance beside
   it; do not hard-code 100. Never start research just by opening a page or following a link.
4. While research runs, show a dotted Analyzing status and stage text. The user can navigate away;
   returning finds the same job. Duplicate clicks do not spend again.
5. A saved report becomes available as **View report** and the Discover card is refreshed. Keep the
   basic page available; open the report only through the explicit link.

Reuse the existing company identity, chart, sector icon, currency formatting and Soft panels.
Do not show empty recommendation tabs, confidence, a recommendation score, or Approve/Dismiss
before an actual report exists. No new facts or risk judgments are generated on a basic page.

## Visual proposal

[overview.html](overview.html) is a standalone mock, using fictional company data. It responds to
the viewport (inspect at 1280, 390 and 320px), supports light/dark selection and has a state picker.
Its Analyze button simulates a job locally; it never sends a request or consumes quota.
The allowance and renewal date are fictional examples; production uses account usage data.

Browser captures: [desktop light](shots/ready-light-1280.png),
[desktop dark](shots/ready-dark-1280.png), [phone light](shots/ready-light-390.png),
[phone dark](shots/ready-dark-390.png), [320px light](shots/ready-light-320.png) and
[320px dark](shots/ready-dark-320.png). Captures use the Ready state; browser checks also exercise
every state in each theme and viewport, keyboard focus and a long company name.
Regenerate and verify with `node docs/design/discover-company/check.cjs <playwright-module-dir>`
from the repo root, using an existing installed `playwright` or `playwright-core` module and its
Chromium browser. The check adds no application dependency and writes those six captures.

Desktop: identity and quote above a chart/facts column and a narrow research panel. Phone: one
column, research panel immediately after identity, followed by chart and facts. Actions are at
least 44px high. The chart has a textual equivalent. Unknown values say Unavailable.

## States and policy

| State | UI and behavior |
|---|---|
| Ready | Provider facts and dated quote; explicit Analyze with one-run cost |
| Running | Analyzing and stage; no second Analyze; navigation remains possible |
| Report saved | View report only; hide Analyze and its cost line; update Discover's report/status fields |
| No report: ineligible | Show a persisted bounded admission reason and no charge; disable Analyze until relevant inputs change; never label this AI analyzed |
| Researched: no opportunity | Show persisted conclusion and research date, labeled AI analyzed with no opportunity; no invented BUY and no paid retry action; proposed cost is one run |
| Key unavailable | Link to the Account mock to connect/reconnect Claude (production uses `/account`); overview still works |
| Quota exhausted | Show actual usage and renewal information returned by the usage system; overview still works |
| Failed | Show a bounded error and actual charge/refund status; offer explicit retry only when usage is settled; proposed example refunds the failed run, retry reserves one run |
| Provider unavailable | Keep known identity and available facts; identify missing quote/history; no invented series. Analyze stays enabled when only overview data failed; research independently checks its own snapshot/eligibility and refuses without charge if unusable |
| Not owned / removed | Owner-scoped 404; no company data, job status, or quota leak |

One company must not silently fall back to a full scan. A researched company that receives a
WATCH or no-opportunity outcome must not be represented as a BUY just to reuse the report UI.
The existing Workbench cannot be assumed to represent every evaluated outcome. Keep its report
link only for a compatible saved report; otherwise show the saved no-opportunity conclusion and
research date on the basic page. A deterministic eligibility refusal returns a reason before paid
research and must not consume a run. Persist whether research actually ran so the UI can distinguish
an admission refusal from a researched non-opportunity after Redis job expiry.

## Proposed backend work

Read the architecture spec and scoped AGENTS.md again before implementation. Proposed endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /discover/{ticker}/overview` | Bounded owner-only identity/profile and quote for a saved company |
| `GET /discover/{ticker}/history?range=1m` | Owner-only ticker-keyed series, reusing existing range limits and major-unit conversion |
| `POST /discover/{ticker}/analyze` | Explicit single-company request; 202 with existing job ID shape |
| `GET /discovery/run/{job_id}` | Reuse owner-scoped job polling, extending the result contract if needed |

The three ticker routes are proposed; the owner-scoped polling route already exists. Keep provider
calls cached and concurrency-bounded. Return dated major-unit prices and the same explicit
missing/stale semantics as Discover; no guessed units.
Use distinct JSON field names for provider facts and research outputs.

Reuse `require_claude_key`, the shared `analysis_run` quota, existing client resolution (including
admin policy), job ownership checks and timeout. Validate watchlist ownership before charging
quota. Implement the approved cost/refund rules above, with one idempotent reservation settlement
per job rather than another counter. Unknown settlement status disables retry and shows usage
pending; reconnecting or polling must not issue another refund. Today `discovery/jobs.py` refunds
only `SnapshotUnavailable`; it does not provide the proposed general post-start failure policy.

### Existing analysis path and shared lock

`POST /analysis/run` already accepts one owned watchlist ticker through `_build_ticker_infos`
(`routers/analysis.py`). It uses the holdings graph, stores `source="manual"` recommendations
without a discovery `IdeaOut`, and has `AnalysisAlreadyRunning` / `analysis_active` in
`agents/jobs.py`. Discovery has a separate `discovery_active` marker. Neither is currently a
shared lock. `routers/discover.py:_analysis` only associates `source="discovery"` reports.

The proposed Discover route is a thin entry point into the discovery candidate evaluator because
the chosen Workbench expects its structured citations, peers, risks and portfolio fit. Calling
the holdings endpoint unchanged would produce a different report contract and would not update
Discover. Do not build a third research engine or change the existing holdings report format.
The Analysis PR must consolidate admission into one atomic per-user active-job claim used by
manual holdings analysis, discovery scans and single-company research, including scheduled entry
points. Release/renew only the owning job's claim and refund refused reservations. A request for
the already-running company reconnects to that job; a conflicting run is refused before paid work.

Single-company compatible reports retain `source="discovery"` with explicit single-company job
provenance. Discover also reads the proposed persisted company outcome for no-opportunity and
ineligible states. Existing manual reports keep their current association rules; this PR does not
silently relabel them or promise that they become discovery reports.

### Snapshot and candidate preparation (new work)

`evaluate_scan` loads the static universe, cached snapshots, user shortlist and admitted mentions.
It cannot be invoked unchanged for an arbitrary saved ticker. Add a bounded single-ticker builder:
load only the requested ticker's cached snapshot; if absent, unreadable or stale, fetch that ticker
through the existing `fetch_yfinance` / `to_snapshot` normalization and recheck freshness, currency,
instrument safety and user eligibility before reserving paid research. Missing data returns a
bounded refusal, never an invented snapshot. Resolve listing country from validated provider
metadata when absent from the universe; unknown metadata must follow explicit eligibility rules.
Build the candidate without universe ranking or mention admission. Read the existing bounded peer
snapshot context and user portfolio context for peers/fit; do not refresh the full universe or start
global paid theme searches. Extract the per-candidate evaluation from `evaluate_scan` for both
callers only after this builder exists. Test an owned ticker outside the static universe explicitly.

Do not call full-scan `save_scan` unchanged: its scan summary and supersession semantics describe
a full scan. A one-company write must not supersede unrelated ideas, replace the latest market-scan
summary, or erase exclusions for other tickers. Save report provenance and update only the selected
company's report association. `save_scan` only persists qualifying `is_opportunity` ideas as
recommendations; its ScanRun exclusions do not supply a durable single-company outcome.

Propose a separate owner-scoped company-analysis outcome record: user, ticker, job ID/provenance,
completion time, whether research ran, outcome (report / no opportunity / ineligible), bounded
reason or validated conclusion, nullable report association and admission-input fingerprint.
Persist it atomically with any report. Admission refusals cost zero and record the inputs needed
to recognize a changed-data retry; researched non-opportunities persist even without a
Recommendation. Discover and overview read this record after the Redis job expires. A failed job
must not erase an earlier completed outcome. A fingerprint is not a license to auto-run research.
Generate the schema migration with Alembic; include owner-only RLS, runtime grants, export and
account-deletion coverage. Never hand-edit an existing revision. This schema is a proposal; update
ARCHITECTURE.md when the approved implementation changes the actual data/API/agent contracts.

Research/provider text stays untrusted, owner-scoped and bounded. Retain citation validation and
safe-link handling. Request an independent security-reviewer subagent for the implementation,
especially for any changed research prompts, new ownership checks or quota paths.

## Delivery and acceptance

1. **This PR:** approve the visual proposal and policies; #194 remains open until approval and
   any follow-up backend tickets are recorded. This PR does not close #193.
2. **Overview PR:** ticker-keyed profile/history APIs and the basic page, with no paid action yet.
3. **Candidate preparation PR:** single-ticker snapshot/eligibility builder, including outside-universe
   tickers and bounded peer/portfolio context; no paid UI action yet.
4. **Analysis PR:** shared candidate evaluator, atomic lock across all three entry paths, approved
   quota settlement, generated outcome migration and persistence; then Discover and overview
   actions/report navigation. Update ARCHITECTURE.md to the actual contract.

Tests must prove: non-watchlist and other-user requests are refused before paid work; one click
spends one run; duplicate/concurrent full and single runs share one lock; provider/key/admission
failures follow the refund policy; a single run never researches an unrelated ticker or supersedes
another company's idea; mixed-currency history is honest; a researched non-BUY outcome is shown
accurately; reconnecting to a job and navigating away work; and unknown/stale/provider-failure
states remain usable. Add light/dark browser checks at desktop, 390px and 320px, including keyboard
focus and the long-name case. Run scoped lint, typecheck, tests and frontend build.

Also prove that manual holdings and scheduled jobs contend on the same lock; an out-of-universe
watchlist ticker can be prepared without a global scan; persisted ineligible and researched
non-opportunity outcomes survive job expiry and page reload; unchanged admission refusals cannot
spend quota again; and timeout, key rejection and persistence failure after research starts settle
usage exactly once under the approved policy. Lost settlement status must not enable a paid retry.
