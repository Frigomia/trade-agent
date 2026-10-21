import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { PortfolioAlerts as Typed } from "@/lib/api/alert-types";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { alertRows } from "@/lib/alerts";
import { PortfolioAlerts } from "./PortfolioAlerts";

function rec(over: Partial<RecommendationOut>): RecommendationOut {
  return { id: 1, ticker: "AAPL", action: "TRIM", status: "PENDING", ...over } as RecommendationOut;
}

const TYPED: Typed = {
  alerts: [
    { ticker: "VNTR", name: "Vantor Retail", kind: "new_recommendation", text: "New AI recommendation: TRIM", when: null, direction: null, recommendation_id: 7 },
    { ticker: "AURL", name: "Aurelle Foods", kind: "earnings_upcoming", text: "Earnings tomorrow", when: "2026-10-22", direction: null, recommendation_id: null },
    { ticker: "CSTR", name: "Castor Logistics", kind: "move_since_purchase", text: "Up 6.8% on your purchase cost", when: null, direction: "up", recommendation_id: null },
    { ticker: "DWNR", name: "Downer Ltd", kind: "move_since_purchase", text: "Down 8.0% on your purchase cost", when: null, direction: "down", recommendation_id: null },
  ],
  missing: [],
};

describe("PortfolioAlerts", () => {
  it("shows a row per typed alert with its company name, sentence and a pill for its kind in words", () => {
    render(<PortfolioAlerts rows={alertRows(TYPED, [rec({ id: 7, ticker: "VNTR" })])} />);

    expect(screen.getByRole("heading", { name: "Portfolio alerts" })).toBeInTheDocument();
    expect(screen.getByText("4 to look at")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("VNTRVantor Retail");
    expect(rows[0]).toHaveTextContent("New insight");
    expect(rows[1]).toHaveTextContent("Aurelle Foods");
    expect(rows[1]).toHaveTextContent("Earnings tomorrow");
    expect(rows[1]).toHaveTextContent("Up next");
    expect(rows[2]).toHaveTextContent("Positive move");
    expect(rows[3]).toHaveTextContent("Negative move");
  });

  it("opens a call's analysis and sends earnings and moves to the Portfolio page", () => {
    render(<PortfolioAlerts rows={alertRows(TYPED, [])} />);

    expect(screen.getByRole("link", { name: /VNTR/ })).toHaveAttribute("href", "/today/7");
    expect(screen.getByRole("link", { name: /AURL/ })).toHaveAttribute("href", "/portfolio");
    expect(screen.getByRole("link", { name: /CSTR/ })).toHaveAttribute("href", "/portfolio");
  });

  it("colours only a price move: the Positive and Negative pills, never the others", () => {
    render(<PortfolioAlerts rows={alertRows(TYPED, [])} />);

    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("New insight")).toHaveStyle({ color: "var(--text)" });
    expect(within(rows[1]).getByText("Up next")).toHaveStyle({ color: "var(--text2)" });
    expect(within(rows[2]).getByText("Positive move")).toHaveStyle({ color: "var(--up)" });
    expect(within(rows[3]).getByText("Negative move")).toHaveStyle({ color: "var(--down)" });
  });

  it("falls back to the pending calls as New insight rows until the typed alerts load", () => {
    render(<PortfolioAlerts rows={alertRows(undefined, [rec({}), rec({ id: 2, ticker: "VRTX", action: "ADD", name: "Vertex Inc" })])} />);

    expect(screen.getByText("New AI recommendation: TRIM")).toBeInTheDocument();
    expect(screen.getByText("New AI recommendation: ADD")).toBeInTheDocument();
    expect(screen.getByText("Vertex Inc")).toBeInTheDocument();
    expect(screen.getAllByText("New insight")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /AAPL/ })).toHaveAttribute("href", "/today/1");
  });

  it("marks an automatic call, also from the typed alerts", () => {
    render(<PortfolioAlerts rows={alertRows(TYPED, [rec({ id: 7, ticker: "VNTR", source: "scheduled" })])} />);

    expect(screen.getByText(/automatic/i)).toBeInTheDocument();
  });

  it("says what could not be checked, so a missing alert is not read as nothing to report", () => {
    render(<PortfolioAlerts rows={alertRows({ alerts: [], missing: ["earnings", "prices"] }, [])} missing={["earnings", "prices"]} />);

    expect(screen.getByText(/could not check earnings dates or some prices/i)).toBeInTheDocument();
  });
});
