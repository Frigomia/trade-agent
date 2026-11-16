# ETF ideas in the new-ideas scan: design

Date: 2026-11-16. Status: draft for the owner's approval.

## Intent

The Today scan is meant to surface the best new ideas. It only ever surfaces stocks: every ETF is
removed in `discovery/eligibility.py` with the reason "an ETF needs separate criteria; company
fundamentals do not describe it". The original market-discovery spec
(`2026-10-14-market-discovery-design.md`, "Out of scope") deferred ETF scoring to a separate design.
This is that design.

An ETF is not a company, so it cannot be judged by quality and valuation against sector peers. The
owner decided what a good ETF idea is: **it fills a gap in the person's portfolio (the idea), and it
is a good fund of its kind (a filter)**. The scan should also know about many more ETFs than the 30
it has today, including UCITS funds such as the iShares NASDAQ 100 UCITS ETF (Acc, IE00B53SZB19),
iShares Core MSCI World UCITS ETF (Acc, IE00B4L5Y983, already in the universe as `IWDA.AS`) and
iShares Core MSCI EM IMI UCITS ETF (Acc, IE00BKM4GZ66).

## Goals

- One scan produces stock ideas and ETF ideas. ETFs have their own lane, with their own eligibility,
  scoring, gate and slots, inside the same scan, the same job, the same Today list and the same
  Scan results page.
- An ETF idea is saved exactly like a stock idea: a BUY recommendation, `source="discovery"`,
  status PENDING, with an `idea` payload, a suggested position size and the usual supersede rules.
- The ETF universe grows to roughly 100 to 150 funds covering the broad exposures a long-term
  investor chooses between: global, US large cap and Nasdaq 100, Europe, emerging markets, Japan and
  Asia, small caps, a handful of sector and theme funds, government and corporate bonds, and gold.
- Nothing about the stock lane changes: same universe rows, same peer scoring, same 60 gate, same
  8 slots.

## Non-goals

- Look-through to a fund's holdings, regions or sectors. The portfolio treats an ETF as one bucket
  named after its Yahoo category today (`analysis/portfolio.py`, "no constituent look-through").
  That stays.
- Ranking or filtering ETFs by price momentum or a technical signal. The market-discovery spec says
  momentum never determines discovery eligibility or rank, and that holds for ETFs.
- Changing the holdings and watchlist analysis, including its ETF rule (RSI plus trend).
- Tax, accumulating versus distributing optimisation, broker availability, order execution.
- Leveraged, inverse or other "trading" funds.
- A user-configurable ETF profile.

## Anti-goals

- Recommending a fund the person probably cannot buy (see "UCITS only").
- Recommending a near-copy of something already held, for example VWCE when the person holds IWDA.
- Recommending an ETF because it is cheap while it adds nothing to the portfolio.
- Letting ETF ideas crowd out stock ideas, or the reverse. The lanes have separate slots.

## Constraints

- Advisory only. The scan never places a trade and never calls a broker.
- Numeric decisions stay in code. The model writes prose and never sets a score, a filter result or
  a confidence, as for stocks.
- The scan's cost stays bounded. Today at most 8 candidate graphs run per scan, 3 at a time, each
  with a fixed web-search budget (`CANDIDATE_QUERY_BUDGET`). The ETF lane adds a small fixed number of
  graph runs and its searches count in the same budget accounting (`scheduled.py` multiplies
  `SHORTLIST_SIZE` by the per-candidate budget).
- The portfolio fit calculation needs at least two valued holdings with about 60 matching return
  intervals (`marginal_effect`).
- The market-discovery spec says portfolio fit is context, breaks ties and never changes the overall
  score. For ETFs the gap score is the score. This is a deliberate exception, limited to the ETF
  lane. The spec text is updated to say so.
- Every number below marked "proposed" follows the repository convention: it is a starting value,
  not calibrated, and lives in one named constant.
- Data comes from Yahoo through `yfinance`, as for stocks. No new provider.

## Approaches considered

1. **ETF lane inside the same scan (chosen by the owner).** ETFs have their own eligibility, gap
   score, quality filter and shortlist slots. They share the scan, the job, the persistence and the
   UI. It adds no new scan and leaves the stock side untouched. It needs ETF-specific data and
   research wording.
2. **One merged ranking.** ETFs get a 0 to 100 score and compete for the same 8 slots. Rejected: a
   gap score and a peer-quality score are not comparable, so one lane would crowd out the other in
   ways nobody could predict.
3. **A separate ETF scan with its own button.** Rejected: it doubles cost and UI, and Today would no
   longer show one list of the best ideas.

## Design

### Which ETFs can be recommended

- **UCITS only (proposed, owner to confirm).** The owner's examples are all Irish-domiciled UCITS
  funds, so the owner is read as an EU retail investor, who generally cannot buy US-domiciled ETFs
  (VT, EEM, GLD and most of today's 30). An ETF is recommendable when its row is marked
  `ucits=yes` in the CSV, a flag set by hand when the row is added and checked by the validator
  against the ISIN prefix (an Irish, Luxembourg, German, French or Dutch ISIN). An ISIN that merely
  is not American is not enough: Jersey or Swiss gold products and Canadian or Cayman funds are not
  UCITS. The existing US-listed rows may stay in the file; they are excluded from the
  ETF lane with a visible reason ("not available to EU retail investors") instead of being deleted.
- One listing per fund. The universe holds one ticker per ISIN, preferring a EUR venue (Xetra or
  Euronext Amsterdam) and otherwise London. Currency conversion already exists for the stock side
  (`fx.SUPPORTED`).
- Accumulating funds are the default; distributing twins of the same index are not added as separate
  rows.

### Universe

`universe.csv` gains an `isin` column. `validate_universe.py` is extended to check an ETF row (the
live quote type is ETF, the name matches, the ISIN is well formed, the currency matches) and
`universe.py` keeps rejecting unknown asset types. The regional composition targets in the spec
(30 global ETFs of 600) are replaced by an ETF target of roughly 100 to 150 and the document is
updated. The three funds named by the owner are in the first batch. If Yahoo does not carry the
fields the quality filter needs for UCITS funds (see "Data"), the CSV also carries a `ter` column
maintained by hand.

### Data

Yahoo `info` for a fund is expected to provide a category, an expense ratio, total assets and an
inception date, but its coverage of European-listed funds is not verified: the Yahoo connection could
not be tested from the design machine. First build step, a spike: run the validator against the
real candidate list from a network without TLS interception, count which fields are present, and
decide Yahoo versus the CSV for each. The snapshot (`discovery/snapshot.py`) is extended for ETF rows
with the fields that survive the spike; stock rows are unchanged.

### Eligibility (ETF lane)

An ETF is out, with a recorded `Exclusion` and a reason, when any of these holds: not UCITS, fewer
than 60 matching return intervals with the person's holdings (checked per fund, so a young fund is a
clean exclusion rather than an unscored candidate), price
or history missing or stale, fewer than about 250 daily closes (proposed: one year, and the fit step
needs 60), currency unsupported, name or category marks it leveraged or inverse, or the data the
quality filter needs is absent. Held tickers and avoided sectors are skipped as for stocks.

### Quality filter

A pass or fail test, not a score. An ETF passes when its expense ratio is at most 0.50% (proposed),
its fund size is at least EUR 100 million (proposed; Yahoo reports size in the fund's own currency,
so it is converted to EUR with the existing `fx` helpers first) and its history is at least one year. Among
candidates that are near-copies (same Yahoo category and return correlation of 0.95 or more,
proposed), only the cheapest is kept, ties broken by the largest. This is what stops VT, VWCE, VWRL
and IWDA from all appearing.

### Gap score (the idea)

The fund's 0 to 100 gap score reuses the existing fit calculation (`analysis/discovery_score.py`
`fit` dimension, `marginal_effect`): low correlation to the person's holdings, lower portfolio
volatility and lower concentration after a hypothetical 5% weight. A held ETF in the same Yahoo
category with return correlation of 0.95 or more makes the candidate an overlap: it is excluded as
"overlaps a holding", not scored low. The ETF's overall is its gap score. An ETF is an opportunity
when the gap score is at least 60 (proposed, mirroring the stock gate) and confidence is `medium`
or `high`.

Consequence to accept: for an equity-heavy portfolio the strongest gaps will often be bond and gold
funds, because they are the least correlated. That is a real diversification idea, not a bug. The
person can remove those funds from the universe file if they do not want them recommended. With fewer
than two valued holdings, or too little history, the ETF lane is skipped and the scan says so
("ETF ideas need at least two holdings with price history"); that note is not an "ETF found
nothing" result.

### Confidence

Deterministic, from data coverage, as for stocks: `low` when the fit is not applicable, the expense
ratio, size or category is missing, the price is missing or stale, or no non-forum research exists;
`medium` when research has gaps, conflicts or an unresolved negative development; otherwise `high`.
Only `medium` and `high` can qualify.

### Research and thesis

The same bounded graph runs for each shortlisted ETF with ETF-specific wording and queries: issuer,
index tracked, replication method, domicile, notable events (index change, fund merger or closure,
fee change). The model writes the thesis (the role the fund plays in this portfolio), the bear case
and the conclusion from supplied evidence, under the same untrusted-data rules. A confirmed
invalidating event such as a fund closure still excludes the candidate. Qualitative output never
changes a number.

### Slots, saving and size

The ETF lane shortlists up to 3 funds per scan (proposed). Total graph runs rise from at most 8 to at
most 11, and the search budget accounting includes them. Qualifying ETFs are saved as BUY
recommendations by the same persistence code; superseding of earlier pending discovery rows applies
to ETFs by ticker as it does to stocks. Suggested position size follows the stock rule (half the
maximum position, the full maximum when the overall is 80 or more); the builder may propose a lower
cap for ETFs.

### Scan results and the UI

`ScanRun` already stores counts and a `coverage_summary`. ETF counts (eligible, shortlisted,
researched, opportunities) go in `coverage_summary` unless the builder finds a reason for columns.
The Scan results page lists ETF exclusions, set-aside ETFs and nearest misses beside the stock ones.
Today and the idea detail screen need an ETF layout: no fundamentals-versus-peers table; instead
expense ratio, fund size, category, the gap evidence (correlation, volatility and concentration
change) and the quality-filter result. This is a design slice: it follows the repository's design
process (mock, owner approval, then build) and the Soft look in `DESIGN.md`. The backend ships
first and works with the current screens degrading to a minimal ETF card.

### Documents to update with the change

`docs/ARCHITECTURE.md` (discovery sections and API), `DESIGN.md` (ETF idea layout), the market-discovery
spec's out-of-scope note and fit rule, and `docs/design/README.md` for the mock.

### Calls made while writing (the writer's, open to correction)

- **Order of the ETF lane:** eligibility, then the hard overlap exclusion against held ETFs, then the
  quality filter, then the near-copy dedupe among candidates, then the gap score, then the gate. The
  overlap and dedupe tests need both the same Yahoo category and a return correlation of 0.95 or
  more, since Yahoo categories alone are coarse.
- **Gap score:** exactly the score of the existing `fit` dimension, so `overall` equals it and the
  ordering, ranking and gate code are shared, with an ETF-specific gate constant beside
  `NO_OPPORTUNITY_MIN_OVERALL`. The builder may refactor, not fork, that code.
- **Missing fund size:** if Yahoo lacks it for UCITS funds, size comes from a hand-kept CSV column
  like `ter`; if even that is impractical the size test is dropped and the other filters stay. The
  lane is not dropped for it.
- **Variety:** at most one ETF per Yahoo category per scan, so three slots cannot be three bond
  funds of one kind. There is no further asset-class cap.
- **Failures are visible:** a fund that fails eligibility or the quality filter is an `Exclusion` with
  its reason on Scan results. Nearest misses and set-aside ETFs are the funds that passed both and
  scored under the gate.
- **Skipped lane:** the scan is still `completed`. The reason is a note in `coverage_summary` and the
  Today empty state names it. No new status.
- **Backend-first card:** the API contract is not broken. `IdeaOut` is reused and the ETF facts
  (expense ratio, fund size, category) travel in the idea snapshot's `fundamentals` map; any new
  typed fields are added optionally. `ARCHITECTURE.md` is updated in the same change.

## Risks

- Yahoo may not have expense ratio or fund size for UCITS funds. Mitigation: the spike, then the CSV
  `ter` fallback.
- Gap scoring depends on at least two holdings and 60 shared return days. Mitigation: a visible note,
  and the thresholds stay proposed constants.
- The ETF idea set is small and heavily overlapping, so dedupe quality matters more than ranking.
- Cost and latency grow with the extra graph runs.
- 0.95 correlation and the other thresholds are untested guesses; wrong values give too many or too
  few ideas, never an unsafe action.

## Left to the builder

Exact constant values after the spike, field names and the snapshot shape for ETFs, whether the idea
payload reuses `IdeaOut` as is or adds ETF fields (including how a pass or fail quality filter is
shown next to `DimensionScore`), whether ETF counts need columns, the precise ETF research queries,
how many funds the first universe batch holds, and the order of work.
