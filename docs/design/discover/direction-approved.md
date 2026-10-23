# Direction approved: Discover page

> Cleanup note (2026-10-21): the options that were not chosen, and the old screenshot scripts, were removed from this folder. They are in git history before commit `18ce2f5`; read any mention of them below as history. Regenerating screenshots: see [../README.md](../README.md).

Date: 2026-10-20

Shown: three options (`dc-a-list.html`, `dc-b-table.html`, `dc-c-cards.html`; screenshots were rendered to `shots/dca-*`, `dcb-*`, `dcc-*` and are not tracked, regenerate with `WIN=1340 ./shootall.sh`).

Chosen: option 1, List. User's words: "i will pick dc-a-list".

What this means: the reference as drawn. Search and Add Company on top (name, exchange and currency filled in on pick, duplicates shown as "Already in Discover", no shares or cost); the three filters (All, AI analyzed, Not analyzed) with counts and the sort menu (Name, Daily change, Recently added) on one line; then one card per company with logo, name and ticker, status, one-line AI insight when research exists, price and daily change, and its actions (View or Analyze, and Remove with Undo). Companies saved from Today appear in the list by themselves. Light and dark follow the Soft direction.

Open items this choice left (see `SPEC.md`, "Decisions for you", for where each landed): only single-company Analyze (#193) and the overview for a company without a report (#194) are still open.
