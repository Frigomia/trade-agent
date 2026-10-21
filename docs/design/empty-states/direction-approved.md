# Empty states: design direction (recorded afterwards)

Date recorded: 2026-10-21. The mocks date from before 2026-10-20 and were committed with the Today mocks in PR #137; no gate file was written when they were shown.

## Shown

Two sets of three options, in dark and light: the empty Today screen (`a-guided-steps`, `b-ghost-preview`, `c-quiet-ring`) and the empty Portfolio screen (`a-two-doors`, `b-first-holding-inline`, `c-ghost-portfolio`).

## Chosen

The user's words were not recorded. The choice is inferred from what was built in `frontend/`:

- Today: C, quiet ring. `frontend/components/recommendations/TodayEmpty.tsx` shows the first steps with the `Ring` component.
- Portfolio: B, first holding inline. `frontend/components/portfolio/FirstHolding.tsx` is the empty Portfolio page: a short form for the first holding with name, type and date behind an "optional" row.

If this inference is wrong, correct this file; the other options are in git history before commit `18ce2f5`.

## Kept in this folder

`c-quiet-ring.html` and `portfolio/b-first-holding-inline.html` with their shared `base.css`, `shell.js` and `portfolio/p.css`, and their screenshots. Unchosen drafts were pruned in the design-docs cleanup.
