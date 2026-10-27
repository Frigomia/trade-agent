# The recommendation page and Track record in the Soft direction

Proposed 2026-10-27 for [#195](https://github.com/Frigomia/trade-agent/issues/195) (the Soft restyle of the screens still on the older look), after Plan, Account, Preferences and Chat. This is a mock and a plan, not a change to the app. Nothing is approved until the owner says so; then this folder gets a `direction-approved.md` like the others.

Mock: [rec-soft.html](rec-soft.html) (`rec.css`, `rec.js`; it loads the shared Soft files from `../today-discovery`, `../company-overview`, `../portfolio`, `../plan` and `../account`). Add `?theme=dark` to start dark; `?show=d-rec,phones` shows only some blocks and `?st=2-4` only some states. Screenshots in `shots/`, light and dark: `rec-desk` (the call), `rec-done` (decision recorded), `track-desk` (Track record), `rec-phones` and `rec-states`.

## What is covered

- **The recommendation page** (`/today/<id>`) for a call on a holding: the hero panel, Ask about this, the web second opinion, the decision bar, the "Decision recorded" confirmation, and the replaced and not-found notices. A discovery idea keeps the company page (the workbench), which is already Soft.
- **Track record** (`/more/track-record`): the two groups, the footnote, the rows, the empty and failed states.

Same content, same states, same copy as the app today. No new data, no new copy, no backend change.

## What changes

| Part | Today | Soft proposal |
|---|---|---|
| Back row | A back link and the round theme toggle | The same, with a 44px back link and a 44px round toggle on the Soft tokens |
| The call | A panel with the ticker, the action chip, "Automatic" and "Pending"; the price and its change; three evidence cells with a MUI progress bar | The same panel and cells; the fundamentals bar is the 8px Soft bar (amber under 60), the technical timing and position cells line up on one baseline, "Pending" gets a clock icon and the warning tint |
| Evidence on a phone | A panel with a row per piece | The same rows, 56px high, the number or signal as a pill |
| Ask about this | A small link | A 44px quiet link with the chat icon |
| Web second opinion | A dashed box | The same dashed box with the globe, a calmer 14px leading and a line between paragraphs; it stays "not part of the score" |
| Decision bar | A panel pinned at the bottom with the title, the note, Dismiss and Approve (on a phone Approve comes first) | The same bar and the same order on the Soft panel; on a phone the two buttons sit side by side with the note under them |
| Decision recorded | A centred block with a round icon, the sentence, an amber note, Log the trade I placed, Back to Today, Change my decision | The same content in one Soft panel: a 64px round icon (accent for approved, quiet for dismissed), the amber "No order was placed" box, a primary and a ghost button, a text link |
| Track record groups | A panel with two groups, a big "2 of 3" and a MUI bar | The same two groups on the Soft bar, the big number kept, the footnote in 12px |
| Track record rows | A list with the ticker, the action chip, the date line and the move with the verdict word | The same rows; the verdict gets an icon (a check, a cross, a dash) before its word, so it is never colour alone; the move stays green or red because it is a price move |
| Empty and failed states | A ring with "20 trading days", the title, the explanation, a button; an alert | The same, on the Soft ring, text and buttons |

Rules kept from `DESIGN.md`: sizes in rem (the screens, not the mock, are measured; nothing below 12px), green and red only for a price move (the move in a Track record row; the action chip and the verdict are neutral and carry an icon and a word), shape plus word for every status, AI text in a dashed box, 44px touch targets on a phone, no horizontal scroll at 390px. "Approving records your decision. Nothing is sent to a broker." and "No order was placed" stay.

## States in the mock

The call with and without a price or fundamentals, a caution tone (fundamentals under 60, a weak downtrend), a decision that could not be saved, dismissed, approved with the trade logged, changing the decision failed, replaced by a newer analysis, not found or could not load; Track record with scored calls, empty and could not load. Light and dark, desktop and phone.

## Decisions for you

1. **Approve the look**, or say what to change. One proposal on the approved Soft direction; say if you want alternatives.
2. **The verdict icons** on Track record (a check for Matched, a cross for Missed, a dash for Not scored) beside the words. A small addition for the shape-plus-word rule; the words stay.
3. **The "Pending" clock icon** on the call. Same reason.
4. **Build:** one PR for the recommendation page and one for Track record (they share only the action chip), or one for both. Recommended: two PRs, the recommendation page first.

## Build notes (after approval)

- Components: `app/(shell)/today/[id]/page.tsx`, `RecommendationDetailDesktop`, `EvidenceDetail`, `DecisionActions`, `ConfirmationPanel`, `AskAboutThis`, `WebOpinionBox` (shared with Chat and the workbench, so keep its look), `app/(shell)/more/track-record/page.tsx`, `TrackRecordEmpty`. Reuse `Panel`, `Pill`, the Soft bar and the tokens; the MUI `LinearProgress` in the hero and the Track record groups becomes the Soft bar with `role="progressbar"`.
- Keep every test that asserts text, roles or labels.
- The off-ramp sizes (0.90625rem, 0.84375rem, 1.0625rem) in these files move onto the type ramp.
- A browser pass at 1280, 390 and 320px, light and dark, with a long ticker, a missing price and a very long analysis before each PR.
