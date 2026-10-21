---
name: Trade Agent
description: "A personal, advisory-only trading research app: calm soft panels, one blue accent for what you can act on, green and red only for a price moving."
status: "Approved direction (Soft, 2026-10-20). The shipped frontend still uses the earlier Emerald Glass palette; see Implementation status."
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
    fontSize: "30px"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  page-title-phone:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  price-hero:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "-0.035em"
  metric:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 650
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 650
    letterSpacing: "-0.02em"
  lead:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.55
  body:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "12px"
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
status, a confidence, a risk level, a "Buy" action or an error is never green or red. If a
screen shows green or red on something that did not move, it is a defect.

**The Sign And Word Rule.** Colour is never the only carrier of meaning. A move is coloured,
signed and arrowed (▲ +2.4%); confidence and risk are filled bars plus a word (Medium); status is
an icon shape plus a word.

## Typography

**Font:** Geist Sans (weights 300, 400, 500, 650) with system-ui as fallback. Geist Mono is
available for tabular figures where alignment matters; numerals otherwise stay in Geist Sans with
`font-variant-numeric: tabular-nums`.

**Character:** One clean geometric sans at a small number of sizes. Weight (650 for names and
numbers, 500 for controls, 400 for prose) and colour carry hierarchy more than size does; the big
moments are numbers and the company name, not headlines.

### Hierarchy
- **Page title** (650, 30px desktop, 26px phone, -0.025em): one per screen, the `h1`.
- **Price hero / Stat** (650, 30 to 32px, -0.035em): the single price or total a region is
  about. Never more than one per region.
- **Metric** (650, 26px, -0.03em): section totals and key figures.
- **Title** (650, 20px): tile values, empty-state headings, drawer titles.
- **Lead** (650, 15px): company names in lists, section headings, the thesis paragraph (400,
  line-height 1.55).
- **Body** (400 to 650, 13px, 1.5): nearly all interface text; 650 for values.
- **Label** (400, 12px, Slate Muted): captions, units, metadata, pill text, the advisory note.

### Named Rules
**The Numbers Lead Rule.** Only numbers and the company name get the large sizes. Text never
competes with the figure it describes.

**The Readable Floor Rule.** Nothing is below 12px. The advisory note is 12px, in the muted
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
Metric tiles on the Track fill (14px radius, label above, 20px value below, a muted unit line);
a tile with no data becomes a dashed outline with the reason in plain words. The peer band is a
10px Track bar with a Cobalt wash for the peer range, a median tick, and a dot for the company.
Key-value lists are divided by hairlines. Charts are hand-built SVG: Cobalt line,
hairline gridlines, 12px muted axis labels, a keyboard-readable point, and the numbers beside
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
Every list and region has a designed empty state: a 44px icon tile on the Cobalt Wash, a 20px
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
- **Don't** use green or red for anything but a price rising or falling: not for buy/sell
  actions, statuses, confidence, errors or "good/bad".
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

This file now describes the approved **Soft** direction (decided 2026-10-20, see
[docs/design/README.md](docs/design/README.md) and the four `direction-approved.md` files for
Today, Company overview, Portfolio and Discover). The `frontend/` build has **not** moved yet: it
still ships the earlier Emerald Glass palette and is waiting for Lane B before the new screens
are built. Until the restyle lands, `frontend/app/globals.css` and the MUI theme are the source of
truth for what is on screen; this file is the target.

What changes when the build starts:

| Area | Shipped (Emerald Glass) | Target (Soft) |
|---|---|---|
| Light page / panel | #f2f8f5 / white 78% glass | #f5f7fb / #ffffff |
| Dark page / panel | #060d0c / white 3.5% glass | #0c1426 / #131d36 |
| Accent | emerald #078a5f (light), #34e7a9 (dark) | Cobalt #2457d6 (light), Periwinkle #7ea3ff (dark) |
| Rise / fall | the accent doubles as "rise" | separate: #067a52 / #34e7a9 and #c8323d / #ff6b72, movement only |
| Hairline | mint, 11 to 15% | ink or white, 7 to 8% |
| Panel radius / control radius | 18px base (cards render 36px) / 14px | 22px / 14px |
| Depth | no shadow, 20px backdrop blur | one soft shadow, no blur |
| Page background | radial teal glow | flat Cloud or Deep Navy (`--page-glow: none`) |
| Action chips (BUY, ADD, HOLD, WATCH, TRIM, SELL) | emerald, amber and coral fills | not shown in any Soft mock; see the open item below |
| Logos | none | round monogram circles |
| Nav | the shipped items | adds Discover between Today and Portfolio (sidebar and tab bar) |

Tokens that exist in `globals.css` but have no value in the Soft mocks yet and need one when the
build starts: `--down-bg`, `--warn-bg` (the mocks use a 14% mix of `--warn`), `--field`,
`--scrim`, `--on-warn`, `--tab-bg` (the mocks use the panel colour), `--bubble`, `--focus` (use
the accent), `--pop`, `--tabbar-h`.

Open item: the action chips (BUY, ADD, HOLD, WATCH, TRIM, SELL) are not drawn in the Soft mocks.
Under the Movement Only Rule they cannot keep emerald and coral fills, so they need a design
decision (for example neutral pills with an icon and the word) before the recommendation screens
are restyled. Nothing in the four mock folders settles it.
