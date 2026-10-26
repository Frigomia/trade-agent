import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WatchlistInsight } from "@/lib/api/insight-types";
import { WatchlistInsights } from "./WatchlistInsights";

const insight = (over: Partial<WatchlistInsight> = {}): WatchlistInsight => ({
  ticker: "NVDA",
  kind: "in_target_range",
  text: "Entered your target price range",
  currency: "USD",
  current_price: 98.4,
  target_price_low: 90,
  target_price_high: 110,
  ...over,
});

describe("WatchlistInsights", () => {
  it("shows a row per item with the sentence, the price against its range and a neutral In range pill", () => {
    render(<WatchlistInsights insights={[insight(), insight({ ticker: "ASML", currency: "EUR", current_price: 700, target_price_low: 650.5, target_price_high: 720 })]} />);

    expect(screen.getByRole("heading", { name: "Watchlist insights" })).toBeInTheDocument();
    expect(screen.getByText("2 to look at")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("NVDA");
    expect(rows[0]).toHaveTextContent("Entered your target price range");
    expect(rows[0]).toHaveTextContent("USD 98.40 · Range USD 90.00 to 110.00");
    expect(rows[1]).toHaveTextContent("EUR 700.00 · Range EUR 650.50 to 720.00");
    const pill = screen.getAllByText("In range")[0]; // no green or red: being in a range is not a price move
    expect(pill).not.toHaveStyle({ color: "var(--up)" });
    expect(pill).not.toHaveStyle({ color: "var(--down)" });
    expect(screen.getAllByRole("link")[0]).toHaveAttribute("href", "/portfolio");
  });

  it("shows a pence-quoted company in pounds, with the currency, as Discover does", () => {
    render(<WatchlistInsights insights={[insight({ ticker: "SHEL.L", currency: "GBP", current_price: 7, target_price_low: 6.5, target_price_high: 7.205 })]} />);

    expect(screen.getByRole("listitem")).toHaveTextContent("GBP 7.00 · Range GBP 6.50 to 7.205");
  });

  it("shows the price with the range's decimals, so a price on the edge of its range does not look outside it", () => {
    render(<WatchlistInsights insights={[insight({ currency: "GBP", current_price: 7.2049999, target_price_low: 6.5, target_price_high: 7.205 })]} />);

    expect(screen.getByRole("listitem")).toHaveTextContent("GBP 7.205 · Range GBP 6.50 to 7.205");
  });

  it("says what could not be checked, so a missing insight is not read as outside the range", () => {
    render(<WatchlistInsights insights={[insight()]} missing={["prices"]} />);

    expect(screen.getByText(/could not check some prices, so watchlist insights may be missing/i)).toBeInTheDocument();
  });

  it("says nothing extra when every price was checked", () => {
    render(<WatchlistInsights insights={[insight()]} />);

    expect(screen.queryByText(/could not check/i)).not.toBeInTheDocument();
  });
});
