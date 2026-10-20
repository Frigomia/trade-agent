# Today: three options built on the "Invest" reference

Status: option 2 (Soft) chosen as-is on 2026-10-20 (see `direction-approved.md`). Written 2026-10-20. Supersedes the first round (`a-gallery`, `b-pulse`, `c-ledger`, see `SPEC.md`), whose backend mapping (gaps 1 to 9) still applies. Nothing here is implemented in `frontend/`. All companies are fictional and logos are monogram placeholders.

Only the chosen option's screenshots (`shots/v2b-*`) are committed; the others regenerate with `./shootall.sh` (the three v2 options) or `WIN=1500 ./shootall.sh v3-evidence:v3`; `shots/.gitignore` keeps the rest out of git. Set `CHROME` if Chrome is not at the default Windows path.

Open `v2-a-lean.html`, `v2-b-soft.html` or `v2-c-evidence.html` (add `?theme=light` or `?theme=dark`, and `?only=desk|phones|states`). Screenshots are in `shots/` (`v2a|v2b|v2c` + `desk|phones|states` + `dark|light`); `./shootall.sh v2-a-lean:v2a v2-b-soft:v2b v2-c-evidence:v2c` regenerates them. Shared code: `lib.css`, `lib.js`, `v2.css`, `v2.js`.

## What all three keep from the reference

Search bar, big "Today" title with a one-line subtitle, a compact "Latest AI scan" bar, a Top opportunity card, three Other opportunities cards with "View all", then Portfolio alerts and Watchlist insights side by side, and a one-column phone version.

## What all three change, and why

- **No stock photo.** It is decorative and tells the reader nothing about the company; the logo carries identity.
- **"Confidence", not "conviction".** The backend field is `confidence` (high, medium, low), computed from data coverage. "Conviction" would sound like the AI's belief. Shown as a three-segment meter plus the word, never colour alone. Risk the same way.
- **No emoji flags.** A globe icon plus the country name.
- **Emerald and coral mean rise and fall in data.** Day change shows sign, arrow and colour, and the "New insight" pill is neutral. Caveat: options 1 and 3 keep the app's existing teal accent for links, buttons and the active nav item, and in dark that teal is the same colour as a rise (as in the current app). Option 2's blue avoids the clash; for 1 and 3 the sign and arrow carry the meaning. Decide whether to accept that or give controls a different colour.
- **"N set aside", not "N excluded".** Screening excludes hundreds of companies. The number shown is the researched candidates that were not recommended (researched minus opportunities). Hover text explains it.
- **Price date.** Cards say "Prices at Mon close" once (sample data: a scan on Tuesday morning) in the section heading; the Top opportunity shows it next to the price.
- **AI text stays in the dashed box**, labelled with its cited-source count, apart from computed numbers. The advisory line closes every screen.
- **Refresh button** shows runs used this month ("23 of 100 runs"); its accessible label says it costs one run.

## The three options

| | 1 · Lean | 2 · Soft | 3 · Evidence |
|---|---|---|---|
| Idea | The reference layout in the app's own tokens | The reference's own look: light, airy, blue, soft shadows, round logos | Reference layout, but the Top opportunity shows why |
| Top opportunity | Identity, price, chips, AI box, button | Same content, larger, tinted card, circular go button | Adds three score bars (quality, valuation, fit), catalysts with sources, risk flags |
| Other cards | Chips, one line, research and save | Same, softer | Same plus one overall score bar |
| Phone | One column | One column | Tabs (Ideas, Alerts, Watchlist) and a swipe row of cards |
| Theme | Dark and light, teal | Light first, blue; navy dark | Dark and light, teal |
| Effort | Lowest | Medium; changes DESIGN.md palette | Highest; needs catalysts and flags in the response |
| Risk | Looks like the current app, least new | Largest brand change | Densest; the card gets long on a phone |

## Backend needs introduced or confirmed by this round

Existing gaps (see `SPEC.md`) still apply: ranking (3), identity block (4), logo source (5), one-sentence headline (6), nearest-miss names (7), Save meaning (8), alerts for holdings (9).

New or sharper in this round:

- **Day change and price** are not in `IdeaOut`. Fetch from the existing quote endpoint per ticker, or store at scan time with its date. GBp quotes need minor-unit conversion.
- **Set-aside count** is derivable (`researched - opportunities`); expose it on `ScanRun` to avoid recomputing.
- **Alert pills** (Up next, Positive move, New insight) need a typed `kind` on each alert: earnings upcoming, move since purchase, new recommendation. Only "New insight" (a recommendation on a holding) has a source today.
- **Watchlist insights** (Watch, Monitor actions) need a watchlist feature and the same alert source as holdings.
- **Search bar** is new. The closest existing feature is Chat; decide whether it opens Chat, searches tickers, or is dropped.
- **Option 3 only:** the Top opportunity needs `catalysts` (already in `IdeaOut`, with a URL each) and `risk_flags` (already in `risk`); the three scores exist.

## Decisions for you

1. Which option, or a mix (for example 1's layout with 3's Top opportunity).
2. For option 2: accept a blue accent, which changes DESIGN.md, or keep teal.
3. Keep the search bar, and what it does.
4. Keep Save and the Discover destination in this plan.
5. Wording: "confidence" (recommended) or "conviction".

`direction-approved.md` is written only after a choice.

## Archived: visual brief applied to option 3 (`v3-evidence.html`)

Not the chosen direction: the choice moved to option 2 as it was. Kept in case the visual brief is applied to the chosen design later. It defines its own navigation and phone tabs; do not reuse the shared `navItems()` and `Phone()` helpers in `lib.js`, which still include the Discover item.

The chosen option was restyled to the "Visual Redesign Only" brief. Where the brief and the earlier content brief disagreed, the visual brief won:

- Removed: search bar, Discover navigation item, Save to Discover, phone tabs and swipe row (all were new behaviour; the brief forbids new features, navigation changes and horizontal scrolling).
- Kept as the real shell: the existing navigation items (Today, Portfolio, Plan, Chat, Track record, Backtests, Preferences, Account), Run analysis, theme toggle, and the three summary tiles (portfolio value, vs cost basis, awaiting you). The value chart and the To review list are not redrawn; the mock marks them as existing and restyled only.
- Still new content, not just styling, so it depends on backend work and is outside a pure visual task: Latest AI scan bar, Top opportunity, Other opportunities, Portfolio alerts, Watchlist insights. The brief's rule against adding features and the discovery plan conflict here. Decide whether these ship in the visual pass (with the data they need) or after it. Gaps 3 to 9 in `SPEC.md` and the new needs above still apply.
- Deviations to approve: the Top opportunity name is 20 px (brief says company names 16 px) so the featured card leads; the dark theme uses a blue accent (no neon) with the same layout; the logo is a dashed placeholder because the bull logo file is not in the repo (`frontend/public` has only starter assets).
- Contrast: #64748B on #F7F9FC is about 4.5:1 (secondary text only, 13 px and up).
- Implementation note for `frontend/`: express the colours as theme tokens (existing `buildMuiTheme` and CSS variables), not literals in components.

## Soft, dark theme (chosen direction)

Dark is a full theme of option 2, not an inversion: the same layout and radii, a navy base instead of the teal-black of the current app, and the blue accent lifted for contrast. View it with `v2-b-soft.html?theme=dark` (the theme button also flips it); screenshots are `shots/v2b-desk-dark.png`, `v2b-phones-dark.png`, `v2b-states-dark.png`.

| Token | Light | Dark |
|---|---|---|
| Page background | `#f5f7fb` | `#0c1426` |
| Card | `#ffffff` | `#131d36` |
| Text, secondary, muted | `#0f1a2e`, `#34425c`, `#5d6b85` | `#e9eefb`, `#c2cce3`, `#92a0bd` |
| Accent (links, buttons, active nav) | `#2457d6` | `#7ea3ff` (buttons use dark text on it) |
| Rise, fall (price change only) | `#067a52`, `#c8323d` | `#34e7a9`, `#ff6b72` |
| Caution (failed scan, risk flags) | `#9a5b00` | `#f4c04f` |
| Card edge | soft shadow | 1 px low-contrast line, no glow |

Rules that carry over: blue is the only accent, so a link or button never looks like a price rise; the dashed AI box, confidence and risk meters (shape plus word) and the advisory line are the same in both themes. The hero's tint is the accent mixed into the card colour (about 11 percent), so it stays quiet in dark.

Checked on the states grid in dark: no clipping in the narrow regions (a defect found this round, fixed for all three options), and the refresh button no longer wraps.

Build note: these are values for the theme tokens the app already has (`buildMuiTheme`, CSS variables), light and dark side by side; do not put them in components.
