# ETF ideas: Today card and recommendation page (spec)

Approved mock: `etf-idea.html` (open with `?theme=dark` for dark). Decision record: `direction-approved.md`. Backend contract: `docs/ARCHITECTURE.md` (discovery, "ETF lane") and `docs/superpowers/specs/2026-11-16-etf-discovery-design.md`. All numbers and texts in the mock are invented sample data on a real fund listing.

## What an ETF idea is on screen

An `IdeaOut` with `asset_type == "ETF"`: `scores` is exactly `[fit]`, `overall` is that gap score, `peers` is empty, `snapshot.sector` is null, `snapshot.industry` is the Yahoo category, `snapshot.fundamentals` carries `expenseRatio` (a fraction: 0.0018 is 0.18%), `totalAssets` and `fundSizeEur`, `fit` carries the gap evidence. The branch is chosen by `idea.asset_type === "ETF"`; the stock layout stays byte-identical.

## Element to data mapping

Today card (direction A):

| Element | Source |
|---|---|
| Short name, ticker, "ETF · UCITS · Acc" | `idea.name` shortened by a rule; `ticker`; the UCITS and Acc words come from the name, or from the snapshot if the build adds them |
| Price and quote date | `snapshot.price` (EUR, major unit), `snapshot.price_as_of` |
| "Gap score 72" with a small track | the `fit` score in `idea.scores`; always the words "Gap score", never quality or overall |
| Confidence meter | `idea.confidence` (shape plus word) |
| Category chip | `snapshot.industry` |
| AI headline in a dashed box | `idea.headline`, labelled "AI headline" |
| Quality filter line | derived: cost from `expenseRatio`, size from `fundSizeEur`; "no overlap with your ETFs" is true for every saved idea; when size is unknown the line reads "Quality filter: 5 passed, size unknown" |
| Open research, Save | as the stock card |

Recommendation page Overview (direction C):

| Element | Source |
|---|---|
| Hero "If you add 5% of this fund" and the gap score as the result | `fit.hypothetical_weight` (0.05), the `fit` score and its `reasons`; "Qualifies" when the gap score is at least 50 (the ETF gate; stocks stay at 60) and confidence is medium or high |
| Volatility strip, now and with 5% | `fit.portfolio_vol_before`, `fit.portfolio_vol_after` (annualised fractions); part score from the fit reasons |
| Spread-of-money strip | effective positions = 1 / `fit.hhi_before` and 1 / `fit.hhi_after`; show "HHI 0.21 to 0.19" beside it |
| Correlation strip | `fit.avg_correlation_to_portfolio` against a 1.00 reference |
| Role it plays, bear case, catalysts, conclusion | `idea.thesis`, `bear_case`, `catalysts`, `conclusion` in dashed AI boxes marked "Written by AI"; catalysts only when present ("Dated events only") |
| Fund facts (side column) | `expenseRatio` as a percent per year, `fundSizeEur` via the compact EUR format, `industry`, structure and listing from the name and snapshot, ISIN if the snapshot carries it |
| Quality filter (side column) | six rows (cost, size, history, plain fund, cheapest of its kind, no overlap), each a filled tick and "Pass", or a dashed circle and "Unknown" for size. Values are shown where the idea holds them (cost, size); history and cheapest-of-kind show their rule text only (the idea does not store the close count or the near-copy list); add an optional backend field only if the owner later wants the values |
| Sources | `idea.sources` with tier and date; forum claims marked unverified |
| Rail: price, move since recommendation, suggested position, confidence, Approve / Dismiss / Save / Ask AI, advisory text | as the stock rail; suggested position is the Recommendation's `suggested_position_pct` (7.5% by default, 15% at gap score 80 or more); the move since the recommendation is the only green or red |
| Tabs | Overview, Price (the existing `PriceChart`), Sources |

States (in the mock): medium confidence with unknown fund size; the decided read-only strip and reduced rail (as `reopen-saved-company`).

## Rules that bind the build (DESIGN.md)

Rem sizes (the mock uses 0.875rem body, 0.75rem labels), green and red only for price moves, shape plus word for pass or unknown, AI text in dashed boxes, no peers table or quality and valuation scores for ETFs, advisory wording ("for human review, not a licensed advisor"), light and dark.

## Open questions

None blocking; the defaults taken are listed in `direction-approved.md`.
