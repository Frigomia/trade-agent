# Scheduled analysis: design direction (gate file)

Date: 2026-10-06. Branch: feature/scheduled-analysis.

## Shown

Three directions, each covering the Preferences switch in four states (off, on, paused because the
limit is used up, paused because there is no Claude key) and Today with one automatic and one manual
recommendation plus the "Last analysis" line, in dark and light, desktop and phone. Sources:
`a-row-in-preferences.html`, `b-own-card.html`, `c-weekday-strip.html` (shared `sa.js`, `sa.css`).
Screenshots: `shots/{a,b,c}-{dark,light}-{desktop,phone}.png`.

## Chosen

User's words: "Lets go for option A" (A, a row in the Preferences panel).

## Decisions that come with A

- Preferences: a separate panel under the existing preference fields containing one row: the title
  "Analyze my portfolio automatically each weekday", the explanation "Runs once each weekday morning
  and counts as one run of your monthly limit." under it, and the switch at the right. Off is the default.
- Paused: the switch stays on (amber) and an amber line with a warning icon sits under the row:
  "Paused: you have used all N runs this month. It resumes on <date>." or "Paused: connect your Claude
  key to turn this on." (with "connect your Claude key" linking to /more/connect-claude).
- The switch saves on toggle (no separate Save button). Because POST /preferences replaces every field,
  the toggle must send the saved values of the other fields together with `auto_analysis`.
- Today: a recommendation that came from the scheduled run shows a small outlined pill "Automatic" with a
  clock icon next to the action chip. Manual ones show nothing. The existing "Last analysis" line stays.
