# Reopen a saved company: Approved, Dismissed, Withdrawn, newer analysis

Status: built (#283), 2026-11-09. The mock was approved the same day for [#283](https://github.com/Frigomia/trade-agent/issues/283); the build differs from it in the five ways under "Changed during the build". The company and its numbers in `reopen.html` are fictional.

Open `reopen.html` (add `?theme=dark`, and `?only=desk|phones|states`). `WIN=1340 docs/design/tools/shootall.sh reopen-saved-company reopen:rsc` regenerates the screenshots in `shots/` (not tracked). It loads the shared files of the Workbench and Discover mocks and changes none of them.

## The idea

A person reopening an idea they already decided on asks two things: what did I decide, and where is it now? Today the page answers neither: a decided idea shows a centred "Decision recorded" card (right only straight after deciding) and a superseded one says "A newer analysis replaced this recommendation" even when nothing replaced it.

So the research page stays the research page. One **status strip** between the company header and the tabs says what happened. The rail leads with the current price and how it moved since the recommendation, then the actions that still make sense. The four tabs are unchanged and read-only.

## States

| State | Opened when | Strip | Rail actions |
|---|---|---|---|
| Waiting, newer analysis | Opened an older recommendation that a newer one replaced, and that newer one is still pending | "Newer analysis", updated date, one sentence | Approve, Save to Discover, Dismiss, Ask AI (unchanged) |
| Approved | Status `APPROVED` | Approved chip, date, "No order was placed; trade-agent never trades. If you acted on it in your broker app, log the trade you placed." | Log the trade I placed (primary), Change my decision, Ask AI |
| Dismissed | Status `REJECTED` | Dismissed chip, date, the person's own note if there is one | Change my decision, Ask AI |
| Withdrawn | Status `SUPERSEDED` and no newer recommendation exists | Withdrawn chip, date, "The latest scan no longer found this compelling. The research below is the earlier analysis ...; nothing replaced it." and the scan's saved reason in a dashed AI box, labelled with its source and date | Company overview (primary), Run a new analysis (shown but disabled, see "Changed during the build"), Ask AI |

Right after deciding, the existing "Decision recorded" confirmation still appears once, with one new link, "View the company page". It is client state of that visit, not a route, so a refresh, the back button or reopening shows the decided page with its strip instead.

## Rules applied

- Status is shape plus word, never colour: a check-circle (Approved, accent wash), an x-circle (Dismissed, outlined), a slashed circle (Withdrawn, muted outline). Green and red appear only on the price move since the recommendation.
- AI text sits in the dashed box: the withdrawn reason. The person's own dismissal note and the system sentences do not.
- "Replaced" is used only when a replacement exists. A withdrawn idea never says it.
- Withdrawn and decided views offer no Approve or Dismiss. "Change my decision" keeps the existing reversal behaviour (the backend allows the opposite action on an `APPROVED` or `REJECTED` recommendation).
- No trade control anywhere. "Log the trade I placed" is the existing past-tense trade log.
- Sizes follow DESIGN.md (rem in the build; the mock uses its own px tokens like the other mocks). 44px targets on a phone. Tabs, keyboard behaviour and the chart are the Workbench's.

## Discover card

The status pill becomes a decision chip: AI analyzed (unchanged, waiting), Approved, Dismissed, Withdrawn. The first button reads "View decision" for Approved and Dismissed, and "View" otherwise. For a withdrawn idea the one-line reading is replaced by a fixed sentence, since the old reading is no longer the latest view (the mock shows the scan's reason; the list endpoint does not return it). The company name keeps linking to the company overview. Edit and Remove are unchanged.

## Data and behaviour for the build

- **Which recommendation opens.** Resolve the ticker's newest discovery recommendation (the same query as `_analysis` in `backend/app/routers/discover.py`). If the opened one is `SUPERSEDED` and a newer recommendation of the ticker exists (any source: a manual or scheduled analysis also replaces a pending idea), redirect to it with `?from=superseded`. The strip's wording depends on the newer one: still pending, it reads "Newer analysis ... still waiting for your decision"; already approved or dismissed, the page shows that decision's strip instead, with no "waiting" claim. If none exists, show Withdrawn. The strip is driven by the query parameter, so a refresh keeps it and it has no dismiss control.
- **Withdrawn reason.** Comes from the scan's saved explanation for the ticker (`CompanyAnalysis.reason` or the scan ledger entry, including `thesis_invalidated`). Needs a read path that returns it for a superseded recommendation. If it is missing, show the strip without the dashed box.
- **Price since recommended.** `price_at_recommendation` and the current quote, both already on the recommendation payload. Hidden when either is missing.
- **Decision date.** `reviewed_at`. **Note.** `dismissal_reason`.
- **Withdrawn date.** A superseded idea has no review date. Use the `created_at` of the scan (or single-company analysis) that withdrew it, from the same read path as the reason; when it is not available, show the chip without a date.
- **Rendering.** Every note and reason (the person's dismissal note, the AI's withdrawn reason) is rendered as text, never as markup. The mock builds strings for brevity; the build uses React's normal escaping.
- **Run a new analysis.** Disabled in the build (see "Changed during the build"); the mock's working button is not built.
- **Scope.** Discovery ideas (the Workbench). Recommendations without an idea keep their existing pages and the existing confirmation panel.
- **Confirmation once.** Show `ConfirmationPanel` only while the page holds the decision made in this visit; otherwise render the Workbench with the strip.
- **Privacy.** Everything is the owner's own saved data behind the existing per-user access; no new table.

## Changed during the build

The build follows the mock except for these (recorded 2026-11-09):

1. **Run a new analysis is shown but disabled**, with "Re-running a researched company is not available yet." beneath it, and Company overview is the primary action. The analyze endpoint (`POST /discover/{ticker}/analyze`) returns the saved result for a researched company, so a working button would run nothing. Making it work is a separate ticket (owner decision).
2. **The decided and withdrawn rails show the live price and the move since the recommendation.** The by-id endpoint now attaches the live quote to a discovery idea of any status (it did so for pending rows only) and, for a discovery idea, returns `current_price` in the major unit so it compares with `price_at_recommendation` (a London quote is pence). When the live quote is missing or not positive the rail shows the saved quote and no move.
3. **The successor is the newest later recommendation of any source and status**, not only a discovery one, because a manual or scheduled analysis also replaces a pending idea. The new field is `successor_id`; `withdrawal` `{kind, reason, as_of}` is returned only when there is none.
4. **The rails have a "See sources" row** (the source count and a link to the Sources tab), as the pending rail does.
5. **The Discover chip and the withdrawn reading.** The Discover item carries `report_status`; the chip is shape plus word. A withdrawn card shows a fixed sentence ("The latest scan no longer found this compelling.") rather than the scan's reason, which the list endpoint does not return.

## Open questions

Questions 1 and 2 stay at their defaults (the owner did not answer); 3 is resolved.

1. The sidebar highlights Today for this page because the route is `/today/[id]`, even when you arrive from Discover. The mock mirrors that. Worth highlighting Discover when the link came from there?
2. The "Newer analysis" strip stays for as long as the redirect parameter is in the address and has no dismiss control. Is that enough, or should it be dismissible?
3. Resolved 2026-11-09: "Run a new analysis" stays on the withdrawn page but disabled ("Re-running a researched company is not available yet."), because the analyze endpoint returns the saved result when one exists. Making it work is a separate ticket.
