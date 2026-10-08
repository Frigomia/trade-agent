# Portfolio with Plan as a view: mockup

Static mockup of one decided change (no app code). `index.html?v=holdings|month|saved`, add `&theme=light`
and/or `&view=phone`. Reuses `../contribution-planner/` (base.css tokens, shell.js icons, cp.css/cp.js for
the approved ledger); `pn.js`/`pn.css` add the sidebar, view strip, holdings and watchlist. `node shoot.mjs`
writes `shots/{desktop,phone}-{dark,light}-{holdings,month,saved}.png` and reports horizontal scroll at 390 px.

## What changes vs today

- Plan stops being a separate page reached by the "Plan this month's contribution" link and the
  "Portfolio / Plan" breadcrumb: Portfolio gets a segmented strip "Holdings | This month | Saved plans"
  (same style as the approved Plan tabs) and the title stays "Portfolio" on all three. Header actions are
  unchanged: Record snapshot, Add holding, Log a trade, theme toggle.
- Holdings table gains a "Weight / Target" column (weight, target, a small bar with the target tick);
  a holding without a target shows a muted "Set target". On a phone the second line reads
  "1.4 sh · 51.7% / target 51%".
- Watchlist rows for tickers you own say "Owned · target on the holding" and lose the edit pencil, so a
  target lives in one place; a not-owned ticker (NVDA) keeps "Watching · target 5%" and its pencil.
- Desktop sidebar: "Plan" is an indented sub-item under Portfolio. Portfolio is lit on Holdings; on the
  plan views Plan is lit and Portfolio stays as the unlit parent. The phone tab bar keeps its 4 slots
  with Portfolio lit on all three views.
- Phone header follows the app's wrapping PageHeader: title and theme toggle, then the three actions in
  one row; the strip fits 390 px in three equal segments.

Note: the phone second line uses target 51% for CSNDX.SW to match the desktop data (the brief said 52%).
