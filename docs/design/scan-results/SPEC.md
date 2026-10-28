# Scan results: what a scan set aside and why

Proposed 2026-10-28 for [#196](https://github.com/Frigomia/trade-agent/issues/196), Phase 9 of the market-discovery plan ("Scan results"). This is a mock and a plan, not a change to the app. Nothing is approved until the owner says so; then this folder gets a `direction-approved.md` like the others.

Mock: [scan-results.html](scan-results.html) (`sr.css`, `sr.js`; it loads the shared Soft files from `../today-discovery`, `../company-overview`, `../portfolio`, `../plan` and `../account`). Rows open and the filter works. Add `?theme=dark` to start dark; `?show=d-page,phones` shows only some blocks and `?st=2-4` only some states. Screenshots in `shots/`, light and dark: `entry`, `page-desk`, `phones` and `states`.

## Chosen skeleton

Four skeletons were drawn on the same content: a sectioned page, a single ledger, the funnel as the page and a list with a reader. The owner chose the **single ledger**: one list, one filter, every company the scan left out is a row. The reason is that the leftovers are all "a company and why", most need one line, and a few need a paragraph and links that can wait behind a click.

## What the backend already keeps

Nothing needs to be added to read the lists. `GET /discovery/ideas` already returns the latest scan with `excluded` (each: ticker, name, reason, explanation, evidence urls), `rejected_mentions` (each: the mention with its name, ticker hint, origin, the sentence that raised it and a url; and a reason) and `coverage_summary`. `docs/ARCHITECTURE.md` already documents it. The frontend type `ScanRun` just does not carry the first two yet.

What the lists contain, and what they do not (this decides the page):

| Stored | What it is | Is it counted in "N set aside"? |
|---|---|---|
| `excluded`, reason `thesis_invalidated` | Researched, then removed because a cited event broke the thesis | Yes |
| `excluded`, any other reason | Failed a safeguard before research (not enough data, price not reliable, identity unclear, currency) | No, they were never researched |
| `rejected_mentions` | Companies named by research that were not admitted as candidates | No |
| Researched, but below the score and confidence bar | Not saved today, except the three nearest misses when nothing qualifies | Yes |

So Today's "3 set aside" (researched minus opportunities) is a thesis-removed company plus companies that fell below the bar. Only the first is a stored list. The numbers on the new page match the scan bar exactly only if the below-the-bar companies are saved too (decision 2).

## The proposal

**The way in.** The scan bar on Today gains one link after the counts, "Scan results", shown whenever a saved scan exists, including while a new scan runs or after one failed (the page shows the last saved scan; with no scan the bar says "No scan yet" and has no link), and the "No compelling opportunity today" panel gets the same link. The page is a route of its own, `/today/scan`, with "Today" as the way back (a section under the ideas would make Today long for a scan that leaves out 30 companies).

**The page**, top to bottom:

1. **Counts, in one quiet line:** in the universe, eligible, shortlisted, researched, opportunities, set aside, from the saved counts, with a note that says where companies can drop out: failed a safeguard (in the list as Not researched), holdings and avoided sectors (left out by choice), no market data that week (a coverage note) and eligible companies ranked below the shortlist (not researched). The counts are the scan's own and are not forced to add up: companies admitted from research count as eligible although they are outside the universe. "Set aside" means researched but not recommended. A scan saved before the counts were kept shows a dash for the last two and a note saying so.
2. **The filter**, the shared pill control with counts: All, Set aside, Not researched, Mentions (`aria-pressed`). A filter with nothing in it says so in the ledger.
3. **The ledger.** One row per company the scan left out or did not admit, on a Soft panel: **Company** (name and ticker), **Where it fell out** (Set aside after research, Not researched, or Mention with its origin: Web search, Reddit, Industry research; a small dot in amber, none, or the accent) and **Why** (a reason chip). A thesis removal's chip is amber with an icon and the words "Thesis no longer holds"; every other reason is a quiet chip with its words. A row opens (`aria-expanded`) for the detail:
   - a thesis removal: the scan's explanation in the dashed box for web-derived text ("Written by the scan from the sources below. Check them before relying on it."), then the cited sources as links by host name. The explanation is long (the confirmed development, the reasoning and the impact), may name a url in its own text, wraps and shows as plain text;
   - below the bar: "Score 48 · Medium confidence. Researched, but it did not reach the score and confidence bar." A low-confidence fallback reads the same way, with its confidence word; it is never described as a thesis finding;
   - not researched: the stored explanation, with the first letter capitalised and a full stop;
   - a mention: the sentence that raised it in the dashed box ("From web search, not checked by us."), then the source link (none when the mention had no link).
   The first rows are listed (all of Set aside and Mentions; the first few of each Not researched group) and a "Show N more" button reveals the rest.
4. **Coverage notes:** only what the scan recorded: companies with no market data, old prices, unconfirmed prices, candidates that could not be evaluated, and whether research mentions were available. "Nothing to report" when empty.

**Words for the stored reasons** (new copy, one place in the build):

| Stored | Shown |
|---|---|
| thesis_invalidated / unreliable_price / ambiguous_identity / currency_unsupported / insufficient_data | Thesis no longer holds / Price not reliable / Company not clearly identified / Currency not supported / Not enough data |
| ambiguous / unresolved / no_price / currency_unsupported / insufficient_data / cap_reached / duplicate | Name matches several companies / No listed company found / No price available / Currency not supported / Not enough data / Over this scan's limit / Already in the scan or your holdings |

**Untrusted text.** The scan's explanation, the sentence behind a mention, names, tickers and urls come from providers or the web. They render as plain text (React text nodes, never HTML; the mock escapes them only because it builds strings), the web-derived ones in the dashed box, and a link is drawn only when `safeHref` accepts it (http or https), shown by host name with an external-link icon. Anything else is plain text. The "A link that is not safe" state is defence in depth: the backend already refuses non-http(s) urls, so it should not occur, and the build covers it with one unit test rather than a screen.

**States in the mock:** no scan yet, nothing set aside (filter on Set aside), a scan with no opportunity (all eight researched companies become set-aside rows), the below-the-bar companies not saved, an older scan without counts, a link that is not safe, a ledger with nothing in it, could not load. Light and dark, desktop and phone.

Rules kept from `DESIGN.md`: sizes in rem on the build, green and red only for a price move (the amber chip is the only colour here), shape plus word for every status (the dot is a second cue; the words carry the meaning), AI and web text in dashed boxes, 44px targets on a phone, no horizontal scroll at 390px and 320px. The mock draws the phone only inside its 390px frame; the breakpoints (the columns to a stacked row, 44px links) are the build's job and are checked in its browser pass at 320px.

## Decisions for you

1. **Approve the look and the route** (`/today/scan`, reached from the scan bar), or say what to change.
2. **Save the below-the-bar companies.** Today a researched company that misses the bar is not kept. To list them and make the page's numbers match "3 set aside", the scan would save up to eight small records (ticker, name, overall, confidence) as `set_aside_ideas` in `coverage_summary`, bounded by the shortlist size; no migration, no provider call. The existing `nearest_misses` keeps its rule (written only when nothing qualifies, as `docs/ARCHITECTURE.md` and the tests say) and is derived from the first three of that list, so the same data is not collected twice. The page reads `set_aside_ideas` and, for scans saved before it, falls back to `nearest_misses` and the stored exclusions only. Without it the page shows the same count with the note "N researched companies below the bar were not kept" (the fourth state in the mock). Recommended: save them.
3. **Payload size.** `excluded` holds every symbol that failed a safeguard (the 31 in the mock, more when the data is thin; 600 in the worst case) and already travels with `GET /discovery/ideas` on every Today load, a few hundred bytes each, tens of kilobytes at most. I would leave it for now, list a few rows per group with "Show N more", and measure a real scan before adding anything. The alternative is a separate endpoint for the lists (the page would call it, Today would not carry them). Say which you prefer.
4. **Build:** one PR for the frontend page and type, plus the small backend change if decision 2 is approved (with its test and the `ARCHITECTURE.md` line). Recommended: one PR.

## Build notes (after approval)

- Frontend: `lib/api/discovery-types.ts` (`Exclusion`, `RejectedMention`, `Mention` types and the two fields on `ScanRun`), `app/(shell)/today/scan/page.tsx` (reads the same SWR key as Today; a static `scan` segment takes precedence over the existing `today/[id]` route, so confirm that page and its test are unaffected), a `components/discovery/ScanResults*.tsx` set (the counts line, the filter, the ledger and its row), the link in `ScanBar` and `NoOpportunity`, and a small `lib/scanResults.ts` for the reason words, the row shape and the explanation text (capitalise the first letter and add a full stop only when the text does not already end in one; the scan's own thesis explanation is shown as written). Reuse `Panel`, `Pill`, `SegmentedControl` for the filter, `safeHref` and `hostOf`.
- Rows are buttons with `aria-expanded`; the ledger is not a `table` so the stacked phone layout needs no tricks.
- Backend (decision 2 only): `discovery/persistence.py` writes `set_aside_ideas` into `coverage_summary` for non-qualifying ideas and derives `nearest_misses` from it; `ScanRunOut` needs no change (it passes the dict through). Tests beside the existing persistence tests; the contract line in `docs/ARCHITECTURE.md`. Security review is not needed (no auth, RLS or prompt change).
- Keep every test that asserts text, roles or labels in `ScanBar` and `ScanStates`.
- A browser pass at 1280, 390 and 320px, light and dark, with a scan that has a long explanation, an unsafe url and a long list.
