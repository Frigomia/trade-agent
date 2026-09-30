---
name: Trade Agent
description: "A personal, advisory-only trading dashboard: dark glass over deep teal, one emerald light for what needs a decision."
colors:
  pine-black: "#060d0c"
  frost-text: "#e7f3ef"
  frost-text-soft: "#cfe2dc"
  sage-muted: "#8aa89f"
  emerald-glow: "#34e7a9"
  on-emerald: "#032116"
  coral-down: "#ff6b72"
  amber-warn: "#f4c04f"
  emerald-wash: "rgba(52, 231, 169, 0.13)"
  coral-wash: "rgba(255, 107, 114, 0.13)"
  amber-wash: "rgba(244, 192, 79, 0.12)"
  glass-panel: "rgba(255, 255, 255, 0.035)"
  mint-hairline: "rgba(120, 255, 214, 0.11)"
  mint-hairline-strong: "rgba(120, 255, 214, 0.2)"
  mist-mint: "#f2f8f5"
  ink-green: "#0b1f19"
  ink-green-soft: "#29473c"
  moss-muted: "#52695f"
  emerald-deep: "#078a5f"
  emerald-solid: "#067a52"
  on-emerald-light: "#ffffff"
  coral-down-light: "#c8323d"
  amber-warn-light: "#9a5b00"
  glass-panel-light: "rgba(255, 255, 255, 0.78)"
  forest-hairline: "rgba(8, 110, 80, 0.15)"
  forest-hairline-strong: "rgba(8, 110, 80, 0.3)"
typography:
  headline:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: 1.334
  title:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 650
    lineHeight: 1.6
  metric:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1.5
    letterSpacing: "-0.03em"
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
  caption:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: "14px"
  panel: "18px"
  inset: "27px"
  card: "36px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.emerald-glow}"
    textColor: "{colors.on-emerald}"
    rounded: "{rounded.control}"
    padding: "6px 16px"
  button-outlined:
    backgroundColor: "transparent"
    textColor: "{colors.emerald-glow}"
    rounded: "{rounded.control}"
    padding: "5px 15px"
  chip-action:
    backgroundColor: "{colors.emerald-glow}"
    textColor: "{colors.on-emerald}"
    rounded: "{rounded.pill}"
    typography: "{typography.label}"
  chip-action-trim:
    backgroundColor: "{colors.amber-warn}"
    textColor: "{colors.on-emerald}"
    rounded: "{rounded.pill}"
    typography: "{typography.label}"
  chip-action-sell:
    backgroundColor: "{colors.coral-down}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    typography: "{typography.label}"
  card:
    backgroundColor: "transparent"
    rounded: "{rounded.card}"
    padding: "16px"
  panel:
    backgroundColor: "{colors.glass-panel}"
    rounded: "{rounded.panel}"
  inset-box:
    backgroundColor: "transparent"
    rounded: "{rounded.inset}"
    padding: "12px"
  tab-bar:
    backgroundColor: "{colors.glass-panel}"
    padding: "8px 0"
---

# Design System: Trade Agent

## Overview

**Creative North Star: "The Glass Cockpit"**

Translucent panels float over a deep teal-black field, like instruments lit from within. The
interface is focused and confident: it puts the thing that needs a decision first, states its
reasoning in plain, exact numbers, and stays calm about everything else. Everything is a
hairline-edged pane of glass; nothing is lifted off the page with a shadow.

A single light colour, Emerald Glow, does the signalling. It marks the primary action, a
favourable move, the selected state and the filled part of a progress bar, and because it is
rare it still reads as a signal. Coral marks a fall or a sell, amber marks a caution or a trim,
and neither is ever used alone to carry meaning: every up, down and status also has a sign, a
word or a shape. The product is advisory-only, so the system never borrows the visual language
of an exchange: no execution panels, no urgency, no glow-for-glow's-sake.

The same system runs in a light theme (Mist Mint with Ink Green and a deeper emerald) and is
phone-first: a quick daily check on a small screen, with more room and a sidebar on desktop.

**Key Characteristics:**
- Dark glass over Pine Black by default, with an equally complete light theme
- One emerald accent, used sparingly; coral and amber as status, never alone
- Hairline mint borders and a 20px backdrop blur instead of shadows
- Tight, confident numerals; small, quiet supporting text
- Generous radii: soft controls, rounded panels, pill chips
- Phone-first with a bottom tab bar; a sidebar appears from 900px

## Colors

A deep teal-black base and a single luminous emerald, with coral and amber held in reserve for
status. Every colour is a CSS custom property on `:root` that flips with `data-theme`; components
use the variables, never the hex values.

### Primary
- **Emerald Glow** (#34e7a9 dark, Emerald Deep #078a5f light): the one accent. Primary buttons
  use it as a fill (Emerald Solid #067a52 in the light theme, so white text passes contrast),
  favourable moves use it as text, and the active and filled states use it. The text on top of a
  fill is On Emerald (#032116 dark, #ffffff light).

### Secondary
- **Coral** (Coral Down #ff6b72 dark, #c8323d light): a fall, a loss, a SELL action, an error.
- **Amber** (Amber Warn #f4c04f dark, #9a5b00 light): a caution, a TRIM action, a "not priced"
  or near-limit note.

### Neutral
- **Pine Black** (#060d0c): the dark page background. **Mist Mint** (#f2f8f5) in the light theme.
- **Frost Text** (#e7f3ef) and **Frost Text Soft** (#cfe2dc): primary and secondary text in dark;
  **Ink Green** (#0b1f19) and **Ink Green Soft** (#29473c) in light.
- **Sage Muted** (#8aa89f dark, Moss Muted #52695f light): labels, captions, supporting lines.
- **Glass Panel** (rgba white at 3.5% in dark, Glass Panel Light at 78% in light): the surface of
  panes, drawers and the tab bar.
- **Mint Hairline** (11% mint in dark, Forest Hairline 15% in light) and its strong variant
  (20% / 30%): every border, divider and chart gridline. The strong variant marks the dashed
  web-opinion box.
- **Washes** (Emerald, Coral and Amber at about 12% opacity): tinted backgrounds behind status
  pills.

### Named Rules
**The One Light Rule.** Emerald Glow is the only luminous colour, and it marks what needs a
decision or moved favourably. If more than a few things on a screen glow, none of them is a signal.

**The Sign And Word Rule.** Colour is never the only carrier of meaning. A move is coloured and
signed (+2.4%); a status is coloured and worded (Matched, Near limit, Ahead of buy-and-hold).

## Typography

**Display / Body Font:** Geist Sans (with system-ui, sans-serif)
**Label/Mono Font:** none; numerals stay in Geist Sans

**Character:** One clean geometric sans used at a small number of sizes. Weight and colour, not
size jumps, carry hierarchy; the big moments are numbers, not headlines.

### Hierarchy
- **Headline** (650, 1.5rem, 1.334): page titles, one per screen, as the `h1`.
- **Title** (650, 1.25rem): drawer and section headings.
- **Metric** (650, 26px, letter-spacing -0.03em): tickers and portfolio totals, the largest
  text on any screen.
- **Body** (400 to 600, 13px, 1.5): nearly all interface text, with weight 600 for values.
- **Label** (400, 12px, Sage Muted): field captions, units, secondary lines, pill text.
- **Caption** (400, 11px): tab bar labels.

### Named Rules
**The Numbers Lead Rule.** Only numbers (tickers, totals, prices) get the large Metric size. Text
never competes with the figure it describes.

## Layout

Phone-first. The shell is a flex row: a 218px sidebar appears from the `md` breakpoint (900px
and up), and below it a sticky bottom tab bar carries the four main tabs (plus Admin for the
admin), each an icon over an 11px label. The main area has a 16px page padding and stacks content
in a single column; cards are separated by 12px, sections by 16 to 24px. Forms and small panels
cap their width (about 400 to 420px); tables and charts take the full width. Drawers open from the
right (320px on a phone, 400px on desktop); the Log a trade sheet opens from the bottom on a phone.

Spacing follows MUI's 8px unit with half and quarter steps: 4, 6, 8, 12, 16, 24. Breakpoints are
MUI's defaults (600, 900, 1200, 1536).

## Elevation & Depth

Flat by design. There are no box-shadows anywhere (Paper sets `boxShadow: none`). Depth comes from
three things only: a translucent Glass Panel fill, a 1px Mint Hairline border, and a 20px backdrop
blur behind panes, drawers and the tab bar. Page-level content that does not need a pane (cards
on the page background) is just a hairline outline on the page colour.

### Named Rules
**The Glass, Not Shadow Rule.** A surface is distinguished by its hairline and its translucency,
never by a drop shadow. If something needs to feel raised, it gets a stronger hairline, not a blur
radius.

## Shapes

Generous and soft. The theme's base radius is 18px (panes, drawers, paper). Buttons are 14px,
chips are fully round (999px), progress bars and avatars are round. Cards and inset boxes built
with the `sx` shorthand multiply the 18px base: `borderRadius: 2` renders at 36px for cards and
`1.5` at 27px for inset boxes such as the web opinion. The original mockups used about 18px for
cards, so the current 36px is larger than designed. Borders are always 1px; the only dashed border
marks web-derived content.

## Components

### Buttons
- **Shape:** softly rounded (14px), sentence-case labels, no uppercase.
- **Primary (contained):** Emerald Glow fill with On Emerald text, 6px by 16px padding. One per
  view where a decision is being recorded ("Approve"); never styled as a trade.
- **Outlined:** transparent with a hairline and emerald text, for the paired "Dismiss" and
  secondary actions, including Sign out. Text buttons are rare and reserved for quiet actions.
- **Hover / Focus:** MUI defaults tinted by the theme, so focus and hover take the primary (accent)
  colour. Disabled buttons dim, they do not change shape.

### Chips
- **Action chips** are pill-shaped, bold and compact: BUY, ADD, HOLD and WATCH share the Emerald
  fill; TRIM is Amber; SELL is Coral with white text. The word is always present.
- **Filter and range chips** (1W, 1M, 3M) are pills that turn to the primary colour when selected.

### Cards / Containers
- **Corner Style:** very round (36px as built; see Shapes).
- **Background:** the page colour; only a 1px Mint Hairline separates it.
- **Shadow Strategy:** none.
- **Internal Padding:** 16px. A card holds a ticker at Metric size, an action chip, a price block
  on the right, an evidence block, a one-line take, and the decision buttons.

### Inputs / Fields
- **Style:** MUI outlined fields on the theme, with labels that always shrink above the field for
  dates and native selects. Helper text sits below in the muted label style.
- **Focus:** the accent colour on the outline.
- **Error / Disabled:** errors appear as an Alert above the action, in plain specific words;
  disabled fields dim.

### Navigation
- **Sidebar (desktop):** 218px, a hairline on the right, each item an 18px line icon with text.
- **Tab bar (phone):** sticky to the bottom on Glass Panel with backdrop blur and a top hairline;
  20px line icons (1.75 stroke) over 11px labels.
- **Icons:** one line-icon set (Lucide), 1.75 stroke, sized 15 to 20px.

### Web Opinion Box
The signature component. A dashed Mint Hairline (strong) box with a small globe icon and the
label "Web second opinion · not part of the score". It is the only dashed element in the system:
dashed always means the content came from the web and is separate from the numbers.

### Evidence Panel
Label and value pairs in the body and label styles, with a thin 6px pill progress bar for the
fundamentals score and a coloured, worded technical signal.

### Charts
Hand-built SVG on a hairline grid. The primary series is a solid Emerald Glow line; a comparison
series is dashed in Sage Muted. Axis labels are 10px in Sage Muted. Every chart has its numbers
beside it as text, and the focusable chart reads out a point from the keyboard.

## Do's and Don'ts

### Do:
- **Do** use the CSS variables (`var(--accent)`, `var(--line)`, `var(--muted)`, `var(--up)`,
  `var(--down)`, `var(--warn)`) and the MUI theme, never a hex value in a component.
- **Do** give every up, down and status colour a sign, a word or a shape next to it.
- **Do** keep web-derived content in the dashed Web Opinion Box, visibly separate from the score.
- **Do** separate surfaces with a 1px Mint Hairline and, where a pane needs a fill, the Glass Panel
  with a 20px backdrop blur.
- **Do** use the theme's 18px radius for any new pane or card; the existing 36px cards are a known
  drift from the mockups.
- **Do** lead with the number: Metric size for the figure, muted label text for its description.
- **Do** make every primary action a recorded decision ("Approve", "Dismiss", "Log a trade" in
  the past tense) and say when nothing is sent to a broker.

### Don't:
- **Don't** add heavy shadows or skeuomorphic depth; depth is hairlines and translucency.
- **Don't** use loud neon or a crypto-casino glow: no full-screen glows, pulsing, or large
  luminous fills; Emerald Glow stays small and rare.
- **Don't** use urgency styling: no countdowns, flashing, alarm reds or pressure wording.
- **Don't** style anything like an exchange execution panel: no Buy, Sell, Deposit or Withdraw
  buttons, ever.
- **Don't** use colour as the only signal, or use coral and emerald for anything other than
  fall and rise (or sell and buy).
- **Don't** use a border colour variable that is not defined in `app/globals.css`; a missing
  variable silently drops the border.
