# Direction approved: Portfolio page

> Cleanup note (2026-10-21): the options that were not chosen, and the old screenshot scripts, were removed from this folder. They are in git history before commit `18ce2f5`; read any mention of them below as history. Regenerating screenshots: see [../README.md](../README.md).

Date: 2026-10-20

Shown: three options (`pf-a-dashboard.html`, `pf-b-holdings.html`, `pf-c-explorer.html`; screenshots were rendered to `shots/pfa-*`, `pfb-*`, `pfc-*` and are not tracked, regenerate with `WIN=1340 ./shootall.sh`).

Chosen: option 3, Explorer. User's words: "i will pick option pf-c-explorer".

What this means: allocation first. A slim strip with total value, gain or loss, today's change and the value chart; then one large donut with Sector, Country and Currency tabs, where selecting a legend row filters the holdings list below it, next to the largest positions; then the holdings table with a row menu (edit, log a trade, remove); then risk facts with advanced analytics (correlation) on demand. No health score. The existing Holdings, This month, Saved plans and Orders views stay. Light and dark follow the Soft direction.

Still open (see `SPEC.md`, "Decisions for you"): which analytics to build first and whether a short history still shows volatility and correlation; where country and currency come from and whether the summary total is always EUR; whether the watchlist toggle and target weights stay as today or move into the row menu. Choice 1 of that list (which option) is resolved by this file.
