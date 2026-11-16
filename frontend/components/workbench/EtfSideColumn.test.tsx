import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { EtfSideColumn } from "./EtfSideColumn";
import { etfIdea } from "./testData";

const unknownSize = () =>
  etfIdea({
    snapshot: {
      exchange: "XETRA",
      country: null,
      sector: null,
      industry: "Global Large-Cap Blend Equity",
      currency: "EUR",
      price: 112.4,
      price_as_of: "2026-10-19T20:00:00",
      fundamentals: { expenseRatio: 0.0022 },
    },
  });

const fact = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling!;

describe("EtfSideColumn", () => {
  it("lists the fund facts the snapshot carries", () => {
    render(<EtfSideColumn idea={etfIdea({ name: "Global All-Cap UCITS ETF (Acc)" })} />);

    expect(screen.getByRole("heading", { name: "Fund facts" })).toBeInTheDocument();
    expect(fact("Expense ratio")).toHaveTextContent("0.22% a year");
    expect(fact("Fund size")).toHaveTextContent("EUR 9.8B");
    expect(fact("Category")).toHaveTextContent("Global Large-Cap Blend Equity");
    expect(fact("Structure")).toHaveTextContent("UCITS · Acc");
    expect(fact("Listing")).toHaveTextContent("XETRA · EUR");
    // The snapshot has no ISIN field, so there is no row to show.
    expect(screen.queryByText("ISIN")).not.toBeInTheDocument();
  });

  it("shows all six quality-filter rows as Pass, in words", () => {
    render(<EtfSideColumn idea={etfIdea()} />);

    const panel = screen.getByRole("heading", { name: /Quality filter/ }).closest("section")!;
    expect(within(panel).getByText("6 of 6 pass")).toBeInTheDocument();
    const rows = within(panel).getAllByRole("listitem");
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(within(row).getByText("Pass")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Cost")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Expense ratio 0.22% · at most 0.50%")).toBeInTheDocument();
    expect(within(rows[5]).getByText("No overlap with your ETFs")).toBeInTheDocument();
    expect(within(panel).queryByText("Unknown")).not.toBeInTheDocument();
  });

  it("marks an unsaved fund size Unknown and says it was not saved", () => {
    render(<EtfSideColumn idea={unknownSize()} />);

    expect(fact("Fund size")).toHaveTextContent("Not saved with this idea");
    expect(screen.getByText("5 pass · 1 unknown")).toBeInTheDocument();
    const size = screen.getByText("Size").closest("li")!;
    expect(within(size).getByText("Unknown")).toBeInTheDocument();
    expect(within(size).getByText("Fund size not saved · at least EUR 100M")).toBeInTheDocument();
    expect(screen.getAllByText("Pass")).toHaveLength(5);
  });

  it("shows no correlation number", () => {
    const fit = { ticker: "VWCE", applicable: true, avg_correlation_to_portfolio: 0.52, portfolio_vol_before: 0.15, portfolio_vol_after: 0.14, hhi_before: 0.2, hhi_after: 0.19, sector_weight_before: null, sector_weight_after: null, hypothetical_weight: 0.05, notes: [] };
    render(<EtfSideColumn idea={etfIdea({ fit })} />);

    const panel = screen.getByRole("heading", { name: /Quality filter/ }).closest("section")!;
    expect(panel.textContent).not.toContain("0.52");
    expect(within(panel).getByText("Not a near-copy of an ETF you hold (same category, correlation 0.95 or more)")).toBeInTheDocument();
  });
});
