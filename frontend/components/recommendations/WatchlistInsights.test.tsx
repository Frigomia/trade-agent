import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WatchlistInsight } from "@/lib/api/insight-types";
import { WatchlistInsights } from "./WatchlistInsights";

const insight = (over: Partial<WatchlistInsight> = {}): WatchlistInsight => ({
  ticker: "NVDA",
  kind: "in_target_range",
  text: "Entered your target price range",
  current_price: 98.4,
  target_price_low: 90,
  target_price_high: 110,
  ...over,
});

describe("WatchlistInsights", () => {
  it("shows a row per item with the sentence, the price against its range and a neutral In range pill", () => {
    render(<WatchlistInsights insights={[insight(), insight({ ticker: "ASML", current_price: 700, target_price_low: 650.5, target_price_high: 720 })]} />);

    expect(screen.getByRole("heading", { name: "Watchlist insights" })).toBeInTheDocument();
    expect(screen.getByText("2 to look at")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("NVDA");
    expect(rows[0]).toHaveTextContent("Entered your target price range");
    expect(rows[0]).toHaveTextContent("98.4 · range 90 to 110");
    expect(rows[1]).toHaveTextContent("700 · range 650.5 to 720");
    const pill = screen.getAllByText("In range")[0]; // no green or red: being in a range is not a price move
    expect(pill).not.toHaveStyle({ color: "var(--up)" });
    expect(pill).not.toHaveStyle({ color: "var(--down)" });
    expect(screen.getAllByRole("link")[0]).toHaveAttribute("href", "/portfolio");
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
