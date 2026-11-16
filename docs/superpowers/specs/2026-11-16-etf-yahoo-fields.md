# ETF Yahoo field spike: findings

Status: **not yet run.** The design machine cannot reach Yahoo (TLS interception), so nothing below
is measured. This file is the template the owner fills in after one run on a clean network. Part of
[ETF ideas](2026-11-16-etf-discovery-design.md), section "Data" (ticket #296).

## What to run

From `backend/`, on a network without TLS interception:

```bash
uv run python -m app.discovery.validate_universe --etf-only --report ../docs/superpowers/specs/2026-11-16-etf-yahoo-fields-report.md
```

It fetches only the ETF rows (the three funds the owner named, the other UCITS funds in
`universe.csv`, and the older US-listed rows). Rows marked `unverified listing` in the `notes`
column have never been checked against Yahoo: the report lists which of them fail (unresolved
ticker, name or currency differing, stale price). Fix or drop those rows, then remove the note from
the ones that pass.

The report has two ETF sections: "ETF fields returned by Yahoo" (a count per field) and "ETF expense
ratio evidence" (Yahoo's raw `netExpenseRatio` and `totalAssets` per fund, next to the CSV `ter`).
If Yahoo throttles the run, re-run it; throttled symbols are listed as "not checked".

## Findings (fill in)

Funds checked: __ of __ passed. Date of the run: ____.

| Field | Funds that had it | Units seen | Decision (Yahoo, CSV, or drop) |
|---|---:|---|---|
| `category` | | text | |
| `netExpenseRatio` | | percent (0.2 is 0.20%) or fraction (0.002)? | |
| `totalAssets` | | currency and scale | |
| `fundInceptionDate` | | epoch seconds, date or text | |

Decision rules from the design: a field Yahoo has for most funds stays on Yahoo and the CSV only
overrides it; a field Yahoo lacks for many UCITS funds is filled in the CSV (`ter`, `size_eur_m`);
if neither source can give a fund's size, the size test is dropped for the lane.

## Assumptions the spike must confirm (both are unverified guesses in the code)

1. **`YAHOO_EXPENSE_RATIO_DIVISOR`** in `backend/app/discovery/snapshot.py` is 100, which assumes
   Yahoo sends `netExpenseRatio` as a percent number. Compare the raw column with the known TER of
   iShares Core S&P 500 (0.07%): a raw 0.07 means percent (divisor 100), a raw 0.0007 means a
   fraction (divisor 1). Change the constant to the finding.
2. **`totalAssets` is in the fund's quote currency, and not in pence.** `etf.py` converts it to EUR
   with the quote currency's rate. London listings can quote GBX (pence) while the fund reports its
   size in another currency. Check one London listing (for example `CBU0.L`) and one Xetra listing
   against the issuer's stated fund size; if a listing breaks the assumption, prefer the EUR venue
   or fill `size_eur_m` in the CSV for it.

## Result of the run

(Write the decision per field here, and the list of rows dropped or corrected.)
