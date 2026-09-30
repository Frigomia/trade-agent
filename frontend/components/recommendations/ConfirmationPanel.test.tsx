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
// Tested on its own; here it would only add a portfolio request to the shared apiFetch mock.
vi.mock("@/components/portfolio/LogTradeCta", () => ({ LogTradeCta: () => "log-trade-cta" }));

import { ConfirmationPanel } from "./ConfirmationPanel";

function rec(overrides: Partial<RecommendationOut> = {}): RecommendationOut {
  return {
    id: 1,
    user_id: "u1",
    created_at: "2026-01-01T00:00:00",
    ticker: "NVDA",
    asset_type: "STOCK",
    action: "TRIM",
    reasoning: ["x"],
    ai_analysis: null,
    suggested_position_pct: null,
    status: "APPROVED",
    reviewed_at: "2026-01-02T00:00:00",
    fundamental_score: null,
    technical_signal: null,
    price_at_recommendation: null,
    current_price: null,
    price_change_pct: null,
    ...overrides,
  };
}

describe("ConfirmationPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers to log the trade after an approval", () => {
    render(
      <ConfirmationPanel recommendation={rec()} onChanged={vi.fn()} onBackToToday={vi.fn()} />,
    );

    expect(screen.getByText("log-trade-cta")).toBeInTheDocument();
  });

  it("does not offer it after a dismissal", () => {
    render(
      <ConfirmationPanel
        recommendation={rec({ status: "REJECTED" })}
        onChanged={vi.fn()}
        onBackToToday={vi.fn()}
      />,
    );

    expect(screen.queryByText("log-trade-cta")).not.toBeInTheDocument();
  });

  it("shows what was decided, for an approved recommendation", () => {
    render(
      <ConfirmationPanel recommendation={rec()} onChanged={vi.fn()} onBackToToday={vi.fn()} />,
    );

    expect(screen.getByText(/decision recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/NVDA/)).toBeInTheDocument();
    expect(screen.getByText(/TRIM/)).toBeInTheDocument();
    expect(screen.getByText(/no order was placed/i)).toBeInTheDocument();
  });

  it("calls onBackToToday when that button is clicked", () => {
    const onBackToToday = vi.fn();
    render(
      <ConfirmationPanel recommendation={rec()} onChanged={vi.fn()} onBackToToday={onBackToToday} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /back to today/i }));
    expect(onBackToToday).toHaveBeenCalled();
  });

  it("changing the decision on an approved recommendation calls reject and onChanged", async () => {
    const onChanged = vi.fn();
    const reverted = rec({ status: "REJECTED" });
    apiFetch.mockResolvedValue(reverted);
    render(
      <ConfirmationPanel recommendation={rec()} onChanged={onChanged} onBackToToday={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /change my decision/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/analysis/recommendations/1/reject",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(reverted));
  });

  it("changing the decision on a rejected recommendation calls approve", async () => {
    apiFetch.mockResolvedValue(rec({ status: "APPROVED" }));
    render(
      <ConfirmationPanel
        recommendation={rec({ status: "REJECTED" })}
        onChanged={vi.fn()}
        onBackToToday={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /change my decision/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/analysis/recommendations/1/approve",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("shows an inline error when changing the decision fails", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(500, "Something broke"));
    render(
      <ConfirmationPanel recommendation={rec()} onChanged={vi.fn()} onBackToToday={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /change my decision/i }));

    await waitFor(() => expect(screen.getByText("Something broke")).toBeInTheDocument());
  });
});
