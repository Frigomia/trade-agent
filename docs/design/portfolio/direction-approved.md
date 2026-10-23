# Direction approved: Portfolio page

> Cleanup note (2026-10-21): the options that were not chosen, and the old screenshot scripts, were removed from this folder. They are in git history before commit `18ce2f5`; read any mention of them below as history. Regenerating screenshots: see [../README.md](../README.md).

Date: 2026-10-20

Shown: three options (`pf-a-dashboard.html`, `pf-b-holdings.html`, `pf-c-explorer.html`; screenshots were rendered to `shots/pfa-*`, `pfb-*`, `pfc-*` and are not tracked, regenerate with `WIN=1340 ./shootall.sh`).

Chosen: option 3, Explorer. User's words: "i will pick option pf-c-explorer".

What this means: allocation first. A slim strip with total value, gain or loss, today's change and the value chart; then one large donut with Sector, Country and Currency tabs, where selecting a legend row filters the holdings list below it, next to the largest positions; then the holdings table with a row menu (edit, log a trade, remove); then risk facts with advanced analytics (correlation) on demand. No health score. The existing Holdings, This month, Saved plans and Orders views stay. Light and dark follow the Soft direction.

Open items this choice left (see `SPEC.md`, "Decisions for you", for where each landed): none; all are resolved.
