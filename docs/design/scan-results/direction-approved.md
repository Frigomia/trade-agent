# Direction approved: Scan results

Shown (2026-10-28): four page skeletons on the same content and tokens: a sectioned page, a single ledger, the funnel as the page and a list with a reader. [SPEC.md](SPEC.md) maps the chosen one; the mock is [scan-results.html](scan-results.html), with screenshots in `shots/`, light and dark, desktop, phone and every state.

Chosen by the owner: "A", the single ledger. The owner merged the proposal (#254) and, asked whether to build, chose "Approved, build it" for [#196](https://github.com/Frigomia/trade-agent/issues/196): the ledger as drawn, the route `/today/scan` reached from a new "Scan results" link on the scan bar, saving the below-the-bar companies (a small backend change), leaving `excluded` on `GET /discovery/ideas`, and one pull request.

What this means for the build:

- The page reads the saved ideas Today already reads (no provider call, no Claude key). One filterable ledger of set-aside companies, companies not researched and mentions not admitted; a row opens to the scan's explanation in the dashed box and its sources, drawn as links only through `safeHref`. Coverage notes and the counts from the saved scan; a scan saved before the counts or the below-the-bar records shows a note.
- Backend: `save_scan` writes `coverage_summary.set_aside_ideas` (ticker, name, overall, confidence; at most the shortlist size); `nearest_misses` keeps its rule and is its first three.
- The scan bar and the no-opportunity panel gain a "Scan results" link whenever a saved scan exists.
