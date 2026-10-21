# Discover (watchlist): three options (option 1, List, chosen)

> Cleanup note (2026-10-21): the options that were not chosen, and the old screenshot scripts, were removed from this folder. They are in git history before commit `18ce2f5`; read any mention of them below as history. Regenerating screenshots: see [../README.md](../README.md).

Status: option 1 (List) chosen on 2026-10-20, see `direction-approved.md`. Written 2026-10-20. Uses the chosen Soft direction (light and dark, blue accent) and the existing navigation (Discover appears between Today and Portfolio, as in the approved Today direction). Nothing here is implemented in `frontend/`. Companies, prices and insights are fictional; logos are monogram placeholders.

Open `dc-a-list.html`, `dc-b-table.html` or `dc-c-cards.html` (add `?theme=dark`, `?only=desk|phones|states`, and `?q=hal` to open the desktop with a search typed). Everything works in the browser: type in the search (try `kes`, `hal`, `nvk`, `zzz`), Add, Analyze (a fake 1.4 second run), Remove with Undo, the filters and the sort. Enter adds the first result and Escape clears the search. Screenshots are in `shots/` (`dca|dcb|dcc` + `desk|phones|states` + `dark|light`) and are not tracked; `WIN=1340 ./shootall.sh` regenerates them (headless Chrome; set `CHROME` if it is not at the default Windows path). Shared files: `dc.js` (data, behaviour, builders), `dc.css`; the theme and shell come from `../company-overview/soft.css`, `co.css` and `../today-discovery/lib.css`, `lib.js`.

## The three options

| | 1 · List | 2 · Table | 3 · Cards |
|---|---|---|---|
| Idea | The reference as drawn: one card per company, left to right | One compact table; column headings are the sort; search is its first row | A board of cards, three across; the first tile is the add tile |
| Add | Search bar and Add Company on top | Search inside the table's first row | Search inside a dashed "Add a company" tile |
| Sort | Menu next to the filters | Click a column heading (Company, Daily change, Added); a menu on a phone | Menu next to the filters |
| Insight | One line under the name | One line under the name (small) | Up to three lines, room to read |
| Best for | A calm, readable list of 5 to 20 companies | Many companies, scanning down a column | A short list you want to look at |
| Risk | Longest per company | Densest; the insight is small | Fewest companies per screen; the add tile uses a column |

## Rules applied to every option

- Search by name or ticker. Picking a result fills in the name, exchange and currency; the user types none of them and enters no shares or cost (the hint under the search says so and names the difference from Add Holding).
- A company already in Discover shows "Already in Discover" instead of an Add button, so a duplicate cannot be added. The Add Company button adds the first result that is not a duplicate, or focuses the search when nothing is typed. No result says what to check.
- One unified list. Each company shows logo, name and ticker, exchange and currency, price and daily change (sign, arrow and colour, with the time), a status, and when it was added and where from (saved from Today or added by you). Companies saved from Today are in the list without any action.
- Status is shape plus word: "AI analyzed" (check, tinted), "Not analyzed" (dashed circle, dashed edge), "Analyzing" (dotted edge) while a run is going. The one-line insight appears only for analyzed companies, with a spark icon marking it as AI text.
- Actions: View (analyzed: opens the investment report) or Analyze (not analyzed: runs the research once and says it uses 1 of the monthly runs), and Remove. Clicking the name opens the report when one exists, otherwise a simple company overview. Remove is immediate and offers Undo, and says it only leaves this list.
- Filters are All, AI analyzed and Not analyzed with counts; sort is Name, Daily change (highest first) and Recently added (newest first). No screener, no opportunity feed.
- States designed for each option, on desktop and a 390 px phone: empty watchlist, search with a company already added, search with no result, no match for the filter, loading, research running, removed with Undo. A company with no price shows "Price unavailable" and how to proceed.
- Emerald and coral are used only for a price rising or falling (always with a sign and an arrow). Every region ends with the advisory note: prices are delayed, insights are not investment advice, nothing is sent to a broker.
- Fixes from the polish pass: the search results are a plain list of real buttons (not a listbox with buttons inside), Enter and Escape in the search, a described-by hint on the input, table roles and sort state on option 2's columns, a shorter result subtitle (the currency was repeated), and stacked result rows inside option 3's narrow add tile.

## What the backend gives each element (checked against the repository)

| UI element | Source today | Status |
|---|---|---|
| Watchlist list, add, remove, note, target weight | `WatchlistSummary` (`ticker`, `asset_type`, `note`, `target_weight`, `current_price`) and `WatchlistItemIn` | Exists; `/portfolio/summary` returns `watchlist` with a price |
| Company name, exchange, currency | Not on `WatchlistSummary` (it has the ticker only) | New: resolve on add (Lane A already resolves candidates to name, exchange and currency) and store |
| Search by name or ticker | Lane A resolves and validates mentions and has a universe snapshot | New endpoint for interactive search over that data |
| Duplicate prevention | `uq_watchlist_user_ticker` (one row per user and ticker) already exists in `models.py` | Exists; the UI only has to show "Already in Discover" |
| Daily price change | Not on `WatchlistSummary` | New: previous close, or the quote endpoint's change |
| Added date and source ("from Today") | No created date or source on the watchlist item | New: `created_at` and a `source` (manual, today) |
| AI status and one-line insight | Discovery ideas (`IdeaOut`) exist per scan; there is no per-company research status | New: link a watchlist company to its latest idea or report; the insight needs a one-line headline (gap 6 in `../today-discovery/SPEC.md`) |
| Investment report / company overview | Opportunity detail is designed in `../company-overview/`; a simple overview is not designed yet | The simple overview is a new screen |
| Analyze (run research on one company) | The discovery scan runs on the whole universe; there is no single-company run | New, and it uses a monthly run (`GET /me/usage`) |
| Save from Today | The Save action on Today (Save to Discover) | New: writes a watchlist item with source `today` |
| Filters and sort | Computed from the fields above | Client side |

## Decisions for you

1. Resolved: option 1, List, was chosen (see `direction-approved.md`).
2. Whether single-company "Analyze" is in the first version (it needs a new backend path and spends a monthly run), or whether Discover only shows research that a scan already produced.
3. What the simple company overview contains when no report exists (price, chart, facts, and an Analyze button), since it is not designed yet.
4. Whether Remove needs a confirm step (the mocks use Undo instead).
5. How many companies the watchlist can hold, which decides whether the table or the cards are the better fit.

The direction is approved (`direction-approved.md`); the open questions above still need answers before the build.
