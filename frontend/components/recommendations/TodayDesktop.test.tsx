import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { PortfolioSummary } from "@/lib/api/portfolio-types";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { CostBasisTile, TodayDesktop } from "./TodayDesktop";

function show(covered: number, complete: boolean, profit: number) {
  const summary = {
    holdings: [{ shares: 1 }], total_pl: profit,
    total_pl_pct: covered ? 25 : null, unknown_basis_count: complete ? 0 : 1,
    pl_covered_count: covered, pl_complete: complete,
  } as PortfolioSummary;
  apiFetch.mockResolvedValue(summary);
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><CostBasisTile /></SWRConfig>);
}

beforeEach(() => vi.clearAllMocks());

describe("CostBasisTile", () => {
  it("does not show break-even when no purchase cost is known", async () => {
    show(0, false, 0);
    expect(await screen.findByText(/P\/L unavailable/)).toBeInTheDocument();
    expect(screen.getByText("\u2014")).toBeInTheDocument();
    expect(screen.queryByText("+0.00")).not.toBeInTheDocument();
  });
  it("labels partial profit coverage", async () => {
    show(1, false, 50);
    expect(await screen.findByText("+50.00")).toBeInTheDocument();
    expect(screen.getByText(/P\/L covers priced holdings with known costs/)).toBeInTheDocument();
  });
  it("shows complete gains without a coverage warning", async () => {
    show(1, true, 50);
    expect(await screen.findByText("+50.00")).toBeInTheDocument();
    expect(screen.queryByText(/P\/L covers/)).not.toBeInTheDocument();
  });
});

describe("TodayDesktop", () => {
  it("shows the Portfolio alerts panel and no portfolio value chart, and asks for no snapshots", () => {
    const recs = [{ id: 1, ticker: "AAPL", action: "TRIM", status: "PENDING" }] as RecommendationOut[];
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><TodayDesktop recommendations={recs} /></SWRConfig>);

    expect(screen.getByRole("heading", { name: "Portfolio alerts" })).toBeInTheDocument();
    expect(screen.queryByText("Portfolio value")).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith("/portfolio/snapshots");
  });
});
