import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

const apiFetch = vi.fn();
const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
    }
  }
  return { FakeApiError };
});
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: FakeApiError,
}));

import { RecommendationCard } from "./RecommendationCard";

function rec(overrides: Partial<RecommendationOut> = {}): RecommendationOut {
  return {
    id: 1,
    user_id: "u1",
    created_at: "2026-01-01T00:00:00",
    ticker: "AAPL",
    asset_type: "STOCK",
    action: "BUY",
    reasoning: ["Fundamental score 78/100", "Technical signal: OVERSOLD"],
    ai_analysis: "Earnings beat on services. Coverage flags China demand risk.",
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

describe("RecommendationCard", () => {
  it("links the ticker to the detail page", () => {
    render(<RecommendationCard recommendation={rec()} onDecided={vi.fn()} />);
    expect(screen.getByRole("link", { name: /AAPL/i })).toHaveAttribute("href", "/today/1");
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows ticker, action, price, day change, and the first sentence of ai_analysis", () => {
    render(<RecommendationCard recommendation={rec()} onDecided={vi.fn()} />);

    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("BUY")).toBeInTheDocument();
    expect(screen.getByText(/186\.4/)).toBeInTheDocument();
    expect(screen.getByText(/-1\.2%/)).toBeInTheDocument();
    expect(screen.getByText("Earnings beat on services.")).toBeInTheDocument();
  });

  it("tags a scheduled recommendation as Automatic and leaves a manual one untagged", () => {
    const { unmount } = render(
      <RecommendationCard recommendation={rec({ source: "scheduled" })} onDecided={vi.fn()} />,
    );
    expect(screen.getByText("Automatic")).toBeInTheDocument();
    unmount();

    render(<RecommendationCard recommendation={rec({ source: "manual" })} onDecided={vi.fn()} />);
    expect(screen.queryByText("Automatic")).not.toBeInTheDocument();
  });

  it("treats a recommendation with no source as manual", () => {
    render(<RecommendationCard recommendation={rec()} onDecided={vi.fn()} />);
    expect(screen.queryByText("Automatic")).not.toBeInTheDocument();
  });

  it("omits the price row when the live quote is unavailable", () => {
    render(
      <RecommendationCard
        recommendation={rec({ current_price: null, price_change_pct: null })}
        onDecided={vi.fn()}
      />,
    );

    expect(screen.queryByText(/186\.4/)).not.toBeInTheDocument();
  });

  it("does not repeat the raw reasoning wording next to the structured evidence", () => {
    render(<RecommendationCard recommendation={rec({ ai_analysis: null })} onDecided={vi.fn()} />);

    expect(screen.getByText("Oversold")).toBeInTheDocument();
    expect(screen.queryByText(/Technical signal: OVERSOLD/)).not.toBeInTheDocument();
  });

  it("approves and calls onDecided with the updated recommendation", async () => {
    const onDecided = vi.fn();
    const updated = rec({ status: "APPROVED" });
    apiFetch.mockResolvedValue(updated);
    render(<RecommendationCard recommendation={rec()} onDecided={onDecided} />);

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/analysis/recommendations/1/approve",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith(updated));
  });

  it("dismisses and calls onDecided", async () => {
    const onDecided = vi.fn();
    apiFetch.mockResolvedValue(rec({ status: "REJECTED" }));
    render(<RecommendationCard recommendation={rec()} onDecided={onDecided} />);

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/analysis/recommendations/1/reject",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("shows an inline error and does not call onDecided when approve fails", async () => {
    const onDecided = vi.fn();
    apiFetch.mockRejectedValue(new FakeApiError(500, "Something broke"));
    render(<RecommendationCard recommendation={rec()} onDecided={onDecided} />);

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(screen.getByText("Something broke")).toBeInTheDocument());
    expect(onDecided).not.toHaveBeenCalled();
  });

  it("ignores a second click while the first approve is still in flight", async () => {
    let resolve!: (value: RecommendationOut) => void;
    apiFetch.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<RecommendationCard recommendation={rec()} onDecided={vi.fn()} />);

    const approveButton = screen.getByRole("button", { name: /approve/i });
    fireEvent.click(approveButton);
    fireEvent.click(approveButton);

    resolve(rec({ status: "APPROVED" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
  });
});
