import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { PortfolioAlerts } from "./PortfolioAlerts";

function rec(over: Partial<RecommendationOut>): RecommendationOut {
  return { id: 1, ticker: "AAPL", action: "TRIM", status: "PENDING", ...over } as RecommendationOut;
}

describe("PortfolioAlerts", () => {
  it("shows a row per pending call that opens its analysis, with the action in words", () => {
    render(<PortfolioAlerts recommendations={[rec({}), rec({ id: 2, ticker: "VRTX", action: "ADD" })]} />);

    expect(screen.getByRole("heading", { name: "Portfolio alerts" })).toBeInTheDocument();
    expect(screen.getByText("2 pending")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /AAPL/ })).toHaveAttribute("href", "/today/1");
    expect(screen.getByText("New AI recommendation: TRIM")).toBeInTheDocument();
    expect(screen.getByText("New AI recommendation: ADD")).toBeInTheDocument();
    expect(screen.getAllByText("New insight")).toHaveLength(2);
  });

  it("marks an automatic call", () => {
    render(<PortfolioAlerts recommendations={[rec({ source: "scheduled" })]} />);

    expect(screen.getByText(/automatic/i)).toBeInTheDocument();
  });
});
