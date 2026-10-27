# The Signal backtest in the Soft direction

Proposed 2026-10-27 for [#195](https://github.com/Frigomia/trade-agent/issues/195) (the Soft restyle of the screens still on the older look), after Plan, Account, Preferences, Chat, the recommendation page and Track record. This is a mock and a plan, not a change to the app. Nothing is approved until the owner says so; then this folder gets a `direction-approved.md` like the others.

Mock: [bt-soft.html](bt-soft.html) (`bt.css`, `bt.js`; it loads the shared Soft files from `../today-discovery`, `../company-overview`, `../portfolio`, `../plan` and `../account`). Add `?theme=dark` to start dark; `?show=d-bt,phones` shows only some blocks and `?st=2-4` only some states. Screenshots in `shots/`, light and dark: `bt-desk` (a result), `bt-empty` (first visit), `bt-phones` and `bt-states`.

## What changes and what does not

Same content, same states, same copy as the app today (the name "Signal backtest" and the subtitle are the ones from #233). No new data, no new copy, no backend change. The result's chart is the one the app draws today, shown here with sample data.

| Part | Today | Soft proposal |
|---|---|---|
| Layout | The run form, the result and the recent runs in a grid | The same grid: form and recent runs in a 340px column on a desktop, the result beside them; one column on a phone (form, result, runs) |
| Run form | MUI outlined fields (a ticker picker and two date fields) | Soft fields with the label above (the ticker with a search icon), the primary Run backtest button, the "Starts with 10,000 ..." note |
| Running | A line of text under the dates | The same line with the three dots, announced as a status; the button greys out |
| Errors | A MUI alert under the dates; a warning when the run fails; an error when a result will not load | The shared error and amber boxes, same copy |
| Result header | The ticker and range, "Signal strategy vs buy and hold", a pill with the edge | The same; the pill keeps its up or down tone (it is a return against buy-and-hold) and gets an arrow beside its words, so it is never colour alone |
| Final values | Two figures | The same two figures, 26px, with the "Both start from 10,000.00" line |
| Chart | The equity curve, strategy against buy and hold, with a legend of the two ranges | Unchanged in what it shows: the accent line over its soft fill, buy and hold dashed and muted, the same ticks and legend |
| Hit-rate table | A MUI table | A quiet table with hairlines between rows, right-aligned numbers, the move in green or red (it is a price move) |
| Recent runs | A MUI list with a pill per run | Rows with the ticker, the range and the pill; the open run is tinted; 56px rows |
| Empty and failed states | "No backtests yet." and an error alert | The same text in the Soft panel and boxes |

Rules kept from `DESIGN.md`: sizes in rem on the build (the mock's px are its own base), green and red only for a price move or return, shape plus word for every status, 44px touch targets on a phone, no horizontal scroll at 390px. "Past performance is not a forecast. Simulated on past prices only; nothing is sent to a broker." stays.

## States in the mock

A result, first visit (no runs, no result), running, a ticker that is not valid, dates the wrong way round, a run that failed, a result that could not load, behind buy-and-hold, no signals fired, recent runs empty and failed. Light and dark, desktop and phone.

## Decisions for you

1. **Approve the look**, or say what to change. One proposal on the approved Soft direction; say if you want alternatives.
2. **The arrow beside the edge pill** ("Ahead of buy-and-hold by +8.9%"). A small addition for the shape-plus-word rule; the words stay.
3. **Build:** one PR (one page, three small components, the chart unchanged).

## Build notes (after approval)

- Components: `app/(shell)/more/backtests/page.tsx`, `RunForm`, `BacktestResultPanel` (and its table), `BacktestChart` (colours only, if at all), `TickerPicker` (shared; keep its behaviour). Reuse `Panel`, `Pill` and the Soft tokens; the MUI `List` for recent runs becomes buttons that keep `aria-pressed` or `aria-current` for the open run.
- Keep every test that asserts text, roles or labels.
- The off-ramp sizes (1.0625rem, 1.375rem and similar) in these files move onto the type ramp.
- A browser pass at 1280, 390 and 320px, light and dark, with a long ticker, a result with no signals and a range of ten years before the PR.
