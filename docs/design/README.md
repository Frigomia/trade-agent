# Design records

Static HTML mocks and the decisions behind them. Nothing here is shipped code: the app is in `frontend/`, and `docs/ARCHITECTURE.md` is the design spec for data, API and agents.

## How a decision is recorded

Every folder is one feature. Its `direction-approved.md` is the gate file and the single place that says:

- which options were shown,
- which one was chosen, with the user's own words,
- what that choice means for the build (and what is still open).

A folder may also have a `SPEC.md` (or `README.md`) with the element-to-backend mapping and the open questions. When the two disagree, the gate file wins.

## Index

| Folder | Feature | Chosen | Date | Status |
|---|---|---|---|---|
| [recommendations](recommendations/SPEC.md) | Soft restyle of the recommendation page and Track record ([#195](https://github.com/Frigomia/trade-agent/issues/195), next screens) | Proposed, pending approval | 2026-10-27 | Not built |
| [chat](chat/SPEC.md) | Soft restyle of Chat ([#195](https://github.com/Frigomia/trade-agent/issues/195), next screen) | Approved as proposed | 2026-10-27 | Built (#195 next screen) |
| [account](account/SPEC.md) | Soft restyle of Account and Preferences ([#195](https://github.com/Frigomia/trade-agent/issues/195), second screen) | Approved as proposed | 2026-10-27 | Built (#195 second screen: Account, then Preferences) |
| [plan](plan/SPEC.md) | Soft restyle of the Plan views: This month, Saved plans, Orders ([#195](https://github.com/Frigomia/trade-agent/issues/195), first screen) | Approved as proposed | 2026-10-26 | Built (#195 first screen) |
| [discover-company](discover-company/direction-approved.md) | Basic company overview and single-company Analyze (#193, #194) | Approved layout and policies | 2026-10-26 | Implementation supplied by feature/discover-company-analysis |
| [mockups](mockups/direction-approved.md) | The original app direction and screens | Direction A, "Emerald Glass" (teal), dark and light | 2026-09-28 | Built |
| [claude-keys](claude-keys/direction-approved.md) | Connect Claude (guide, locked states, Account) | A, one step at a time | 2026-10-06 | Built |
| [scheduled-analysis](scheduled-analysis/direction-approved.md) | Scheduled analysis switch in Preferences | A, a row in the Preferences panel | 2026-10-06 | Built |
| [telegram](telegram/direction-approved.md) | Telegram panel on Account | C, live preview | 2026-10-07 | Built |
| [contribution-planner](contribution-planner/direction-approved.md) | Monthly contribution planner | C, ledger | 2026-10-08 | Built |
| [portfolio-nav](portfolio-nav/direction-approved.md) | Holdings, This month, Saved plans strip and Plan sidebar item | Tab strip | 2026-10 | Built |
| [orders-tab](orders-tab/direction-approved.md) | Orders tab | A, stacked plan sections | 2026-10 | Built |
| [order-tickets](order-tickets/direction-approved.md) | Order tickets and placed orders | D, hybrid | 2026-10 | Built |
| [empty-states](empty-states/direction-approved.md) | Empty Today and empty Portfolio | Quiet ring (Today), inline first holding (Portfolio); inferred from the code | before 2026-10-20 (recorded 2026-10-21) | Built; choice not recorded at the time |
| [today-discovery](today-discovery/direction-approved.md) | Today with discovery sections | Soft (`v2-b-soft`) | 2026-10-20 | Built (#145, #147, #148, #157, #170); the Today search bar was dropped ([#211](https://github.com/Frigomia/trade-agent/issues/211)) |
| [company-overview](company-overview/direction-approved.md) | Company detail page | Workbench | 2026-10-20 | Built (#149, #150, #158 to #161); catalyst dates and bull-claim statuses are not built ([#198](https://github.com/Frigomia/trade-agent/issues/198)) |
| [portfolio](portfolio/direction-approved.md) | Portfolio page | Explorer | 2026-10-20 | Built |
| [discover](discover/direction-approved.md) | Discover (watchlist) | List | 2026-10-20 | Built (#168, #169, #176, #177); company overview and Analyze added by feature/discover-company-analysis (#193, #194) |

Palette note: everything above the 2026-10-20 rows uses the teal "Emerald Glass" palette; the four newest folders use the Soft palette (blue accent), which changes `DESIGN.md` when it is built.

"Built" means the feature exists in `frontend/`, with what is still missing named in the Status column; "Designed" means the direction is approved and the build waits on the backend gaps listed in that folder's `SPEC.md`. The open decisions of a folder are in the "Decisions for you" list of its `SPEC.md`, each marked resolved (with the date and the pull request) or open (with the ticket that owns it).

## Rules for new design work

1. Show three real options, wait for the choice, then write `direction-approved.md` with the user's words before building.
2. Keep only the chosen option, its shared CSS and JS, the spec and a few screenshots in the folder. The options that were not chosen live in the pull request and in git history; do not leave them in the tree.
3. Give a folder a `SPEC.md`, not a `README.md`, when it maps the design to the backend.
4. Screenshots are regenerated, not stored: a folder's `shots/.gitignore` keeps them out of git (the older folders still hold the chosen option's shots).

## Shared files and dependencies

- `today-discovery/lib.css` and `lib.js` are the shell (sidebar, phone frame, icons, sample-data helpers) for `today-discovery`, `company-overview`, `portfolio` and `discover`.
- `company-overview/soft.css` (the Soft theme) and `co.css` (section components) are loaded by `portfolio` and `discover` as well.
- Do not delete these without updating the pages that load them.

## Regenerating screenshots

`docs/design/tools/shootall.sh <folder> <page>:<key>` renders the desktop, phone and states sections in dark and light with headless Chrome, for example:

```
WIN=1340 docs/design/tools/shootall.sh discover dc-a-list:dca
```

It works for the four folders whose pages have those sections (`today-discovery`, `company-overview`, `portfolio`, `discover`). The older folders' screenshot scripts were machine-specific and tied to drafts that are gone, so they were removed; open the page in a browser (`?theme=dark` for dark) to see it.

## Where the pruned options went

The options that were not chosen, and the old per-folder screenshot scripts, were removed in the design-docs cleanup. They are in git history before commit `18ce2f5`, for example `git show 18ce2f5:docs/design/telegram/a-quiet-panel.html`.
