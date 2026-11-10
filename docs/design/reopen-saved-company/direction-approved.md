# Direction approved: Reopen a saved company from Discover

Date: 2026-11-09 (mock approved; built, #283)

Issue: [#283](https://github.com/Frigomia/trade-agent/issues/283).

Shown: no three-option round. The direction was chosen in chat before any mock existed, so the three-direction gate does not apply (an iteration on an already chosen direction, and the owner named the choice).

Chosen: "yes option C plus D" (2026-11-09). C: open the same company page read-only with a decision banner. D: mark the Discover card with a decision chip and label its button "View decision". Removing a decided item from Discover (A) was rejected. The owner then confirmed the ticket text ("looks good") and asked to start the design pass with the existing design skills.

Extends, does not restyle: `../company-overview/co-c-workbench.html` (the Workbench, chosen 2026-10-20) and `../discover/dc-a-list.html` (the Discover list).

Mock approved: `reopen.html`, after one review round. Owner's words: "looks good" (2026-11-09).

The owner did not answer open questions 1 and 2 in `SPEC.md`, so the build keeps their defaults: the Newer analysis strip has no dismiss control, and the sidebar keeps highlighting Today. Either can be changed later without redoing the design. Question 3 was resolved during the build (2026-11-09): "Run a new analysis" is shown on the withdrawn page but disabled ("Re-running a researched company is not available yet."), because the analyze endpoint returns the saved result for a researched company; making it work is a separate ticket.

What changed from the approved mock while building (recorded in `SPEC.md`, "Changed during the build"): the disabled Run a new analysis; a live price and the move since the recommendation on the decided and withdrawn rails (the by-id endpoint attaches a live quote and normalises a pence quote to the major unit for discovery ideas); the successor taken from any source; a "See sources" row on the rails.

What this means for the build: see `SPEC.md`.
