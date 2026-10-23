# Company overview: three options (option 3, Workbench, chosen)

> Cleanup note (2026-10-21): the options that were not chosen, and the old screenshot scripts, were removed from this folder. They are in git history before commit `18ce2f5`; read any mention of them below as history. Regenerating screenshots: see [../README.md](../README.md).

Status: option 3 (Workbench) chosen on 2026-10-20, see `direction-approved.md`. Written 2026-10-20. The page opens from a Today card (`/today/[id]` area). Uses the chosen Soft direction (light and dark, blue accent). Nothing here is implemented in `frontend/`. The company, its numbers and the sources are fictional.

Open `co-a-dashboard.html`, `co-b-story.html` or `co-c-workbench.html` (add `?theme=dark`, and `?only=desk|phones|states`). Screenshots are in `shots/` (`coa|cob|coc` + `desk|phones|states` + `dark|light`); `WIN=1340 ./shootall.sh` regenerates them (headless Chrome; set `CHROME` if it is not at the default Windows path). Shared files: `soft.css` (theme), `co.css` (components), `co.js` (sample data and section builders); the shell comes from `../today-discovery/lib.css` and `lib.js`.

## The three options

| | 1 · Dashboard | 2 · Story | 3 · Workbench |
|---|---|---|---|
| Idea | The reference: one header card, then equal panels, all visible | One reading column in argument order, numbered rail, hairlines | A decision rail beside the evidence; evidence in four tabs |
| Order | Chart and thesis, cases, fundamentals and fit, peers and risk, sources | Thesis, cases, numbers, risk, fit, sources | Overview, Numbers, Risk and fit, Sources |
| Phone | One column, thesis first | Collapsible sections, thesis open | Tabs on top, actions in a bottom bar |
| Best for | Scanning everything at once | Understanding why before seeing numbers | Deciding quickly and returning to evidence |
| Risk | Longest page, dense on a phone | Numbers sit far down; needs the rail to jump | Evidence is one click away; four views to design and test |

How each came about: 1 follows the reference you gave, 2 is built like an article because the thesis is prose, 3 is built around the task (approve, save, dismiss, ask), so the controls never scroll away.

## Rules applied to every option

- Section order and wording follow your seven sections. Thesis is four sentences with "Read the full thesis" to expand.
- AI text (thesis, cases, risk narrative, fit narrative, community opinion) sits in the dashed box, labelled with its source count. Computed numbers (scores, fundamentals, peers, risk figures) sit outside it.
- Bull and bear claims carry a status as shape plus word: Confirmed, Disputed, Unverified (check, swap, question icons; solid, dashed, dotted edges). No red or green.
- Risk is shown as measured characteristics (volatility, biggest fall, size, liquidity, leverage, industry and geopolitical) with no safety score. The header still shows the risk level word and confidence meter, as on Today.
- Peer comparison is a range bar per metric (middle half of peers, median tick, company dot) with neutral wording: below, within or above. Lower is not marked as good.
- Portfolio fit shows "Not applicable" when the portfolio is empty and never invents a score.
- Sources are expandable: sources with tier and date, data timestamps and limits, unresolved or conflicting evidence, and unverified community opinion in its own box.
- Emerald and coral only mean a price rising or falling. Actions: Approve (existing), Save to Discover (named as on Today), Dismiss (existing), Ask AI (existing). Approve stays because every recommendation ends in a human decision.
- Fixes from the polish pass: sub-heading spacing, panel pairing in option 1 to remove dead space, "Last analysis" wording to match Today, 44 px targets on a phone, expanded Numbers section in option 2's data-limited state.

## What the backend gives each element (checked against `schemas_discovery.py`)

| UI element | Source today | Status |
|---|---|---|
| Name, ticker, sector, country, exchange, price, price date | `CandidateMetrics`; not stored on `IdeaOut` | Gap 4 from `../today-discovery/SPEC.md` |
| Daily change | Not in `IdeaOut`; existing quote endpoint | Needs a call per company |
| Logo | No logo or website field | Placeholder monogram (gap 5) |
| Confidence, risk level, scores, overall | `IdeaOut` | Exists |
| Last analysis date | `ScanRun.created_at` or the recommendation date | Exists |
| Thesis, outlook, bear case, fit narrative | `IdeaOut.thesis`, `outlook`, `bear_case`, `fit_summary` | Exists; thesis is up to 4000 characters, so a short version for the card needs a headline (gap 6) |
| Bull claims and catalysts | `IdeaOut.catalysts` (each cites a URL) and `sources` claims with stance | Exists; the mock's status on a bull claim has no field, only negative developments carry confirmed, disputed or unverified |
| Upcoming catalyst dates | Not a field | New |
| Negative developments with status | `NegativeDevelopment` (summary, date, evidence, impact, status, invalidates thesis) | Exists |
| Fundamentals | `CandidateMetrics.fundamentals` (raw dict) | Exists; interest cover and some ratios are missing, shown as "Not available" |
| Peer comparison | `PeerComparison` (value, median, p25, p75, position, count) | Exists; named competitor rows (as in the reference) are not available |
| Price chart | No price history on the idea | New: a history endpoint |
| Volatility, biggest fall, size, liquidity | `RiskProfile` (volatility, max drawdown 1y, size bucket, market cap and traded value in EUR) | Exists; shown in EUR |
| Leverage | A raw fundamental; no interest cover | Partial |
| Industry and geopolitical risk text | `risk_flags` plus research text | Partial; no dedicated field |
| Portfolio fit | `scores` fit and `fit_summary`; None when not applicable | Exists |
| Fit facts (weights before and after) | Not a field | New computed numbers |
| Sources with date and tier | `Claim` (url, published_at, source_tier, kind) | Exists; titles and domains need extraction |
| Data timestamps and limits | `data_notes`, `price_as_of` | Exists |
| Community opinion | `community_note`, forum claims | Exists |
| Unresolved or conflicting evidence | Disputed items among negative developments; no list | Partial |
| Save to Discover | No saved state or Discover screen | Gap 8 from the Today spec |
| Approve, Dismiss, Ask AI | Existing recommendation decisions and the Ask component | Exists |

## Decisions for you

1. Resolved: option 3, Workbench, was chosen (see `direction-approved.md`).
2. Partly resolved 2026-10-22: the price history (#159) and the fit facts (#160, #161) were added to the backend and built. Upcoming catalyst dates are open: [#198](https://github.com/Frigomia/trade-agent/issues/198).
3. Resolved 2026-10-22 (#160): the named-peer table is built, from the peer rows the backend saves with each idea (Numbers tab).
4. Open: bull claims carry no confirmed, disputed or unverified status: [#198](https://github.com/Frigomia/trade-agent/issues/198).
5. Resolved 2026-10-22: the Discover destination is in the plan, so Save to Discover stays (#170).

The direction is approved (`direction-approved.md`) and built; decisions 2 (catalyst dates) and 4 are open in #198.
