# ETFs on the Portfolio page: classify them by category (short design)

Date: 2026-11-16. Status: draft for the owner's approval. Size: a small change (backend labels, one form field, one frontend count rule).

## Intent

On the Portfolio page an ETF holding shows up as "Unclassified" in the allocation donut (by sector and by country) and in the Risk panel's "Sector not known" row. `analyze_portfolio` (`backend/app/analysis/portfolio.py`) builds each holding's labels from Yahoo's profile (`fetch_profile`: sector, industry, country, category). UCITS funds have none of them, so an ETF becomes `ETF: Unclassified` for sector and industry and `Unclassified` for country. The portfolio also overwrites an ETF's own `holding.sector` with that label. The owner wants ETFs to read as something, not as unknown.

Correction found in the final review: the allocation donut does not read `analyze_portfolio`; it groups the holdings summary (`GET /portfolio/summary`: the stored `sector` and Yahoo's `country`). The summary therefore also carries the `ETF: <category>` label (`group_sector`) and the `Funds` country, built by the same helper, so the donut and the Risk panel agree.

## What the owner decided

Of three options (the fund's category as its own slice; look-through to what the fund holds; one plain "ETF" bucket) the owner chose "go with your recommendation": **the fund's category as its own slice** (option 1). Look-through is a possible later project.

## Goals

- An ETF holding shows its category (for example `ETF: Global Large-Cap Blend Equity`) as its sector and industry slice instead of `Unclassified`.
- The category comes from, first non-empty wins: the holding's own `sector` field (a value the person set), Yahoo's category, the universe file's `industry` for that ticker, otherwise unresolved.
- A person can set the category of an ETF holding in the holding form when no source has one.
- Funds stop being counted as an unknown country: an ETF has no country exposure without look-through, so its country slice is labelled `Funds` and is not counted as a country.

## Non-goals

- Look-through to a fund's regions or sectors, or any new data source.
- Guessing a category from the fund's name.
- Changing how stocks are classified, or the stock sector vocabulary.
- Backend or database schema changes: `Holding.sector` already exists (String 100) and `HoldingIn.sector` already accepts it.

## Anti-goals

- A wrong label shown as fact (so no name guessing).
- Counting a fund category as a stock sector in the "Sector not known" figure, or hiding that a fund is unresolved.

## Constraints

- Advisory only; nothing here touches orders.
- DESIGN.md: no new visual language; the form field follows the existing form styling; rem sizes.
- Unresolved ETFs stay visible as `Unclassified` and get a note naming the fund and how to fix it.
- No migration.

## Approaches

1. **Category as its own slice (chosen).** Resolve a category per ETF from the sources above and show it. Small, honest, and covers every fund once a category exists.
2. **Look-through.** Count a fund by what it holds. Gives true exposure but needs a data source Yahoo does not provide for UCITS funds, and ongoing upkeep. Rejected for now.
3. **One "ETF" bucket.** Cheapest, tells the person the least. Rejected.

## Design

**Backend.**
- A helper in `backend/app/discovery/universe.py`, `etf_category_for(ticker: str) -> str | None`, returns the universe row's `industry` for an ETF ticker (read once, cached with `functools.lru_cache`, case-insensitive on the ticker).
- In `analyze_portfolio`, for `holding.asset_type == "ETF"`: `category = holding.sector (stripped) or profile["category"] or etf_category_for(ticker)`. If there is one, `sector[ticker] = industry[ticker] = f"ETF: {_label(category)}"` (the existing `ETF: ` prefix stays so a fund is told apart from a stock in the donut) and the existing note stays. If there is none, sector and industry are `Unclassified` (not the odd `ETF: Unclassified`) and the note becomes "{ticker}: ETF category not set; add one in the holding." Country for an ETF is `Funds`.
- The "unknown exposures are Unclassified" note is not repeated for an ETF whose category was resolved.

**Frontend.**
- `frontend/lib/portfolio/risk.ts` `spread`: a country labelled `Funds` is not counted as a country and is never the largest, the same way `Unclassified` is treated (a `FUNDS` constant beside `UNCLASSIFIED`); `by_sector` is unchanged (a fund category is a real slice and counts as a sector, which is what the donut shows).
- `HoldingForm.tsx`: when the asset type is ETF, an optional "Category" text field (max 100 characters) prefilled from the holding's `sector`, saved as `sector`. Hidden for stocks.

**Docs.** `docs/ARCHITECTURE.md` portfolio analytics section: the ETF classification rule and the `Funds` country label.

## Calls I made (open to correction)

- The label keeps the `ETF: ` prefix so funds and stocks are distinguishable in the donut.
- Country for funds is `Funds`, not the domicile (a domicile is not exposure).
- A person's own category beats Yahoo's, so they can correct a wrong one.
- The form field is free text, with no list to pick from (a list can come later).
- The universe lookup is by ticker only; holdings matched by ISIN are not added now.

## Left to the builder

Exact wording of the form label and the note, the field's placement, the test fixtures, where the `FUNDS` constant lives, and how to prefill the form for existing holdings.
