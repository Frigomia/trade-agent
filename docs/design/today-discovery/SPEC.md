# Today: discovery sections, three directions

> Cleanup note (2026-10-21): the options that were not chosen, and the old screenshot scripts, were removed from this folder. They are in git history before commit `18ce2f5`; read any mention of them below as history. Regenerating screenshots: see [../README.md](../README.md).

Status: design options for review, not yet chosen. Written 2026-10-20 after the Phase 7 backend landed (#134, #135).
Nothing here is implemented in `frontend/`. All companies in the mocks are fictional.

Open any of `a-gallery.html`, `b-pulse.html`, `c-ledger.html` in a browser (add `?theme=light` for the light theme,
`?only=desk|phones|states` for one section). Screenshots are in `shots/` (`a|b|c` + `desk|phones|states` + `dark|light`);
`./shootall.sh` regenerates them with headless Chrome. Shared tokens are in `lib.css` (copied from the existing
mocks and DESIGN.md), shared sample data in `lib.js`.

## What the Today screen needs

1. **Latest AI scan**: a compact bar above the opportunities (when it completed, how many opportunities, refresh and history).
2. **Top opportunity**: a featured card for the best idea of the latest scan.
3. **Other opportunities**: a compact list of the rest.
4. **Portfolio alerts**: what deserves attention on the user's holdings; hidden without holdings or alerts.
5. **Watchlist insights**: optional.

States designed for every direction, on desktop and a 390 px phone: ideas found, no compelling opportunity,
scan running, scan failed, Claude key needs attention, empty portfolio (alerts hidden, fit shown as unavailable).

## The three directions

| | A · Gallery | B · Pulse | C · Ledger |
|---|---|---|---|
| Idea | Quiet and curated: one exhibit, captions, hairlines | One number per card, big touch targets, feed first | The scan as data: funnel counts, score bars, one dense table |
| Best for | A calm, trustworthy daily check | A fast phone-first check | People who want to compare scores at a glance |
| Top opportunity | Large name, AI summary in a dashed box, facts as captions | Score tile, price, chips, dashed AI box, one button | Band with identity, AI box, three score bars |
| Other opportunities | Hairline rows, actions always visible | Cards with a small score tile and chips | Sortable-style table with inline bars; stacked rows on a phone |
| Alerts | Plain lines at the bottom | Side rail on desktop, cards below on a phone | Ledger rows with a type tag |
| Density | Lowest | Medium | Highest |
| Risk | Least information per screen | Largest touch area, most card chrome | Table is the hardest layout to keep clean on a phone |

How each came about (the design skill's three logics): A is the random style draw (white-gallery restraint, adapted so the
interface recedes), B follows a verified reference principle (Robinhood won an Apple Design Award in 2015 per its own newsroom;
only the principle is used, not its current look), C takes a named designer's lens (Edward Tufte, high data-ink ratio).
All three keep the app's tokens (Geist, the teal palette, 18 px panels, 14 px controls).

## Rules from DESIGN.md and PRODUCT.md that shaped the polish

- Emerald and coral mean rise and fall only. Confidence and risk are therefore shape plus words (a three-segment meter and the word), never red or green. Caution tones (amber) are used for alerts.
- Web-derived content sits in the dashed Web Opinion Box, apart from the computed numbers. The thesis and the "why now" line are inside the dashed box, labelled "AI research summary · N cited sources"; scores, confidence and risk are labelled as computed.
- No urgency styling, no glow, no Buy or Sell control. Every region ends with the advisory line ("not investment advice… nothing is sent to a broker").
- Controls are real links and buttons with a visible focus ring; phone tap targets are 44 px; confidence is never dots alone.

## What the backend gives each element (checked against the code)

| UI element | Source today | Status |
|---|---|---|
| Scan time, researched / shortlisted / eligible / screened counts | `ScanRun` (`created_at`, `researched`, `shortlisted`, `eligible`, `universe_size`) via `GET /discovery/ideas` → `latest_scan` | Exists |
| "N opportunities" | Not a field. The summary text says it; the count of pending discovery recommendations from that scan is the same number | Gap 1: add `opportunities` to `ScanRun`, or count server side |
| Scan history | `GET /discovery/ideas` returns only the latest scan | Gap 2: a list endpoint |
| Refresh, progress, errors | `POST /discovery/run` (202), `GET /discovery/run/{job_id}` with `stage`, `total`, `done`, fixed error strings | Exists |
| "1 of 100 runs" | `GET /me/usage` (`analysis_runs.used`, `.limit`) | Exists |
| Which idea is top | `GET /discovery/ideas` returns recommendations newest first, not ranked | Gap 3: rank on the server (the code exists in `rank_ideas`) or return a `rank` |
| Company name, ticker, asset type | `IdeaOut` | Exists |
| Sector, country, exchange, currency, price, price date | On `CandidateMetrics`, which is not stored with the idea. `IdeaOut` has none of them, and `price_at_recommendation` is not set for discovery recommendations | Gap 4: keep a small `identity` block (and the price with its as-of date) on the saved idea. A GBp quote needs the minor-unit conversion before display |
| Company logo | No logo and no website field anywhere | Gap 5: decide a source (a logo service keyed on a verified domain, or the monogram placeholder the mocks use) and carry a `website` field |
| One-sentence thesis, one-line "why interesting" | `thesis` is up to 4000 characters of prose; no headline | Gap 6: add a `headline` (one sentence) to the synthesis, or show the first sentence |
| Main catalyst | `catalysts[0]`; each catalyst contains a plain URL by rule, so the UI must strip or link it | Exists, with a rendering rule |
| Confidence, risk, scores | `confidence`, `risk.risk_level` and `risk_flags`, `scores` (quality, valuation, fit, `None` when unavailable), `overall` | Exists |
| Nearest misses (no compelling opportunity) | `coverage_summary.nearest_misses`: ticker, overall, confidence only | Gap 7: add names |
| Save to Discover | No Discover screen and no saved state; recommendations are PENDING, APPROVED, REJECTED or SUPERSEDED | Gap 8: decide what Save means (a status, the watchlist, or a new saved flag) |
| Approve and Dismiss | Existing recommendation decisions | Exists; stays on the full analysis page |
| Portfolio alerts: new AI recommendation on a holding | Existing scheduled recommendations | Exists |
| Portfolio alerts: news, earnings, thesis change, new risk | Nothing produces these for holdings. Research runs per discovery candidate only | Gap 9: the largest piece, a new backend phase (research on holdings, compare with the approved thesis, only meaningful events) |
| Watchlist insights | Same as alerts, for the watchlist | Gap 9, optional |

## Decisions for you

1. Which direction, or a mix (for example B's phone feed with C's table on desktop).
2. The type ramp: the mocks add a 15 px "lead" step for the main reading text, and A adds a 32 px display step for the featured name. Both are outside DESIGN.md's ramp; keep them (and update DESIGN.md), or snap to the existing steps.
3. A new **Discover** destination appears in the navigation (marked "new"). It does not exist yet. Keep it in this plan or drop "Save to Discover" for now.
4. Whether the scan can say "you can leave this page": true on the server (the job keeps running), but the current Today page keeps the job id only in memory, so the front end must store it.
5. Refresh costs one monthly run. The mocks say so on the button ("1 of 100 runs"); confirm that is the wording you want.

## Next step

No `direction-approved.md` is written yet: it is created once a direction is chosen. After that the plan is to build the chosen
direction in `frontend/` against the gaps above, starting with Gaps 3, 4 and 6, which change what the Top opportunity card can show.
