---
name: Trade Agent
description: "A personal, advisory-only trading research app: calm soft panels, one blue accent for what you can act on, green and red only for a price moving."
status: "Approved direction (Soft, 2026-10-20). Tokens and shell are built; screens are restyled one by one, see Implementation status."
colors:
  light:
    cloud: "#f5f7fb"
    midnight-ink: "#0f1a2e"
    midnight-ink-soft: "#34425c"
    slate-muted: "#5d6b85"
    cobalt: "#2457d6"
    on-cobalt: "#ffffff"
    paper: "#ffffff"
    price-up: "#067a52"
    price-down: "#c8323d"
    amber-warn: "#9a5b00"
    cobalt-wash: "rgba(36, 87, 214, 0.09)"
    hairline: "rgba(15, 26, 46, 0.08)"
    hairline-strong: "rgba(15, 26, 46, 0.2)"
    track: "rgba(15, 26, 46, 0.06)"
  dark:
    deep-navy: "#0c1426"
    frost-text: "#e9eefb"
    frost-text-soft: "#c2cce3"
    mist-muted: "#92a0bd"
    periwinkle: "#7ea3ff"
    on-periwinkle: "#0a1530"
    navy-panel: "#131d36"
    price-up: "#34e7a9"
    price-down: "#ff6b72"
    amber-warn: "#f4c04f"
    periwinkle-wash: "rgba(126, 163, 255, 0.14)"
    hairline: "rgba(255, 255, 255, 0.07)"
    hairline-strong: "rgba(255, 255, 255, 0.2)"
    track: "rgba(255, 255, 255, 0.07)"
  chart-series:
    light: ["#2457d6", "#6f9bff", "#7a5af8", "#b6a2fb", "#0e8fa3", "#94a3b8"]
    dark: ["#7ea3ff", "#4f7de0", "#a78bfa", "#7c5cd6", "#38bdf8", "#64748b"]
typography:
  page-title:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  page-title-phone:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  price-hero:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "-0.035em"
  metric:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 650
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 650
    letterSpacing: "-0.02em"
  lead:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 650
    lineHeight: 1.55
  body:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: "14px"
  inset: "14px"
  panel: "22px"
  brand-mark: "12px"
  pill: "999px"
  logo: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.light.cobalt}"
    textColor: "{colors.light.on-cobalt}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "44px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.light.midnight-ink}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "44px"
  panel:
    backgroundColor: "{colors.light.paper}"
    rounded: "{rounded.panel}"
    padding: "20px"
  search-bar:
    backgroundColor: "{colors.light.paper}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "48px"
  segmented-control:
    backgroundColor: "{colors.light.track}"
    rounded: "{rounded.pill}"
    padding: "3px"
  status-pill:
    backgroundColor: "transparent"
    textColor: "{colors.light.midnight-ink-soft}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  tile:
    backgroundColor: "{colors.light.track}"
    rounded: "{rounded.inset}"
    padding: "12px 14px"
  web-box:
    backgroundColor: "transparent"
    rounded: "{rounded.inset}"
    padding: "14px 16px"
---

# Design System: Trade Agent

## Overview

**Creative North Star: "The Calm Desk"**

A light, quiet workspace where the research is laid out like papers on a desk: white panels on a
cool paper-grey page, with a navy dark theme for the evening. The interface puts the thing that
needs a decision first, gives its reasoning in plain, exact numbers, and stays calm about
everything else. Panels are soft and generously rounded, lifted off the page by a very faint
shadow and a hairline, never by glow or colour.

One blue, Cobalt, is the accent. It marks the primary action, the selected state, links, the
focus ring and the spark that says "this is AI text". Green and red are not part of the brand
palette at all: they appear only on a price rising or falling, and always with a sign and an
arrow. Amber marks a caution. Confidence, risk and status are never coloured; they are a shape
and a word. The product is advisory-only, so the system never borrows the look of an exchange: no
execution panels, no urgency, no glow.

The system is light-first and equally complete in dark, and phone-first: a quick daily check on a
390px screen, with a left sidebar and wider workspaces on desktop.

**Key Characteristics:**
- Light-first on Cloud, with a complete navy dark theme (Deep Navy, Periwinkle accent)
- One blue accent; green and red only for price movement; amber for caution
- Confidence, risk and status as shape plus word, never colour alone
- Round monogram logos for every company (circles, never a brand mark)
- Soft panels: 22px radius, a hairline, a faint shadow in light and a deeper one in dark
- Tight numerals, small quiet supporting text, one big figure per region
- Phone-first with a bottom tab bar; a 204px sidebar on desktop

## Colors

A cool paper-grey page, white panels, ink-navy text and a single blue. Every colour is a CSS
custom property on `:root` that flips with `data-theme`; components use the variables, never
the hex values.

### Primary
- **Cobalt** (#2457d6 light, **Periwinkle** #7ea3ff dark): the one accent. Primary button fill,
  active nav item, selected segment, links, the focus ring, the AI spark icon and the filled part
  of a chart or band. Text on a Cobalt fill is white; on Periwinkle it is #0a1530.
- **Cobalt Wash** (9% Cobalt in light, 14% Periwinkle in dark): the tint behind an active
  state, a hovered row, the spark badge and "AI analyzed" pills (`--up-bg` in the mocks, named
  for the old green; it is now the accent wash).

### Secondary (price movement and caution)
- **Price Up** (#067a52 light, #34e7a9 dark) and **Price Down** (#c8323d light, #ff6b72 dark):
  used for a price or its change, a gain or a loss, and for nothing else. Always text, always
  with a sign and an arrow, never a fill or a status.
- **Amber** (#9a5b00 light, #f4c04f dark): a caution, a "not priced" or near-limit note, and a
  stale warning.

### Neutral
- **Cloud** (#f5f7fb) and **Deep Navy** (#0c1426): the page.
- **Paper** (#ffffff) and **Navy Panel** (#131d36): panels, the active nav item, the bottom tab
  bar, the selected segment.
- **Midnight Ink** (#0f1a2e) / **Frost Text** (#e9eefb): primary text. **Midnight Ink Soft**
  (#34425c) / **Frost Text Soft** (#c2cce3): secondary text and icons. **Slate Muted** (#5d6b85) /
  **Mist Muted** (#92a0bd): labels, captions, supporting lines.
- **Hairline** (8% ink in light, 7% white in dark) and **Hairline Strong** (20% in both): every
  border and divider; the strong variant is the dashed edge and the ghost-button outline.
- **Track** (6 to 7%): the tray behind segmented controls, tiles, bands and skeletons.
- **Chart series** (six hues per theme, blue first): used only to tell allocation slices
  apart, always beside a legend with the name and the value.

### Named Rules
**The Movement Only Rule.** Green and red mean a price went up or down, and nothing else. A
status, a confidence, a risk level or a "Buy" action is never green or red. The exceptions are
a form validation error and a blocking limit ("At limit"), which use the Price Down colour together
with an icon or a word, because nothing else reads as a stop. If a screen shows green or red on something else that did
not move, it is a defect.

**The Sign And Word Rule.** Colour is never the only carrier of meaning. A move is coloured,
signed and arrowed (▲ +2.4%); confidence and risk are filled bars plus a word (Medium); status is
an icon shape plus a word.

## Typography

**Font:** Geist Sans (weights 300, 400, 500, 650) with system-ui as fallback. Geist Mono is
available for tabular figures where alignment matters; numerals otherwise stay in Geist Sans with
`font-variant-numeric: tabular-nums`.

**Units:** font sizes are in `rem` (1rem = 16px), never `px`, so they follow the user's browser setting. Lengths such as radii, spacing and touch targets stay in `px`.

**Character:** One clean geometric sans at a small number of sizes. Weight (650 for names and
numbers, 500 for controls, 400 for prose) and colour carry hierarchy more than size does; the big
moments are numbers and the company name, not headlines.

### Hierarchy
- **Page title** (650, 1.875rem desktop, 1.625rem phone, -0.025em): one per screen, the `h1`.
- **Price hero / Stat** (650, 1.875 to 2rem, -0.035em): the single price or total a region is
  about. Never more than one per region.
- **Metric** (650, 1.625rem, -0.03em): section totals and key figures.
- **Title** (650, 1.25rem): tile values, empty-state headings, drawer titles.
- **Lead** (650, 0.9375rem): company names in lists, section headings, the thesis paragraph (400,
  line-height 1.55).
- **Body** (400 to 650, 0.8125rem, 1.5): nearly all interface text; 650 for values.
- **Label** (400, 0.75rem, Slate Muted): captions, units, metadata, pill text, the advisory note.

### Named Rules
**The Numbers Lead Rule.** Only numbers and the company name get the large sizes. Text never
competes with the figure it describes.

**The Readable Floor Rule.** Nothing is below 0.75rem. The advisory note is 0.75rem, in the muted
colour, at most 72 characters wide.

## Layout

Phone-first. On a phone the page is a single column with 16px side padding and a sticky bottom
tab bar (Today, Discover, Portfolio, Chat, More), each a 20px icon over a label. From 900px a
204px sidebar appears with the brand mark (a 34px rounded square in Cobalt) and the full list:
Today, Discover (with a small "new" badge), Portfolio, Chat, Track record, Backtests, Preferences,
Account; the main area has 24px top and 34px side padding. Desktop mocks are drawn at 1280px and phone mocks at 390px.

Spacing is a 4px base with 8, 10, 12, 16, 20, 22 and 24 in use: 16px between panels, 12px between
rows of related things, 20px inside a panel (16px on a phone). Content that is a list or a form
caps its width (an empty-state card 560px; prose 46 to 72 characters). The right-hand decision rail
on a company page sits beside the evidence on desktop; on a phone it becomes a bar of actions above
the tab bar.

Every interactive element is at least 44px tall on a phone (36px for secondary icon buttons on
desktop). Focus is a 2px Cobalt outline with 2px offset on every focusable element.

## Elevation & Depth

Soft and shallow. A panel is white (or Navy Panel) on the page with a 1px hairline and one very
faint, wide shadow in light (`0 1px 2px` plus `0 12px 32px -14px` at 4 and 14% ink); in dark the
shadow is deeper (`0 14px 34px -18px` black) and there is no glass or backdrop blur. The primary
button has its own short Cobalt shadow in light and none in dark. The active nav item and the
selected segment are lifted with the same panel shadow, which is what tells them apart from the
track around them.

### Named Rules
**The Quiet Lift Rule.** Elevation is one soft shadow level plus a hairline. No glows, no
coloured shadows except the primary button's, no stacked cards with different heights.

## Shapes

Round and friendly, in two sizes. Panels are 22px; buttons, tiles, the web box and inputs are 14px.
Pills (search bar, status pills, segmented controls, filter chips, the circular go button) are
fully round. Company logos are circles holding a two- or three-letter monogram on the Track
colour; the brand mark is a 12px-radius square. Borders are 1px. Dashed and dotted borders carry
meaning (see below); nothing else is dashed.

## Components

### Buttons
- **Primary:** Cobalt fill (Periwinkle in dark), 14px radius, 44px tall, 650 weight, one per view
  where a decision is recorded (Approve, Add Company, Analyze). Never styled as a trade.
- **Ghost:** transparent, 1px Hairline Strong outline, ink text, 500 weight, for Dismiss, Save
  to Discover, Ask AI, Remove.
- **Icon button:** 36px circle (44px on a phone) with a hairline, for refresh and theme.
- **Go button:** a circular Cobalt arrow on the Today search bar.
- **Disabled** dims to 60%; it does not change shape. A running action keeps its label and shows
  the state in text.

### Search bar
Pill, 48px (44px on a phone), Paper fill with a hairline, a muted search icon and a muted
placeholder; focus shows the Cobalt outline on the whole pill. Results drop below as a plain list
of real buttons (not a listbox) with logo, name, ticker, exchange and currency. A company already
in the user's list shows "Already in Discover" instead of an Add button. The hint under the field
says what the search does and does not ask for.

### Segmented control and filters
A Track tray with 3px padding holding pill options; the selected option is Paper with the panel
shadow and 650 weight, optionally with a count badge. Used for Holdings / This month / Saved
plans, Overview / Numbers / Risk and fit / Sources, range selectors (1W, 1M, 3M) and the
All / AI analyzed / Not analyzed filter. On a phone the options spread over the full width.

### Company row and card
Logo circle (48px list, 56 to 64px header), name (Lead, 650) and ticker, exchange and currency
in muted label text, price and daily change on the right (signed, arrowed, coloured by movement),
a status pill, one line of AI insight with the spark icon, and the actions at the end.

### Status pills (shape plus word)
- **AI analyzed:** check icon, Cobalt Wash fill, Cobalt text.
- **Not analyzed:** dashed circle icon, dashed edge, no fill.
- **Analyzing:** dotted edge while a run is in progress.
- **Disputed / Unverified** (a claim's status): the edge is dashed or dotted, with the word.

### Confidence and risk meters
Three or five small bars (8 by 12px, 2px radius, 1px edge); filled bars use the secondary text
colour. The word (Low, Medium, High) always sits beside them. Never emerald, coral or blue.

### Tiles, bands and breakdowns
Metric tiles on the Track fill (14px radius, label above, 1.25rem value below, a muted unit line);
a tile with no data becomes a dashed outline with the reason in plain words. The peer band is a
10px Track bar with a Cobalt wash for the peer range, a median tick, and a dot for the company.
Key-value lists are divided by hairlines. Charts are hand-built SVG: Cobalt line,
hairline gridlines, 0.75rem muted axis labels, a keyboard-readable point, and the numbers beside
it as text. Allocation uses the chart-series hues with a legend.

### AI text and the Web Opinion Box
Anything the model wrote is marked with the Cobalt spark icon. Anything that came from the web is
inside the Web Opinion Box: a dashed Hairline Strong box (14px radius) with a globe icon and the
label "Web second opinion · not part of the score". Dashed means the content is outside the
computed numbers: web-derived, not available, or not yet analyzed.

### Toast
A dark-on-light (light-on-dark in dark) bar pinned to the bottom of its region, with a text action
(Undo) underlined and 32px tall. Remove is immediate and offers Undo; nothing is sent to a broker.

### Empty, loading and error states
Every list and region has a designed empty state: a 44px icon tile on the Cobalt Wash, a 1.25rem
heading, one or two plain sentences saying what to do, and one primary action. Loading uses Track
skeletons with the same shape as the content; errors name the problem and the next step in plain
words. A missing price says "Price unavailable" and how to proceed, never a zero.

### Navigation
Sidebar and tab bar share one icon set (Lucide, 1.7 stroke, 15 to 20px). The active item is a
Paper pill with the panel shadow and Cobalt text. The advisory note closes every screen.

## Do's and Don'ts

### Do:
- **Do** use the CSS variables (`var(--accent)`, `var(--panel)`, `var(--line)`, `var(--muted)`,
  `var(--up)`, `var(--down)`, `var(--warn)`) and never a hex value in a component.
- **Do** give every price move a sign, an arrow and a colour; give every status and level a shape
  and a word.
- **Do** mark AI text with the spark and keep web-derived content in the dashed Web Opinion Box.
- **Do** end every screen with the advisory note: prices are delayed, insights are not
  investment advice, nothing is sent to a broker.
- **Do** design the empty, loading and error state of every region next to the happy path.
- **Do** keep touch targets at 44px on a phone and the focus ring on everything focusable.
- **Do** check both themes: every change must read in light and in dark.
- **Do** make every primary action a recorded decision ("Approve", "Dismiss", "Added to
  Discover") and say when nothing is sent to a broker.

### Don't:
- **Don't** use green or red for anything but a price rising or falling (and the red of a validation error or a
  blocking limit): not for buy/sell actions, statuses, confidence or "good/bad".
- **Don't** reintroduce the old teal glass: no translucent panes, backdrop blur, mint hairlines or
  emerald glow.
- **Don't** add glows, gradients, neon, pulsing or large luminous fills.
- **Don't** use urgency styling: no countdowns, flashing or alarm wording.
- **Don't** style anything like an exchange execution panel: no Buy, Sell, Deposit or Withdraw
  buttons, ever.
- **Don't** show a health score or a single "grade" for a company or a portfolio.
- **Don't** use real company logos or brand marks in mocks or samples; use fictional companies and
  monogram circles.
- **Don't** use a colour variable that is not defined in `app/globals.css`; a missing variable
  silently drops the property.

## Implementation status

This file describes the approved **Soft** direction (decided 2026-10-20, see
[docs/design/README.md](docs/design/README.md) and the four `direction-approved.md` files for
Today, Company overview, Portfolio and Discover).

**Built:** the tokens (`frontend/app/globals.css`), the MUI theme, the Panel (22px), the sidebar
and tab bar, and the separation of accent from price movement: `--accent-wash` tints selected and
active states, `--up-bg` and `--down-bg` are only for a price rising or falling, and `Pill` has an
`accent` tone for status. Status pills (technical signal, fundamental score, Claude connection, usage
"OK") no longer use green or red.

**Built on Today:** the discovery section (latest-scan bar, Top opportunity, Other opportunities,
the scan states), the round monogram `Logo`, the `Meter` (confidence and risk as bars plus a word)
and the `Change` (signed, arrowed price move). Save to Discover adds the company to Discover (also
from the workbench's decision rail and phone bar), then becomes a link to the list. The holdings
recommendations sit under "Portfolio alerts" (a list with monogram logos on desktop, cards on a
phone); the search bar and Watchlist insights are not built. The page title is 30px (26px on a
phone) on every screen.

**Built on the company page** (`/today/[id]` for a discovery idea): the Workbench shell (identity, a
decision rail beside the evidence, tabs, a phone action bar above the tab bar) with four tabs.
Overview: thesis, price chart, bull and bear cases at equal weight. Numbers: fundamentals tiles,
valuation and quality against peers as bands (value, median tick, middle half of peers, position in
words, neutral wording), and a named-peer table with this company first. Risk and fit: risk
characteristics "measured, not scored" and the portfolio fit with its written reading. Sources:
every source, data limits, unresolved evidence and the unverified community view. The price chart
(`GET /discovery/ideas/{id}/history`), the named peers, the research-named competitors and the fit
facts (sector weight, concentration, volatility and correlation, before and after) come from data
the backend saves with each new idea; an idea saved before that shows what it has and says what it
lacks.

**Built on Portfolio (first slice of the Explorer):** a slim overview strip (total value, gain or
loss, today's change as "Not available" until the previous close is saved, and the value chart once
there are seven days of snapshots; its title sits on the left of the row that holds the 1M, 6M, 1Y and
All range track, with the value scale at the left of the plot, the months under it and a dot on the latest
value), and "Where your money is": a donut by sector, country or
currency whose legend rows filter the holdings table, beside the largest positions. Slices use the
blue, violet and cyan chart tokens (`--c1` to `--c6`), never green or red; amounts stay as entered
and the page says so. The holdings table keeps its columns and targets (a target saved on Discover
is marked as such), gains a monogram per company, "Add purchase price" where a holding has no cost, a count ("N of M
holdings" while a group filters it) and a row menu (edit, log a trade for that holding, remove, which
asks first and says it sells nothing). The Holdings header reads "Your holdings, allocation and risk.
Updated today, 14:14." (the time the figures were last read) and the four views are the Soft pill track
(Holdings, This month, Saved plans, Orders), as in the Explorer mock. The page header has only Add holding; the
watchlist panel, the per-row watch toggle, the header's Log a trade and Record snapshot are gone:
watching a company is Discover's job, a trade is logged from the row menu, and the value history is
saved by itself once a day when Today or Portfolio is opened. Below the table, "Risk and analytics" (measured, not scored) reads
`GET /portfolio/analytics`: volatility, largest position, top three together, effective holdings,
average correlation with the most correlated pair, and the biggest fall of the past year (a plain
negative percent, from peak to low over the shared price history, up to a year, with today's holdings and weights), each with what it means; what could not be
valued or measured is listed in the backend's own words; "Advanced analytics" opens a correlation
table with every number printed and the spread across sectors, countries and currencies. There is no
overall health score. Risk figures use values converted to euro, so they can differ a little
from the table's as-entered weights.

**Built on Discover** (`/discover`, between Today and Portfolio in the sidebar and the phone tab bar):
the List option. Search by name or ticker and add (the name, exchange and currency are filled in by
the backend; no shares or cost), a company already there shows "Already in Discover", filters (All,
AI analyzed, Not analyzed, with counts), a sort (recently added, name, daily change), and a card per
company: monogram, name (opening its report when a scan researched it), status as a shape plus a
word, the scan's one-line reading as plain text, price and daily change (green or red only for the
move), what the person set as a weight target and price range ("Target 5% · Range USD 90.00 to 110.00", in
words), when it was added and from where, View, Edit and Remove. Edit opens a dialog for the weight
target (not for a company that is owned, whose target lives on the holding) and the price range, in the
currency the card shows; only what was changed is sent. Remove is shown at once and sent after
eight seconds, so Undo only cancels it; leaving the page sends it. On a phone the page follows the
approved phone mock: the search field, then a full-width Add button with its helper line; the filter
track across the full width; Sort by on its own row with a wide select; and each card as three rows,
who it is (monogram, name and status, one line of where it is listed and when it was added, the
reading), the price with its change and the quote date on one line, and the actions, where View (or
Edit target for a company no scan has researched) takes the width and Edit and Remove are square
44px outlined buttons (outlined on a computer too, as in the mock). There is no Analyze button: Discover does not start research. The empty, loading, load-error,
no-match and "Price unavailable" states are built. Analyze (single-company research) and the simple
company overview are not built: Discover only shows research a scan already produced, and a company
without a report has no page to open. "Save to Discover" on Today and in the workbench adds the
company here as "saved from Today".

**Not built yet:** single-company Analyze, the company
overview for a company with no report, and the rem sizes in component `sx` props outside the new components (the theme
and the new Today components are in rem). Existing screens keep their current layouts
and sizes until each is restyled.

Decided:

- **Action chips** (BUY, ADD, HOLD, WATCH, TRIM, SELL) are neutral pills: an icon and the word on the
  Track fill with a hairline edge, never green, red or amber, because those colours mean a price moved.
  Built in `ActionChip`.
- **One scan button.** Today has a single Refresh button in the scan bar. The holdings analysis is
  no longer started from the UI; the daily analysis (Preferences) produces the holdings alerts.

Open items:

- Cards built with `borderRadius: 2` still render at 36px (MUI multiplies the 18px base), and plain
  MUI `Paper` surfaces at 18px; the Soft panel is 22px. Each screen moves to `Panel` as it is
  restyled.
