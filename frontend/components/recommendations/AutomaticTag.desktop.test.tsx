import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn().mockResolvedValue([]), ApiError: class extends Error {} }));
vi.mock("@/components/portfolio/PortfolioChart", () => ({ PortfolioChart: () => null }));

import { TodayDesktop } from "./TodayDesktop";
import { RecommendationDetailDesktop } from "./RecommendationDetailDesktop";

function rec(overrides: Partial<RecommendationOut> = {}): RecommendationOut {
  return {
    id: 1,
    user_id: "u1",
    created_at: "2026-01-01T00:00:00",
    ticker: "AAPL",
    asset_type: "STOCK",
    action: "BUY",
    reasoning: [],
    ai_analysis: null,
    suggested_position_pct: 0.05,
    status: "PENDING",
    reviewed_at: null,
    fundamental_score: 70,
    technical_signal: "NEUTRAL",
    price_at_recommendation: 100,
    current_price: 100,
    price_change_pct: 1,
    ...overrides,
  };
}

const wrap = (ui: React.ReactElement) =>
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);

describe("Automatic tag on the desktop views", () => {
  it("tags only the scheduled row in the Today list, and the row wraps instead of overflowing", () => {
    wrap(
      <TodayDesktop
        recommendations={[rec({ id: 1, ticker: "AAPL", source: "scheduled" }), rec({ id: 2, ticker: "MSFT" })]}
      />,
    );
    expect(screen.getAllByText("Automatic")).toHaveLength(1);
    const row = screen.getByText("AAPL").closest("li");
    expect(row).toHaveStyle({ flexWrap: "wrap" });
    expect(row).toContainElement(screen.getByText("Automatic"));
  });

  it("tags a scheduled detail header, hides the icon from assistive tech, and wraps", () => {
    const { container } = wrap(
      <RecommendationDetailDesktop recommendation={rec({ source: "scheduled" })} onDecided={vi.fn()} />,
    );
    expect(screen.getByText("Automatic")).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("AAPL").parentElement).toHaveStyle({ flexWrap: "wrap" });
  });

  it("shows no tag on a manual detail header", () => {
    wrap(<RecommendationDetailDesktop recommendation={rec()} onDecided={vi.fn()} />);
    expect(screen.queryByText("Automatic")).not.toBeInTheDocument();
  });
});
