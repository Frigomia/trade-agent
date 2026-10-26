import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { AnalyticsPosition, PortfolioAnalytics } from "@/lib/api/analytics-types";
import { RiskPanel } from "./RiskPanel";

const pos = (ticker: string, weight: number, name = `${ticker} Corp`): AnalyticsPosition => ({
  ticker,
  name,
  value_eur: weight * 10000,
  weight,
  currency: "EUR",
  price: 1,
  price_as_of: null,
  stale: false,
});

const ANALYTICS: PortfolioAnalytics = {
  as_of: "2026-10-22T10:00:00Z",
  total_value_eur: 10000,
  positions: [pos("HLDN", 0.5, "Halden Systems"), pos("TNKP", 0.25), pos("AURL", 0.15), pos("NVKC", 0.1)],
  by_sector: [
    { label: "Technology", weight: 0.6 },
    { label: "Utilities", weight: 0.4 },
  ],
  by_industry: [],
  by_country: [{ label: "Japan", weight: 1 }],
  by_currency: [{ label: "EUR", weight: 1 }],
  top_position_weight: 0.5,
  hhi: 0.3725,
  effective_n: 2.68,
  volatility_annualized: 0.174,
  max_drawdown_1y: -0.182,
  risk_window: { start: "2025-10-23", end: "2026-10-22", intervals_used: 250, intervals_skipped: 0 },
  correlation: {
    HLDN: { HLDN: 1, TNKP: 0.41, AURL: 0.22, NVKC: 0.78 },
    TNKP: { HLDN: 0.41, TNKP: 1, AURL: 0.19, NVKC: 0.38 },
    AURL: { HLDN: 0.22, TNKP: 0.19, AURL: 1, NVKC: null },
    NVKC: { HLDN: 0.78, TNKP: 0.38, AURL: null, NVKC: 1 },
  },
  skipped: {},
  notes: [],
};

const show = (over: Partial<PortfolioAnalytics> = {}, props: { failed?: boolean; none?: boolean; refreshFailed?: boolean; retrying?: boolean } = {}) => {
  const onRetry = vi.fn();
  render(
    <RiskPanel
      analytics={props.none ? undefined : { ...ANALYTICS, ...over }}
      failed={props.failed ?? false}
      refreshFailed={props.refreshFailed}
      retrying={props.retrying}
      onRetry={onRetry}
    />,
  );
  return { onRetry };
};

describe("RiskPanel", () => {
  it("shows the measured facts as plain figures with what each means, and says it is not a score", () => {
    show();

    const panel = screen.getByRole("region", { name: "Risk and analytics" });
    expect(within(panel).getByText("Measured, not scored")).toBeInTheDocument();
    expect(within(panel).getByText("Volatility").parentElement).toHaveTextContent("17.4% a year");
    expect(within(panel).getByText("Largest position").parentElement).toHaveTextContent("50.0%");
    expect(within(panel).getByText("Largest position").parentElement).toHaveTextContent("Halden Systems");
    expect(within(panel).getByText("Top three together").parentElement).toHaveTextContent("90.0%");
    expect(within(panel).getByText("Top three together").parentElement).toHaveTextContent("HLDN, TNKP, AURL");
    expect(within(panel).getByText("Effective holdings").parentElement).toHaveTextContent("2.7");
    expect(within(panel).getByText("Average correlation").parentElement).toHaveTextContent("Highest pair HLDN and NVKC, 0.78");
    expect(within(panel).getByText("Biggest fall, last year").parentElement).toHaveTextContent("-18.2%");
    expect(within(panel).getByText("Biggest fall, last year").parentElement).toHaveTextContent("From peak to low from 23 Oct 2025 to 22 Oct 2026 (250 price intervals), with today's holdings and weights.");
  });

  it("asks for matching history when there is no common window, not when there is one", () => {
    show({ max_drawdown_1y: null, risk_window: null });

    expect(screen.getByText("Biggest fall, last year").parentElement).toHaveTextContent("Needs matching price history");
  });

  it("says Not available, and why, for a figure the backend could not compute", () => {
    show({ volatility_annualized: null, max_drawdown_1y: null, effective_n: null, positions: [pos("HLDN", 1, "Halden Systems")], correlation: {} });

    expect(screen.getByText("Volatility").parentElement).toHaveTextContent("Not available");
    expect(screen.getByText("Volatility").parentElement).toHaveTextContent("Needs matching price history");
    expect(screen.getByText("Biggest fall, last year").parentElement).toHaveTextContent("Not available");
    expect(screen.getByText("Biggest fall, last year").parentElement).toHaveTextContent("Could not be worked out from this price history.");
    expect(screen.getByText("Top three together").parentElement).toHaveTextContent("Needs at least three holdings");
    expect(screen.getByText("Average correlation").parentElement).toHaveTextContent("Needs two holdings with matching history");
  });

  it("keeps the advanced analytics closed until asked, then prints every correlation", () => {
    show();

    const details = document.querySelector("details")!;
    expect(details.open).toBe(false);
    const table = screen.getByRole("table", { name: "Correlation between holdings", hidden: true });
    const cells = within(table).getAllByRole("cell", { hidden: true }).map((c) => c.textContent);
    expect(cells).toContain("0.78");
    expect(cells).toContain("0.19");
    expect(cells.filter((c) => c === "—")).toHaveLength(2); // the pair with no estimate, both ways
    expect(cells.filter((c) => c === "1.00")).toHaveLength(4);
    expect(screen.getByText(/1\.00 means two holdings moved together every day/)).toBeInTheDocument();
  });

  it("lists the spread and states there is no health score", () => {
    show();

    const spread = screen.getByRole("heading", { name: "Spread", hidden: true }).parentElement!;
    expect(within(spread).getByText("Sectors").nextSibling).toHaveTextContent("2");
    expect(within(spread).getByText("Largest sector").nextSibling).toHaveTextContent("Technology, 60.0%");
    expect(within(spread).getByText(/not a rating. There is no overall health score/)).toBeInTheDocument();
  });

  it("says which holdings were left out and the backend's notes, so a gap is never silent", () => {
    show({ skipped: { OLDX: "No exchange rate for XYZ." }, notes: ["Values and weights cover priced positions only; see skipped holdings."] });

    expect(screen.getByText("OLDX is left out: No exchange rate for XYZ.")).toBeInTheDocument();
    expect(screen.getByText(/cover priced positions only/)).toBeInTheDocument();
  });

  it("says the shares are in euro and can differ from the table", () => {
    show();

    expect(screen.getByText(/converted to euro, so these shares can differ a little from the table/i)).toBeInTheDocument();
  });

  it("offers Try again when the figures could not be calculated", () => {
    const { onRetry } = show({}, { failed: true, none: true });

    expect(screen.getByText(/could not be calculated right now/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("disables Try again and says so while a retry is running, so it cannot be clicked into the rate limit", () => {
    const { onRetry } = show({}, { failed: true, none: true, retrying: true });

    const button = screen.getByRole("button", { name: "Trying again…" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("keeps the old figures but says they could not be refreshed after a change", () => {
    const { onRetry } = show({}, { refreshFailed: true });

    expect(screen.getByText("Volatility").parentElement).toHaveTextContent("17.4% a year");
    expect(screen.getByText(/may be out of date: they could not be refreshed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("keeps the old figures on screen, saying they are being updated, while changed figures are read again", () => {
    show({}, { retrying: true });

    expect(screen.getByText("Volatility").parentElement).toHaveTextContent("17.4% a year");
    expect(screen.getByRole("status")).toHaveTextContent("Updating these figures…");
    expect(document.querySelector("[aria-busy='true']")).toHaveTextContent("Volatility"); // the figures themselves, not a skeleton
  });

  it("offers Try again for a failed refresh even when the cached result had nothing valued", () => {
    const { onRetry } = show({ positions: [], total_value_eur: null, correlation: {} }, { refreshFailed: true });

    expect(screen.getByText(/No holding could be valued/)).toBeInTheDocument();
    expect(screen.getByText(/may be out of date: they could not be refreshed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("dims the old figures and marks them busy while they are read again, so they do not look current", () => {
    show({}, { retrying: true });

    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(document.querySelector("[aria-busy='true']")).toHaveTextContent("Volatility");
  });

  it("keeps the status region in the page even when nothing is updating, so a screen reader hears it appear", () => {
    show();

    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("");
  });

  it("says Updating over a cached empty result too", () => {
    show({ positions: [], total_value_eur: null, correlation: {} }, { retrying: true });

    expect(screen.getByRole("status")).toHaveTextContent("Updating these figures");
  });

  it("does not claim a year of observations: the figures use the daily changes the holdings share", () => {
    show();

    expect(screen.getByText("Volatility").parentElement).not.toHaveTextContent(/a year of daily changes|about a year/i);
    expect(screen.getByText("Volatility").parentElement).toHaveTextContent("Annualised, from the daily changes the holdings share.");
    expect(screen.getByText(/Based on the daily changes each pair shares, at least 60 days/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/about a year/i);
  });

  it("does not say anything is stale when the refresh worked", () => {
    show();

    expect(screen.queryByText(/could not be refreshed/i)).not.toBeInTheDocument();
  });

  it("reports unclassified holdings apart, not as a sector", () => {
    show({ by_sector: [{ label: "Unclassified", weight: 0.4 }, { label: "Technology", weight: 0.6 }] });

    const spread = screen.getByRole("heading", { name: "Spread", hidden: true }).parentElement!;
    expect(within(spread).getByText("Sectors").nextSibling).toHaveTextContent("1");
    expect(within(spread).getByText("Sector not known").nextSibling).toHaveTextContent("40.0%");
  });

  it("names the correlation table's corner column for screen readers", () => {
    show();

    expect(screen.getByRole("columnheader", { name: "Holding", hidden: true })).toBeInTheDocument();
  });

  it("shows a placeholder while the figures load", () => {
    show({}, { none: true, retrying: true });

    expect(document.querySelector("[aria-busy]")).not.toBeNull();
    expect(screen.queryByText("Volatility")).not.toBeInTheDocument();
  });

  it("explains an empty result when no holding could be valued", () => {
    show({ positions: [], total_value_eur: null, skipped: { ABC: "No exchange rate for XYZ." } });

    expect(screen.getByText(/No holding could be valued/)).toBeInTheDocument();
    expect(screen.getByText("ABC is left out: No exchange rate for XYZ.")).toBeInTheDocument();
  });

  it("never colours the figures as a gain or a loss", () => {
    show();

    const html = document.body.innerHTML;
    expect(html).not.toMatch(/var\(--up\)|var\(--down\)/);
  });

  it("asks for correlation from two holdings, not an empty table, with only one", () => {
    show({ positions: [pos("HLDN", 1)], correlation: { HLDN: { HLDN: 1 } } });

    expect(screen.getByText("Correlation needs at least two holdings.", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("table", { hidden: true })).not.toBeInTheDocument();
  });
});
