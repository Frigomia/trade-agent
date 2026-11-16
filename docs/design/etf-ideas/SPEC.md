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

## Changed during the build

What the build (#296) does differently from the approved mock `etf-idea.html`:

- The ETF qualifying gate is 50 (stocks stay at 60), so the mock's sample gap score of 72 and its part scores were illustrative. The part scores shown are recomputed from the saved fit with the backend formula and appear only when they agree with the saved gap score (the backend does not save them).
- Fund facts has no ISIN row: the saved idea carries no ISIN. Listing shows exchange and currency only.
- The Overview ends with the full sources list (the same one as the Sources tab), not the mock's compact cited list. On a phone, fund facts and the quality filter come after the conclusion and before the sources, as in the mock.
- The Today card keeps the round logo (the mock draws none). Below the `xl` breakpoint the quote sits on its own row under the name instead of at the right of the header, because the real three-column Today grid makes the card about 285px wide.
- The top-opportunity card for an ETF reuses the same body, so it shows two dashed boxes: the AI headline, then Why now, Risk to the thesis and sources. The mock shows only the list card.
- The unknown-size filter line on the card uses a question-mark circle instead of the filled tick, so it does not claim that every check passed.
- A negative correlation is drawn pinned at the left end of the fixed 0 to 1 scale, with the words "below the scale" in its value and label. The left "0" end label is hidden there so it does not collide with "This fund".
- The right column wrapper (rail plus fund panels) exists only for ETFs; the stock rail stays a bare grid item, so it still sticks.
- The quality filter shows values only where the idea holds them (cost, size); the other rows show their rule text, and no correlation number is printed.
- The page header has the mock's tag row (ETF, UCITS, Accumulating or Distributing, and the category chip) under a listing line of ticker, exchange and currency. It has no ISIN, as the saved idea carries none.
- The decision rail (pending and decided) has the mock's Suggested position block, read from the saved `suggested_position_pct`. The frontend does not know the saved maximum, so the bar and the sentence appear only for 7.5% (half of 15%) and 15% (the full maximum); any other size shows the value alone. On a phone the rail is not shown, so the mock's "7.5% suggested" in the phone summary is not built.
- A correlation below -0.1 reads "Tends to move against your holdings"; the strip scale and the "below the scale" wording are unchanged (see the open questions).
- The overlap filter row says "Not a near-copy of an ETF you hold (same category, correlation 0.95 or more)", matching the backend rule.
- The tab list is named "Fund sections" for an ETF.

## Open questions

None blocking; the defaults taken are listed in `direction-approved.md`. Still open for the owner:

- Optional backend fields to show the quality-filter values: the length of price history, the near-copy list (the cheaper funds of the same kind) and the highest correlation to a held ETF. Without them those rows show the rule only.
- An ISIN on the saved idea, so Fund facts can show the row the mock has.
- The mock's sample scores (gap 72 and its parts) are invented; the real ones for typical funds are lower (about 37 for world equity, 54 for government bonds). Say if a sample note should appear anywhere, or if the 50 gate (against 45) should change; it is one backend constant plus the frontend `ETF_GATE`.
- The correlation strip is a fixed 0 to 1 scale, so a hedge or bond ETF with a negative correlation is pinned at the left end ("below the scale"). Say if the scale should extend below 0.
- Today ranking: the feed sorts by overall, so ETF gap scores of 50 to 56 sort below stock overalls of 60 or more (backend/app/discovery/feed.py). Say if ETF ideas should rank separately.
- The hero says "If you add 5% of this fund", while the suggested position for a qualifying ETF is 7.5% (half the 15% maximum) or 15%. Say if the hero should use the suggested size.
