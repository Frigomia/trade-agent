import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvidencePanel } from "./EvidencePanel";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

function rec(overrides: Partial<RecommendationOut> = {}): RecommendationOut {
  return {
    id: 1,
    user_id: "u1",
    created_at: "2026-01-01T00:00:00",
    ticker: "AAPL",
    asset_type: "STOCK",
    action: "BUY",
    reasoning: ["Fundamental score 78/100", "Technical signal: OVERSOLD"],
    ai_analysis: "Earnings beat on services.",
    suggested_position_pct: 0.075,
    status: "PENDING",
    reviewed_at: null,
    fundamental_score: 78,
    technical_signal: "OVERSOLD",
    price_at_recommendation: 186.4,
    current_price: 186.4,
    price_change_pct: -1.2,
    ...overrides,
  };
}

describe("EvidencePanel", () => {
  it("shows the fundamentals score, technical signal, and suggested size", () => {
    render(<EvidencePanel recommendation={rec()} />);

    expect(screen.getByText(/78/)).toBeInTheDocument();
    expect(screen.getByText("Oversold")).toBeInTheDocument();
    expect(screen.getByText(/7\.5%/)).toBeInTheDocument();
  });

  it("omits the fundamentals row when there is no score", () => {
    render(<EvidencePanel recommendation={rec({ fundamental_score: null })} />);

    expect(screen.queryByText(/Fundamentals/i)).not.toBeInTheDocument();
  });

  it("omits the suggested size row when there is none", () => {
    render(<EvidencePanel recommendation={rec({ suggested_position_pct: null })} />);

    expect(screen.queryByText(/Suggested size/i)).not.toBeInTheDocument();
  });
});
