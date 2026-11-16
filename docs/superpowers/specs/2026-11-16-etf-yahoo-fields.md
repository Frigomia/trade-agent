# ETF Yahoo field spike: findings

Status: **run on 2026-11-16** (Avast web protection off). Part of
[ETF ideas](2026-11-16-etf-discovery-design.md), section "Data" (ticket #296). The raw output is
committed as [the report](2026-11-16-etf-yahoo-fields-report.md).

## How to re-run

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

## Findings

Funds checked: 51 of 51 passed (24 UCITS and 27 US-listed). Date of the run: 2026-11-16.

| Field | Funds that had it | Units seen | Decision (Yahoo, CSV, or drop) |
|---|---:|---|---|
| `category` | 26 of 51 overall, **0 of 24 UCITS** (only the US-listed funds have one) | text | **CSV.** Yahoo's category when present, else the universe row's `industry`; every `ucits=yes` row must have one. |
| `netExpenseRatio` | 49 of 51 (missing: `VWCE.DE`, `VWRL.L`) | **percent** (0.18 is 0.18%) | **Yahoo**, divisor 100 confirmed. CSV `ter` 0.0014 for the two Vanguard funds. |
| `totalAssets` | 41 of 51 (missing for 10 of the 24 UCITS funds) | whole units, fund-wide total | **Yahoo when present**; an unknown size gives `medium` confidence at most (by design). |
| `fundInceptionDate` | 51 of 51 | epoch seconds | **Yahoo.** |

### What the run showed

1. **No UCITS fund has a Yahoo category.** The ETF lane's confidence is `low` without a category and
   `low` never qualifies, so with Yahoo's data alone no UCITS ETF could be recommended. The category
   also drives the near-copy removal, the overlap test and the one-per-category rule. Fix: the
   universe file's `industry` column holds a Morningstar-style label per exposure (the same label
   for funds with the same exposure, for example the four world-equity funds), used when Yahoo has
   none; the loader rejects a `ucits=yes` row with a blank `industry`.
2. **`netExpenseRatio` is a percent.** IS3N.DE 0.18, SXR8.DE 0.07 and CBU0.L 0.07 match the issuers'
   TERs, so `YAHOO_EXPENSE_RATIO_DIVISOR = 100` is correct and unchanged. `VWCE.DE` and `VWRL.L`
   (Vanguard) have none, so they were excluded as insufficient data until the CSV `ter` was set:
   **0.0014 (0.14%)** for both, which Vanguard cut from 0.19% on 28 July 2026 (justETF, and
   Vanguard's own announcement as reported by Trustnet). Check it against the factsheet if the cut
   is ever reversed. No other `ter` was filled: Yahoo supplies them.
3. **`totalAssets` is the fund-wide total, probably in the fund's base currency.** `VWCE.DE`
   (EUR line) and `VWRL.L` (GBP line) show the same 88,843,730,944, so it is neither the listing's
   quote currency nor a per-line figure. `etf.py` still converts it with the quote currency's rate;
   that is only right when the base currency and the quote currency agree, and is wrong by the
   exchange rate otherwise (a EUR line of a USD fund). Left as is: the size test is a EUR 100
   million floor, so a few percent of rate error rarely changes the result, and `size_eur_m` in
   the CSV overrides it for any fund where it matters. It is missing for 10 of the 24 UCITS funds
   (AMEA.DE, DBZB.DE, EUNA.DE, EUNN.DE, IUSQ.DE, IWDA.AS, SXR8.DE, SXRV.DE, XGLE.DE, ZPRR.DE), which
   then get at most `medium` confidence.
4. **Yahoo has no ISIN** (`Ticker.isin` returns "-"), so ISINs cannot be checked through Yahoo. All
   24 UCITS ISINs were checked on justETF instead: each ISIN's page names the same fund and share
   class as the CSV row and lists the row's ticker on the row's exchange. The Xtrackers II Global
   Government Bond fund `DBZB.DE` (LU0378818131) and iShares Core Global Aggregate Bond `EUNA.DE`
   (IE00BDBRDM35) are both the EUR Hedged accumulating classes, as Yahoo names them.
5. **Yahoo's cost is sometimes behind the issuer's.** `EUNK.DE` shows 0.2 on Yahoo but 0.12% on
   iShares and justETF; `EUNN.DE` shows 0.15 but 0.12%. Both are below the 0.50% limit either way,
   so nothing changes; fill their `ter` if the exact figure ever matters.

### Rows whose names differ from the live data

The validator flags these four rows as differing in name from Yahoo (it does not record Yahoo's
string). The ISINs were checked on justETF and match the traded share class; the differences are
share-class wording. The rows are kept as they are.

| Ticker | CSV name | justETF name for the same ISIN |
|---|---|---|
| AMEA.DE | Amundi MSCI Emerging Markets Asia UCITS ETF EUR (C) | same |
| CBU0.L | iShares $ Treasury Bond 7-10yr UCITS ETF (Acc) | iShares USD Treasury Bond 7-10yr UCITS ETF (Acc) |
| IUSQ.DE | iShares MSCI ACWI UCITS ETF USD (Acc) | iShares MSCI All Country World UCITS ETF USD (Acc) |
| ZPRR.DE | State Street SPDR Russell 2000 U.S. Small Cap UCITS ETF | State Street SPDR Russell 2000 U.S. Small Cap UCITS ETF USD |

Decision rules from the design held: a field Yahoo has for most funds stays on Yahoo and the CSV
only overrides it; a field Yahoo lacks for many UCITS funds is filled in the CSV (`industry`,
`ter` for two funds); an unknown size only caps confidence at `medium`, so the size test is kept.

## Assumptions the spike had to confirm

1. **`YAHOO_EXPENSE_RATIO_DIVISOR` = 100: confirmed** (percent, see above).
2. **`totalAssets` in the fund's quote currency: not confirmed.** It is fund-wide, probably in the
   fund's base currency; see finding 3. The code is unchanged.

## Result of the run

Unverified-listing notes were removed from all 24 UCITS rows (they passed and their ISINs were
confirmed). Rows dropped or corrected: none. Changes made because of the run: the `industry`
column for the 24 UCITS rows and its loader rule, the category fallback in `to_snapshot`, and
`ter` 0.0014 for `VWCE.DE` and `VWRL.L`.
