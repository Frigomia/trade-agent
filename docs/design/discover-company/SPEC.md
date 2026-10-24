# Analyze a company from Discover

Proposal, 2026-10-24. Groups #193 and #194 into one user journey, delivered in small PRs.
This is a design and implementation plan, not a change to the shipped API or agent behavior.

## User journey

1. A company without a report has a linked name and an **Analyze** action on Discover.
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

Desktop: identity and quote above a chart/facts column and a narrow research panel. Phone: one
column, research panel immediately after identity, followed by chart and facts. Actions are at
least 44px high. The chart has a textual equivalent. Unknown values say Unavailable.

## States and policy

| State | UI and behavior |
|---|---|
| Ready | Provider facts and dated quote; explicit Analyze with one-run cost |
| Running | Analyzing and stage; no second Analyze; navigation remains possible |
| Report saved | View report; update Discover's report/status fields |
| No report | Explain why the company could not be evaluated or did not pass admission; do not invent a BUY or show AI analyzed without research |
| Key unavailable | Connect/reconnect Claude; overview still works |
| Quota exhausted | Show actual usage and renewal information returned by the usage system; overview still works |
| Failed | Safe error and retry action; retry is a new explicit request, never automatic |
| Provider unavailable | Keep known identity; say which quote/history/facts could not load; never draw an invented series |
| Not owned / removed | Owner-scoped 404; no company data, job status, or quota leak |

One company must not silently fall back to a full scan. A researched company that receives a
WATCH or no-opportunity outcome must not be represented as a BUY just to reuse the report UI.
The implementation must decide which evaluated outcomes the existing Workbench can represent;
extend its contract explicitly if needed. A deterministic eligibility refusal should return a
reason before paid research and must not consume a run.

## Proposed backend work

Read the architecture spec and scoped AGENTS.md again before implementation. Proposed endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /discover/{ticker}/overview` | Bounded owner-only identity/profile and quote for a saved company |
| `GET /discover/{ticker}/history?range=1m` | Owner-only ticker-keyed series, reusing existing range limits and major-unit conversion |
| `POST /discover/{ticker}/analyze` | Explicit single-company request; 202 with existing job ID shape |
| `GET /discovery/run/{job_id}` | Reuse owner-scoped job polling, extending the result contract if needed |

These routes do not exist yet. Keep provider calls cached and concurrency-bounded. Return dated
major-unit prices and the same explicit missing/stale semantics as Discover; no guessed units.
Use distinct JSON field names for provider facts and research outputs.

Reuse `require_claude_key`, the shared `analysis_run` quota, existing client resolution (including
admin policy), job ownership checks, timeout and active-run lock. A full scan and single-company
analysis must share that lock. Validate watchlist ownership before charging quota; refund exactly
once on admission, key resolution or job-start failure, using the existing paid-work policy for
failures after research starts. Define and test refund behavior rather than adding a second counter.

Extract only the existing per-candidate research/evaluation path needed by both runners. Explicit
Analyze must accept the requested watchlist ticker even if it is not on the static universe, but
still resolve a usable snapshot, perform safety/eligibility checks and build peers/portfolio fit.
It must not rank the entire universe or launch global paid theme searches.

Do not call full-scan `save_scan` unchanged: its scan summary and supersession semantics describe
a full scan. A one-company write must not supersede unrelated ideas, replace the latest market-scan
summary, or erase exclusions for other tickers. Save report provenance and update only the selected
company's report association. Decide whether the existing tables suffice; generate any required
migration with Alembic, never hand-edit an existing revision.

Research/provider text stays untrusted, owner-scoped and bounded. Retain citation validation and
safe-link handling. Request an independent security-reviewer subagent for the implementation,
especially for any changed research prompts, new ownership checks or quota paths.

## Delivery and acceptance

1. **This PR:** approve the visual proposal and policies; #194 remains open until approval and
   any follow-up backend tickets are recorded. This PR does not close #193.
2. **Overview PR:** ticker-keyed profile/history APIs and the basic page, with no paid action yet.
3. **Analysis PR:** shared candidate runner, job/quota/persistence behavior, then Discover and
   overview Analyze actions and report navigation. Update ARCHITECTURE.md to the actual contract.

Tests must prove: non-watchlist and other-user requests are refused before paid work; one click
spends one run; duplicate/concurrent full and single runs share one lock; provider/key/admission
failures follow the refund policy; a single run never researches an unrelated ticker or supersedes
another company's idea; mixed-currency history is honest; a researched non-BUY outcome is shown
accurately; reconnecting to a job and navigating away work; and unknown/stale/provider-failure
states remain usable. Add light/dark browser checks at desktop, 390px and 320px, including keyboard
focus and the long-name case. Run scoped lint, typecheck, tests and frontend build.
