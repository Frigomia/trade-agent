# Portfolio onboarding and frontend direction

Owner direction selected on 2026-10-20 after reviewing three Phase 8 HTML directions.

## Phase 8: holding entry

Use a modal on desktop and a full-screen form on mobile. Ticker and shares are the initial
fields; fractional shares are supported. Company name, type, and sector fill from market data.
Average cost, purchase date, company overrides, and target weight live in optional details.
Unknown purchase details remain null, never today's date or zero. Adding a holding should take
less than 30 seconds. The empty portfolio opens the same form as the Add holding button.

If the ticker is already held, explicitly offer **Update position**, explain that shares are
the new total, and preserve blank purchase details. Editing a holding supports clearing its
purchase details. The form never places a trade. Existing ISIN and removal flows remain.

The API accepts `{ticker, shares}` when the provider resolves the security type. If type is
unavailable, ask for Stock or ETF rather than inventing one. Omitted update fields preserve
stored values; explicit null clears cost basis/date. Metadata is bounded and read from the
cached provider, with no new company-metadata columns. Provider country means issuer domicile,
not a verified listing country. No currency conversion is added to the existing summary here.

Portfolio value includes priced holdings with unknown basis. P/L includes only priced holdings
with known basis and exposes coverage counts/completeness. Snapshot cost totals include known
basis only and persist whether coverage is complete; charts suppress incomplete cost comparisons.
An additional purchase preserves an unknown basis for an existing nonempty position;
a recorded purchase into a zero-share position establishes basis and fills an unknown purchase
date from that trade, preserving any previously known first purchase date.

## Portfolio frontend phase

The owner specified four sections for the later portfolio frontend:

1. **Overview:** total value in EUR; gains/losses in EUR and percent when purchase prices are
   available; today's value change; a simple value-history chart when sufficient data exists.
2. **Holdings:** company/ticker, shares, current position value, known-basis gains/losses, and
   portfolio allocation. Selecting a holding opens its details, with edit and remove actions.
3. **Allocation:** interactive donut charts and percentages with Sector, Country, and Currency
   tabs, plus largest positions.
4. **Risk and analytics:** volatility, position concentration, diversification, and correlations.
   Essential metrics first; advanced metrics expand on demand. No arbitrary portfolio health score.

The existing summary still adds unconverted amounts and cannot honestly label those totals EUR.
That frontend work must use the existing FX/analytics services and explicitly handle partial
coverage, unknown cost-basis currency, and missing history before showing converted P/L or a daily
change. These portfolio sections are recorded design scope, not a claim that Phase 8 implements them.
