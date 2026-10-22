import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Numbers } from "./Numbers";
import { RiskFit } from "./RiskFit";
import { peer, testIdea } from "./testData";

describe("Numbers", () => {
  it("lists the fundamentals as tiles with the right units, and says Not available for a missing one", () => {
    render(<Numbers idea={testIdea()} />);

    const fund = screen.getByRole("heading", { name: "Fundamentals" }).closest("section")!;
    expect(within(fund).getByText("Return on equity").parentElement).toHaveTextContent("21.3%");
    expect(within(fund).getByText("P/E").parentElement).toHaveTextContent("24.6x");
    const cover = within(fund).getByText("Interest cover").parentElement!;
    expect(cover).toHaveTextContent("Not available");
    expect(cover).toHaveTextContent("No source for this company");
  });

  it("falls back to the saved raw fundamentals when no comparisons were saved", () => {
    render(<Numbers idea={testIdea({ peers: [] })} />);

    const fund = screen.getByRole("heading", { name: "Fundamentals" }).closest("section")!;
    expect(within(fund).getByText("Debt to equity").parentElement).toHaveTextContent("140.0%");
  });

  it("draws a band per comparable metric with the position in words and the median", () => {
    render(<Numbers idea={testIdea()} />);

    expect(screen.getByRole("heading", { name: "Valuation and quality against peers" })).toBeInTheDocument();
    expect(screen.getByText("Industry group · 12 companies")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Return on equity: 21.3%, peer median 15.7%, above peer median" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "P/E: 24.6x, peer median 29.8x, within the usual range" })).toBeInTheDocument();
    expect(screen.getByText("Above peer median")).toBeInTheDocument();
    expect(screen.getByText(/lower is not automatically better/i)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /interest cover/i })).not.toBeInTheDocument(); // no band for an unavailable one
  });

  it("states each comparison's own group and count, and labels a mix of industry and sector peers", () => {
    render(
      <Numbers
        idea={testIdea({
          peers: [peer("returnOnEquity", { peer_group: "industry", peer_count: 12 }), peer("trailingPE", { peer_group: "sector", peer_count: 40 })],
        })}
      />,
    );

    expect(screen.getByText("Industry and sector groups · 12 to 40 companies")).toBeInTheDocument();
    expect(screen.queryByText("Industry group · 40 companies")).not.toBeInTheDocument();
    expect(screen.getByText("median 15.0% · 12 industry peers")).toBeInTheDocument();
    expect(screen.getByText("median 0.15x · 40 sector peers")).toBeInTheDocument();
  });

  it("names the metrics that have no peer verdict instead of dropping them when others do", () => {
    const base = testIdea();
    render(<Numbers idea={testIdea({ peers: [...base.peers!, peer("payoutRatio", { value: 0.4, position: "unavailable", peer_median: null, peer_p25: null, peer_p75: null })] })} />);

    expect(screen.getByText(/No peer verdict for: Payout ratio 40.0%./)).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(2); // the two comparable metrics still have their bands
  });

  it("says no comparison was saved, not that peers were too few, when the idea carries none", () => {
    render(<Numbers idea={testIdea({ peers: undefined })} />);

    expect(screen.getByText("No peer comparison was saved with this idea.")).toBeInTheDocument();
    expect(screen.queryByText(/too few comparable companies/i)).not.toBeInTheDocument();
  });

  it("picks table columns the saved peers have figures for", () => {
    const base = testIdea();
    // The company has three figures, but the peers only carry P/E: that is the column that is shown.
    const idea = testIdea({
      peers: [peer("returnOnEquity", { value: 0.2 }), peer("operatingMargins", { value: 0.3 }), peer("trailingPE", { value: 24.6, position: "within" })],
      snapshot: { ...base.snapshot!, peers: [{ ticker: "PEER1", name: "Peerco One", country: "Germany", currency: "EUR", market_cap_eur: 1e9, values: { trailingPE: 31.2 } }] },
    });
    render(<Numbers idea={idea} />);

    const table = screen.getByRole("table", { name: "Named peers" });
    expect(within(table).getByRole("columnheader", { name: "P/E" })).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Return on equity" })).not.toBeInTheDocument();
  });

  it("shows raw values with no verdict when there are too few peers", () => {
    const idea = testIdea({ peers: [peer("returnOnEquity", { value: 0.213, position: "unavailable", peer_median: null, peer_p25: null, peer_p75: null, peer_group: "none", peer_count: 0 })] });
    render(<Numbers idea={idea} />);

    expect(screen.getByText("No peer comparison")).toBeInTheDocument();
    expect(screen.getByText("Peers unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const valuation = screen.getByText("No peer comparison").closest("section")!;
    expect(within(valuation).getByText("21.3%")).toBeInTheDocument();
  });

  it("puts this company first in the named-peer table, then the peers, with figures that are missing marked", () => {
    render(<Numbers idea={testIdea()} />);

    const table = screen.getByRole("table", { name: "Named peers" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4); // header, this company, two peers
    expect(rows[1]).toHaveTextContent("Halden Systems");
    expect(rows[1]).toHaveTextContent("this company");
    expect(rows[1]).toHaveTextContent("EUR 38.2B");
    expect(rows[2]).toHaveTextContent("Peerco One");
    expect(rows[2]).toHaveTextContent("EUR 21.0B");
    expect(rows[2]).toHaveTextContent("18.0%");
    expect(rows[2]).toHaveTextContent("31.2x"); // a second metric column
    expect(rows[3]).toHaveTextContent("Peerco Two");
    expect(rows[3]).toHaveTextContent("Not available"); // no market cap and no return on equity
  });

  it("says named peers are not available yet when the idea saved none, and lists research names apart, unchecked", () => {
    render(<Numbers idea={testIdea({ snapshot: { ...testIdea().snapshot!, peers: null } })} />);

    expect(screen.getByText("Named peers are not available for this idea yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("Rival One Ltd")).toBeInTheDocument();
    expect(screen.getByText(/not checked and without figures/i)).toBeInTheDocument();
  });

  it("says so when no fundamentals were saved at all", () => {
    render(<Numbers idea={testIdea({ peers: [], snapshot: { ...testIdea().snapshot!, fundamentals: {} } })} />);

    expect(screen.getByText("No fundamentals were saved with this idea.")).toBeInTheDocument();
  });
});

describe("RiskFit", () => {
  it("shows what was measured, marked as not scored", () => {
    render(<RiskFit idea={testIdea()} />);

    const risk = screen.getByRole("heading", { name: "Risk characteristics" }).closest("section")!;
    expect(within(risk).getByText("Measured, not scored")).toBeInTheDocument();
    expect(within(risk).getByText("28% a year")).toBeInTheDocument();
    expect(within(risk).getByText("-12%")).toBeInTheDocument();
    expect(within(risk).getByText("Large · EUR 38.2B")).toBeInTheDocument();
    expect(within(risk).getByText("EUR 190M a day")).toBeInTheDocument();
    expect(within(risk).getByText("140.0%")).toBeInTheDocument();
    expect(within(risk).getByText("Thin trading")).toBeInTheDocument();
    expect(within(risk).getByText(/0\.4M EUR traded a day/)).toBeInTheDocument();
  });

  it("says Not available for what was not measured and that no flags were raised", () => {
    const base = testIdea();
    render(<RiskFit idea={testIdea({ risk: { ...base.risk, volatility_annualized: null, max_drawdown_1y: null, market_cap_eur: null, avg_daily_value_eur: null, size_bucket: "unknown", risk_flags: [] }, snapshot: { ...base.snapshot!, fundamentals: {} }, peers: [] })} />);

    expect(screen.getAllByText("Not available")).toHaveLength(5);
    expect(screen.getByText("The scan raised no risk flags.")).toBeInTheDocument();
  });

  it("shows the fit score with its written reading, labelled as AI text", () => {
    render(<RiskFit idea={testIdea()} />);

    const fit = screen.getByRole("heading", { name: "Portfolio fit" }).closest("section")!;
    expect(fit).toHaveTextContent("61 fit, of 100 · computed");
    expect(within(fit).getByText("It would add software exposure you do not have.")).toBeInTheDocument();
    expect(within(fit).getByText("AI research summary")).toBeInTheDocument();
  });

  it("lists the fit facts the scan saved, as neutral before and after figures, with what they assume", () => {
    render(<RiskFit idea={testIdea()} />);

    const fit = screen.getByRole("heading", { name: "Portfolio fit" }).closest("section")!;
    expect(within(fit).getByText("Software weight").parentElement).toHaveTextContent("3% → 7%");
    expect(within(fit).getByText("Concentration").parentElement).toHaveTextContent("0.20 → 0.19");
    expect(within(fit).getByText("Portfolio volatility").parentElement).toHaveTextContent("12.4% → 11.8%");
    expect(within(fit).getByText("Correlation with your holdings").parentElement).toHaveTextContent("0.31");
    expect(within(fit).getByText(/assume this company at 5% of your portfolio/i)).toBeInTheDocument();
  });

  it("leaves out a fit figure the scan could not compute and shows the scan's own notes", () => {
    const base = testIdea();
    render(<RiskFit idea={testIdea({ fit: { ...base.fit!, portfolio_vol_before: null, portfolio_vol_after: null, notes: ["Only two holdings could be priced."] } })} />);

    const fit = screen.getByRole("heading", { name: "Portfolio fit" }).closest("section")!;
    expect(within(fit).queryByText("Portfolio volatility")).not.toBeInTheDocument();
    expect(within(fit).getByText("Only two holdings could be priced.")).toBeInTheDocument();
  });

  it("still shows the scan's notes when no fit figure could be computed", () => {
    const base = testIdea();
    const none = { sector_weight_before: null, sector_weight_after: null, hhi_before: null, hhi_after: null, portfolio_vol_before: null, portfolio_vol_after: null, avg_correlation_to_portfolio: null };
    render(<RiskFit idea={testIdea({ fit: { ...base.fit!, ...none, notes: ["Only two holdings could be priced."] } })} />);

    const fit = screen.getByRole("heading", { name: "Portfolio fit" }).closest("section")!;
    expect(within(fit).getByText("Only two holdings could be priced.")).toBeInTheDocument();
    expect(within(fit).queryByText(/assume this company/i)).not.toBeInTheDocument();
  });

  it("shows the score alone for an idea saved before the fit facts existed", () => {
    render(<RiskFit idea={testIdea({ fit: undefined })} />);

    const fit = screen.getByRole("heading", { name: "Portfolio fit" }).closest("section")!;
    expect(fit).toHaveTextContent("61 fit, of 100 · computed");
    expect(within(fit).queryByText("Concentration")).not.toBeInTheDocument();
    expect(within(fit).queryByText(/assume this company/i)).not.toBeInTheDocument();
  });

  it("says Not applicable for fit when there is nothing to compare with", () => {
    render(<RiskFit idea={testIdea({ scores: [{ name: "fit", score: null, reasons: [] }], fit_summary: null, fit: null })} />);

    expect(screen.getByText("Not applicable")).toBeInTheDocument();
    expect(screen.queryByText("Concentration")).not.toBeInTheDocument();
    expect(screen.queryByText(/computed/)).not.toBeInTheDocument();
  });
});
