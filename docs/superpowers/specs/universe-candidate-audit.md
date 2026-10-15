# Universe candidate-pool audit

Companion to [`universe-coverage.md`](universe-coverage.md) (the selected 600) and
[`universe-candidate-pool.csv`](universe-candidate-pool.csv) (one row per candidate).

The coverage report only describes the 600 selected symbols. This document covers the whole pool
they were drawn from, what was excluded and why, what that does and does not say about Yahoo
Finance coverage for globally discovered stocks, and the limitations that Phase 4 must not
inherit silently.

## 1. What evidence exists

| Evidence | Retained? | Where |
|---|---|---|
| Final live data per candidate (name, quote type, currency, sector, market cap, core fundamentals, history length) | **Yes**, for all 1,116 candidates | Rebuilt into `universe-candidate-pool.csv` |
| The candidate lists (ticker and intended company) | Yes | Same CSV, `intended_name` column |
| The trimming rule and the drop decisions | Yes | The CSV `outcome` and `reason` columns |
| The raw console output of each first-pass fetch run | **No.** It was printed to the terminal, not saved. | Only the summary counts in section 3 survive, taken from the run output |
| Which symbols were throttled by Yahoo on the first pass, and how many retries each needed | **No** | Only the aggregate (about 90 of 270 in one batch) is known |

So the per-candidate table is reconstructed from the data retained after the retries, not from a
log of the original runs. A candidate that was throttled and then resolved looks identical to one
that resolved at once.

## 2. Pool summary

1,116 unique candidates were checked live. All of them were tickers recalled by hand, then
validated.

| Outcome | Count | Share |
|---|---:|---:|
| Selected into the universe | 600 | 53.8% |
| Valid but trimmed to reach the regional target (composition) | 495 | 44.4% |
| Excluded: Yahoo returned no data | 17 | 1.5% |
| Excluded: history under 120 days (one day, in every case) | 4 | 0.4% |

| Region | Candidates | Selected | Trimmed | Excluded |
|---|---:|---:|---:|---:|
| North America | 387 | 180 | 199 | 8 |
| Europe | 341 | 180 | 153 | 8 |
| Asia-Pacific | 263 | 150 | 111 | 2 |
| Other emerging | 95 | 60 | 32 | 3 |
| Global ETFs | 30 | 30 | 0 | 0 |

Regions are by listing country. The selected set is a draw from the pool, not a ranking: trimming
removes names from the most crowded sector and size cells by a stable hash, with no quality
judgement.

## 3. Exclusions and why

21 candidates were excluded (1.9% of the pool). The cause of "no data" could not be verified from
Yahoo alone; the table gives what the evidence supports.

| Ticker | Intended company | Evidence | Most likely cause |
|---|---|---|---|
| EA | Electronic Arts | 1 day of history | Taken private or delisted |
| RICHT.BD | Richter Gedeon | 1 day of history | Delisted or symbol changed |
| DAL.MI | Datalogic | 1 day of history | Delisted or symbol changed |
| JTC.L | JTC | 1 day of history | Acquired |
| CTRA | Coterra | No data | Merged or renamed |
| OPAP.AT | OPAP | No data | Renamed after a merger |
| ROG.SW | Roche | No data | **Wrong symbol.** Roche resolves as `RO.SW`, which is in the universe. |
| FAB.AE | First Abu Dhabi | No data | Wrong or unsupported symbol on Yahoo |
| MYTIL.AT | Metlen | No data | Wrong symbol after a renaming |
| FDJ.PA | FDJ | No data | Renamed or wrong symbol |
| GUD.AX | GUD | No data | Acquired or renamed |
| ARZZ3.SA | Arezzo | No data | Merged or renamed |
| CSWI | CSW Industrials | No data | Ticker change |
| TOI.TO | Topicus | No data | Wrong symbol |
| SXS.L | Spectris | No data | Acquired |
| 091990.KQ | Celltrion Healthcare | No data | Wrong symbol or merged into the parent |
| CCRN | Cross Country Healthcare | No data | Acquired |
| CVGW | Calavo | No data | Acquired or ticker change |
| DHIL | Diamond Hill | No data | Acquired or ticker change |
| SPNS | Sapiens | No data | Acquired |
| SUNC.JO | (a guessed symbol) | No data | A guess that did not exist |

Every "most likely cause" is an inference from the symbol, not a fetched fact. Several of the
21 were symbols I was unsure of when listing them, so part of the failure count reflects my
recall, not Yahoo.

Funnel by fetch batch, from the run output (not retained as files):

| Batch | Candidates | Flagged by the script | Real drops |
|---|---:|---:|---:|
| North America | 251 | 5 | 2 |
| Europe | 232 | 14 | 3 |
| Asia-Pacific, other EM, ETFs | 270 | 90 throttled, then 12 flagged on retry | 1 |
| Small and mid caps, batch 1 | 218 | 10 | 6 |
| Small caps, batch 2 | 144 | 16 | 9 |

"Flagged" includes about 36 symbols whose live company name differed from the name I intended
(accents, renamings such as `NSIS-B.CO` shown as Novozymes). Each was reviewed by hand and was the
intended company. They are marked in the CSV `identity_note` column.

## 4. Fundamentals coverage across the whole pool

For the 1,065 resolved stocks (selected and trimmed). This is a larger sample than the 600, with
the same selection caveat.

| Field | Asia-Pacific (261) | Europe (333) | North America (379) | Other EM (92) |
|---|---:|---:|---:|---:|
| returnOnEquity | 82% | 98% | 98% | 98% |
| profitMargins | 100% | 99% | 100% | 99% |
| operatingMargins | 100% | 99% | 100% | 99% |
| revenueGrowth | 99% | 98% | 100% | 97% |
| debtToEquity | 87% | 91% | 93% | 80% |
| freeCashflow | **69%** | 91% | 96% | 82% |
| trailingPE | 86% | 92% | 91% | 92% |
| priceToBook | 91% | 100% | 100% | 100% |
| enterpriseToEbitda | 90% | 91% | 95% | 82% |
| marketCap | 100% | 100% | 100% | 100% |
| **At least 3 of 10 core fields** | 100% | 100% | 100% | 100% |
| **At least 8 of 10 core fields** | 89% | 91% | 97% | 82% |

Weak spots: free cash flow in Asia-Pacific (69%), and debt/equity, free cash flow and
EV/EBITDA in other emerging markets (80-82%). The weakness is concentrated in valuation and
leverage fields, which are the ones peer scoring needs.

## 5. What this does and does not show

**It shows**
- For companies a person can name, Yahoo resolves 98.1% of tickers, and every resolved stock has
  at least 3 of the 10 core fields.
- Coverage of the essential profitability fields is near complete in every region.
- The gaps are specific and measurable: free cash flow in Asia-Pacific, leverage and enterprise
  value in other emerging markets.

**It does not show**
- **Coverage for companies a person would not think to list.** Every candidate here was a known
  name. Obscure small caps and thinly covered exchanges are exactly where Yahoo is weakest, and
  they are under-represented in this pool. The 98% resolution rate and the "all 600 pass" result
  therefore overstate coverage for globally discovered stocks.
- **Stability over time.** One snapshot, taken on one day, with one retry policy.
- **Correctness of values.** Presence of a field is not accuracy. Normalization is checked in
  section 6; accuracy against filings was not.

**How to get the missing evidence**
1. **Phase 5 already records it.** Dynamic admission returns a rejection reason per mention
   (`ambiguous`, `unresolved`, `no_price`, `currency_unsupported`, `insufficient_data`). Aggregated
   across scans, that is real coverage evidence for discovered stocks. Track it before deciding
   whether a second provider is justified.
2. **Re-validate on a schedule.** A quarterly run of the validation script, with the exclusion
   list diffed against this one.
3. **Optional one-off:** validate a sample drawn without regard to fame (for example smaller
   listings from each exchange) and compare its resolution and coverage rates with this pool.

## 6. Field normalization check

Checked live on 37 symbols, mostly dividend payers, across North America, Europe, Asia-Pacific and other
emerging markets, including pence, South African cent and Israeli agora quoted stocks.

| Field | Scale | Notes |
|---|---|---|
| `dividendYield` | **Percent** (KO 2.35, SHEL.L 2.99) | Divide by 100 for a fraction. Consistent across regions and currencies. |
| `trailingAnnualDividendYield` | Fraction (KO 0.0231) | **Wrong by about 100x for GBp, ZAc and ILA** (SHEL.L 0.0004 against a real 3%): dividends in pounds divided by a price in pence. Also zero or missing for some symbols (ITC.NS, 005930.KS). **Do not use.** |
| `payoutRatio` | Fraction | Can exceed 1. REITs and some utilities report an earnings-based ratio above 1 (O 2.35, ENEL.MI 1.16): not comparable, needs FFO. |
| `returnOnEquity`, `returnOnAssets`, `profitMargins`, `operatingMargins`, `revenueGrowth` | Fraction | Consistent. |
| `debtToEquity` | Percent-like (KO 115.5 means 1.155x) | The existing `fetch_fundamentals` already divides by 100. Missing for banks (JPM, RY.TO, CBA.AX) and some others, as expected. |
| `returnOnAssets` | Fraction | Present for 35 of 37. Verified available. |
| `interestCoverage` | n/a | **Absent for all 37.** Utility interest coverage must be reported unavailable. |
| REIT FFO | n/a | Not in `info`. P/FFO unavailable. |

Rules for Phase 4 that follow from this: take the yield from `dividendYield` and divide by 100;
never use `trailingAnnualDividendYield`; convert market cap with `market_cap_to_eur`, because
Yahoo reports it in the major unit even when the price is in a minor unit; treat missing as
unavailable and do not substitute another field.

## 7. Known limitations and tracked follow-ups

These do not change this PR's scope. They are recorded so Phase 4 does not inherit them
silently.

| # | Limitation | Where it bites | Follow-up |
|---|---|---|---|
| 1 | **Freshness is a calendar-day proxy.** `STALE_DAYS = 5` calendar days ignores that exchanges have different holidays and sessions. It is an interim validation aid, not the production rule. | Phase 4 snapshot and `is_eligible` safeguard | Measure staleness in **trading sessions of each security's own exchange**. One option needing no new dependency: derive each exchange's latest sessions from the bars observed across its symbols in the snapshot, falling back to calendar days when an exchange has too few symbols. Decide before Phase 4 reuses `check_symbol`. |
| 2 | **History under 120 days is a validation failure** for universe maintenance. | Phase 4 eligibility | A recently listed company must still reach qualitative research. Phase 4 routes short history to "risk analysis limited", not to exclusion. |
| 3 | **`MIN_CORE_METRICS = 3` is a coverage floor**, not a scorability rule. Three arbitrary fields do not make a company scorable. | Phase 4 scoring | Score only from the metrics essential to the sector; otherwise mark the dimension unavailable. |
| 4 | Candidate pool is biased to well-known names. | Reliability claims | Section 5, items 1 to 3. |
| 5 | Static file ages (renamings, acquisitions). | Universe | Quarterly re-validation, diffed against section 3. |
| 6 | FX conversion failure leaves market caps unconverted for that currency. | Report completeness | The script now reports the unavailable currencies and still writes the report. |
