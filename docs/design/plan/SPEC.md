# Plan in the Soft direction (This month, Saved plans, Orders)

Proposal, 2026-10-26, for [#195](https://github.com/Frigomia/trade-agent/issues/195) (the Soft restyle of the screens still on the older look), first screen of the list: the three Plan views of the Portfolio page. The owner chose Plan as the first screen. This is a mock and a plan, not a change to the app.

Mock: [plan-soft.html](plan-soft.html) (`plan.css`, `plan.js`; it loads the shared Soft files from `../today-discovery`, `../company-overview` and `../portfolio`). Add `?theme=dark` to start dark. Screenshots in `shots/`: desktop, phone and states, light and dark.

## What changes and what does not

Same content, same states, same copy as the app today. The Portfolio page already has the Soft title and the pill segmented control (Holdings, This month, Saved plans, Orders, with the open-orders count). What is still on the older look, and is restyled here:

| Part | Today | Soft proposal |
|---|---|---|
| Form (amount, Whole shares only, Make plan) | Outlined MUI field and switch in a flat panel | One white panel with a pill field (EUR suffix), a Soft switch and the primary button; the saved-amount hint on the right, under the field on a phone |
| Ledger | A table in a flat panel, 12.5/14/15px text | One panel with a header (title, "N funded", "N left out" chips), round logos, 13px body text, the same weight bar (before, after, target tick), left-out tickers muted at 0.00, a total band |
| Notes, legend, Save plan | Loose text under the table | The same, on the page background; Save plan is the primary button, full width on a phone |
| Saved plans | A table with an Open button per row | A months table where the whole row opens the plan; the open plan has its own heading and a quiet danger button to delete |
| Orders | A stacked card per line | One panel per plan with a progress count, "Copy all lines", collapsed lines (a placed line shows a check and the placed note), the open line's ticket with Copy and Placed side by side (48px), the ISIN row |
| Placed sheet, delete dialog | Default MUI dialogs | A Soft dialog; a bottom sheet on a phone |
| Callouts (no targets, nothing to fund, no saved plans, no open orders) | Plain panels | One callout panel with the title, the explanation and one action |

No new data: every field in the mock is in the plan and orders responses the app already reads (`/plans`, `/plans/orders/open`, `/portfolio/summary`). No backend change, no new copy beyond the lines already in the app, no Buy or Sell wording, and "Advisory only. Nothing is sent to a broker." stays on every view and in the Placed sheet.

Rules kept from `DESIGN.md`: sizes in rem (the mock uses the Soft tokens, 13px body, 12px label, 15px lead, 20px title), the readable floor of 0.75rem, green and red only for a price move, with three exceptions to settle at approval: the Delete plan button and the invalid-amount error are red (destructive and error), and the notes and the old-plan banner use the warning amber that the app already uses for notes (the "Open" and "funded" chips are blue), shape plus word for every status (the Placed line has a check and the word), 44px touch targets (48px for Copy and Placed), no horizontal scroll at 390px.

## States in the mock

This month: result, Whole shares only, the amount changed since the plan ("This plan is for 500.00 EUR. Press Make plan to update."), an invalid amount, saved, no targets yet, nothing to fund, loading. Saved plans: the table with an open plan, none yet, delete confirmation. Orders: an open line, Copied pressed, the next line opened after Placed, an old plan, none open, could not load. Placed sheet, and the variant for a ticker that is not a holding yet (asset type, "Recording this order adds it to your holdings").

## Decisions for you

1. **Approve the look**, or say what to change. This is one proposal on the approved Soft direction, not three options: the direction was chosen on 2026-10-20 and this applies it to existing screens, as #195 asks. Say if you want alternatives for any view.
2. **Left-out tickers stay in the ledger at 0.00** (as approved before) rather than moving to a separate "Left out" list. Open until you approve.
3. **The Orders count badge** on the tab stays (it is built today); the mock shows it.
4. **Build order after approval:** one build PR for the three views and their dialogs (the components are small and share the ledger), or one PR per view. Recommended: one PR, in two commits (This month and Saved plans, then Orders and the sheets).

## Build notes (after approval)

- Components: `PlanForm`, `PlanResult` (the ledger), `PlanHistory`, `OrdersView`, `OrdersSection`, `OrdersPanel`, `PlacedSheet`, `IsinRow`, and `NoTargets` in the plan page. Reuse `SegmentedControl`, `Panel`, `Logo` and the Soft tokens; the weight bar already exists in `PlanResult`.
- Keep every test that asserts text or roles; add a phone check that the ledger rows have no horizontal scroll at 390px.
- The off-ramp sizes in these components (0.78125rem and similar, converted from pixels in #192) move onto the type ramp as part of this restyle.
- A browser pass at 1280, 390 and 320px, light and dark, before the PR.
