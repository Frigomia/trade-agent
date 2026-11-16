# Direction approved: ETF ideas (Today card and recommendation page)

Date: 2026-11-16

Issue: [#296](https://github.com/Frigomia/trade-agent/issues/296) (task 11 of the ETF-ideas plan). Backend and the minimal ETF rendering are in PR #298; this folder designs the proper ETF idea layout.

Shown: three real options, each a full mock (Today card, desktop page, phone page, states strip, light and dark), built by three independent designers on the same sample fund (iShares Core MSCI EM IMI UCITS ETF, Acc) and the same data.

- A, "Gap first": the approved Workbench unchanged in its frame; the Overview opens on a big gap score with its three parts, a one-row quality filter and the fund facts in the Numbers tile grid.
- B, "Fund passport": a factsheet layout; a passport strip of fund facts, then "Why this qualifies" with the six quality checks beside a now / with-5% evidence table; the gap score a small badge.
- C, "Before and after": the hero is the person's portfolio now against the same portfolio with 5% of the fund, one strip per measured part (volatility, spread of money, correlation), the gap score as the result; fund facts and the quality filter in a narrow side column.

Chosen: the Today card from A and the recommendation page Overview from C, merged into `etf-idea.html`. Owner's words: "for the card of the recommendation we will use option A, and C for the overview" (2026-11-16), then, after seeing the merged mock, "yes looks good" (2026-11-16).

Why (the assistant's recommendation had been B; the owner chose differently, so this is the owner's call): the before-and-after picture shows what the idea does to this portfolio at a glance; A's card keeps the Today list compact and level with the stock cards.

Not chosen: B, and A's page and C's card. They were never committed and are deleted from the tree (the options not chosen live only in this record).

Extends, does not restyle: `../company-overview/co-c-workbench.html` (the Workbench) and `../today-discovery/` (the Today list). Uses `soft.css`, `co.css`, `lib.css`, `lib.js` and `co.js` from those folders.

Open points the owner did not decide, so the build takes these defaults (each can change later without redoing the design):

1. Correlation is drawn against a "moves exactly with you" reference of 1.00; there is no "before" correlation.
2. Strip ranges are set by a rule: pad both values by a fixed margin and round to a tidy scale (the mock's 13 to 16 percent, 4 to 6, 0 to 1 are hand-set).
3. The frontend computes effective positions as 1 / HHI from the HHI the idea already carries.
4. Tabs for an ETF are Overview, Price and Sources; there is no Numbers or Risk tab (the fund facts and quality filter sit in the Overview side column). The Price tab reuses the existing `PriceChart`.
5. An unknown fund size shows as "Unknown" (a dashed circle and the word), never "Fail"; the rail says confidence is medium and why.
6. The "No overlap with your ETFs" check shows Pass and its limit with no number (the backend does not expose the highest correlation).
7. When a check is unknown the Today card says "Quality filter: 5 passed, size unknown" (not drawn in the mock).
8. The card shortens the fund name by dropping the trailing "UCITS ETF (Acc)" style suffix; the page shows the full name.

What this means for the build: see `SPEC.md`.
