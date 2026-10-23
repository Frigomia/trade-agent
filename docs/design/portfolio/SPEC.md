# Portfolio page: three options (option 3, Explorer, chosen)

> Cleanup note (2026-10-21): the options that were not chosen, and the old screenshot scripts, were removed from this folder. They are in git history before commit `18ce2f5`; read any mention of them below as history. Regenerating screenshots: see [../README.md](../README.md).

Status: option 3 (Explorer) chosen on 2026-10-20, see `direction-approved.md`. Written 2026-10-20. Uses the chosen Soft direction (light and dark, blue accent) and the existing navigation (Today, Discover, Portfolio, Plan, Chat, ...). The page keeps the existing segmented views (Holdings, This month, Saved plans, Orders); the options redesign the Holdings view. Nothing here is implemented in `frontend/`. Holdings, numbers and logos are fictional (monogram placeholders); all amounts are EUR.

Open `pf-a-dashboard.html`, `pf-b-holdings.html` or `pf-c-explorer.html` (add `?theme=dark`, and `?only=desk|phones|states`). The donut tabs, legend, range tabs, advanced analytics and the row menu work in the browser (option 3 also filters the holdings from the legend). Screenshots are in `shots/` (`pfa|pfb|pfc` + `desk|phones|states` + `dark|light`) and are not tracked; `WIN=1340 ./shootall.sh` regenerates them (headless Chrome; set `CHROME` if it is not at the default Windows path). Shared files: `pf.js` (data and builders), `pf.css`; the theme and shell come from `../company-overview/soft.css`, `co.css` and `../today-discovery/lib.css`, `lib.js`.

## The three options

| | 1 · Dashboard | 2 · Holdings first | 3 · Explorer |
|---|---|---|---|
| Idea | The reference: value and chart, allocation donut and risk facts across the top; holdings and largest positions below | The table is the page; a value strip above, donut and risk in a right rail | Allocation first: a large donut; selecting a legend row filters the holdings below |
| Best for | Seeing everything at once | Checking what I own and how it is doing | Understanding where the money is |
| Phone | One column: overview, holdings, allocation, risk | Strip, holdings, allocation, risk | Strip, donut with tabs, holdings, risk |
| Risk | Densest; the donut card is small | Allocation sits off to the side | Filtering is the least obvious feature and needs a hint; most to build |

How each came about: 1 follows the reference you gave, 2 is built around the most common task (look at positions), 3 is built around the question the allocation answers (which group holds my money).

## Rules applied to every option

- Overview shows total value, total gain or loss in EUR and %, today's change, and a value chart. Gain or loss is "Not available" with a hint when no purchase prices exist, and a holding without a purchase price is named as left out of the total; never a made-up zero.
- The chart waits for enough history (the mock uses 7 days) and says so instead of drawing a line.
- Holdings rows show company and ticker, shares, position value, gain or loss, and weight. The name opens the details; a row menu offers Edit holding, Log a trade and Remove holding. Removing asks first and says it does not sell anything.
- Allocation has Sector, Country and Currency tabs on one donut with percentages and values, plus largest positions. Hovering or focusing a legend row dims the other slices, so the chart never relies on colour alone; the legend lists names and percentages beside the swatches.
- Risk is facts, not a score: volatility, largest position, top three together, effective holdings, average correlation with the highest pair, and the biggest fall in the last year. Advanced analytics (a correlation table with the numbers printed, and the spread across sectors, countries and currencies) expands on demand. The page states there is no overall health score; the reference's health ring is left out on purpose.
- Emerald and coral are used only for a value rising or falling (always with a sign and an arrow). Donut colours are blue, violet and cyan tones, with no green or red.
- Fixes from the polish pass: a wider name column in the table (weight bars hidden where the table is narrow), the column header hidden in narrow layouts, the correlation table's contrast in dark, keyboard access to the legend, and "Add purchase price" spelled out.

## What the backend gives each element (checked against `frontend/lib/api/portfolio-types.ts` and `backend/app/schemas.py`)

| UI element | Source today | Status |
|---|---|---|
| Holdings: name, ticker, shares, market value, unrealized P/L and %, weight, sector | `HoldingSummary` via `/portfolio/summary` | Exists |
| Total value, total cost, total P/L and % | `PortfolioSummary` | Exists; totals cover priced holdings only and say how many are left out (`unpriced_count`) |
| Currency of the total | Not stated on the summary; the plan screens convert to EUR | Confirm that the summary is in EUR, or add the currency |
| Cost basis optional | The latest onboarding change makes purchase details optional; `HoldingSummary.cost_basis` is a number today | Needs the field to allow "unknown" and the totals to skip those holdings |
| Today's change | Not in the summary | New: a per-holding previous close, or a daily snapshot comparison |
| Value chart | `/portfolio/snapshots` (value and cost per snapshot) | Exists; "enough history" needs a rule |
| Country and currency per holding | Not on `HoldingSummary` (sector is) | New fields, or look them up from the instrument data |
| Allocation by sector | Computed from sector and market value | Exists |
| Volatility, correlation, effective holdings, biggest fall | Not computed anywhere | New: an analytics endpoint from price history (built, #165 and #172) |
| Edit, remove, log a trade, add holding, add purchase price | Existing `HoldingForm`, `TradeSheet`, `FirstHolding` | Exists; the remove confirmation copy is new |
| Watchlist, targets | Existing (`target_weight`, watchlist toggle) | Not shown in these mocks. Resolved 2026-10-22: the watchlist panel and toggle left Portfolio (watching is Discover's job); a holding keeps its own target |

## Decisions for you

1. Resolved: option 3, Explorer, was chosen (see `direction-approved.md`).
2. Resolved 2026-10-22 (#165, #172): volatility, correlation, effective holdings and the biggest fall are built. With a short history they show as unavailable, not as a partial figure: fewer than 60 matching return intervals gives no volatility or biggest fall (`backend/app/analysis/portfolio.py`).
3. Resolved 2026-10-22 (#165): country comes from the instrument's profile lookup and currency from the quote, not stored fields. Risk weights use each holding's current EUR value; a holding with no usable conversion is left out and named.
4. Resolved 2026-10-22 (#180): the four views stay and are the Soft pill track (Holdings, This month, Saved plans, Orders), with Holdings as the redesigned view.
5. Resolved 2026-10-22: the watchlist toggle and panel were removed from Portfolio. Editing a saved company's target and price range moved to Discover (built, #174 and #175).

The direction is approved (`direction-approved.md`) and built; every decision above is resolved.
