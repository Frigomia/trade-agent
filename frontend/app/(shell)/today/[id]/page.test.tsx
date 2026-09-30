import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
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

const push = vi.fn();
let routeId = "1";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ id: routeId }),
}));

import RecommendationDetailPage from "./page";

function renderFresh(ui: React.ReactElement) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

function rec(overrides: Partial<RecommendationOut> = {}): RecommendationOut {
  return {
    id: 1,
    user_id: "u1",
    created_at: "2026-01-01T00:00:00",
    ticker: "NVDA",
    asset_type: "STOCK",
    action: "TRIM",
    reasoning: ["Fundamental score 52/100", "Technical signal: NEUTRAL"],
    ai_analysis: "Coverage leans positive on demand. This conflicts with the fundamentals reading.",
    suggested_position_pct: 0.05,
    status: "PENDING",
    reviewed_at: null,
    fundamental_score: 52,
    technical_signal: "NEUTRAL",
    price_at_recommendation: 121.6,
    current_price: 121.6,
    price_change_pct: -1.8,
    ...overrides,
  };
}

describe("RecommendationDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeId = "1";
  });

  it("never calls the API for a non-numeric id", () => {
    routeId = "..%2F..%2Fadmin%2Fusers";
    renderFresh(<RecommendationDetailPage />);

    expect(screen.getByText("Recommendation not found.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("shows the full evidence, reasoning list, and web opinion", async () => {
    apiFetch.mockResolvedValue(rec());
    renderFresh(<RecommendationDetailPage />);

    await waitFor(() => expect(screen.getByText("NVDA")).toBeInTheDocument());
    expect(screen.getByText("Fundamental score 52/100")).toBeInTheDocument();
    expect(screen.getByText("Technical signal: NEUTRAL")).toBeInTheDocument();
    expect(screen.getByText(/not part of the score/i)).toBeInTheDocument();
    expect(screen.getByText(/conflicts with the fundamentals reading/i)).toBeInTheDocument();
  });

  it("shows an inline error when the recommendation fails to load", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(404, "Recommendation not found"));
    renderFresh(<RecommendationDetailPage />);

    await waitFor(() => expect(screen.getByText("Recommendation not found")).toBeInTheDocument());
  });

  it("shows the confirmation panel immediately when the recommendation was already decided", async () => {
    apiFetch.mockResolvedValue(rec({ status: "APPROVED" }));
    renderFresh(<RecommendationDetailPage />);

    await waitFor(() => expect(screen.getByText(/decision recorded/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it("approving swaps to the confirmation panel", async () => {
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/analysis/recommendations/1") return Promise.resolve(rec());
      if (path === "/analysis/recommendations/1/approve" && init?.method === "POST") {
        return Promise.resolve(rec({ status: "APPROVED" }));
      }
      return Promise.reject(new Error("unexpected " + path));
    });
    renderFresh(<RecommendationDetailPage />);

    await waitFor(() => expect(screen.getByText("NVDA")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(screen.getByText(/decision recorded/i)).toBeInTheDocument());
  });

  it("back to Today navigates to /today", async () => {
    apiFetch.mockResolvedValue(rec({ status: "APPROVED" }));
    renderFresh(<RecommendationDetailPage />);

    await waitFor(() => expect(screen.getByText(/decision recorded/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /back to today/i }));

    expect(push).toHaveBeenCalledWith("/today");
  });

  it("ignores a second click while the first dismiss is still in flight", async () => {
    let resolve!: (value: RecommendationOut) => void;
    apiFetch.mockImplementation((path: string) => {
      if (path === "/analysis/recommendations/1") return Promise.resolve(rec());
      return new Promise((r) => { resolve = r; });
    });
    renderFresh(<RecommendationDetailPage />);

    await waitFor(() => expect(screen.getByText("NVDA")).toBeInTheDocument());
    const dismissButton = screen.getByRole("button", { name: /dismiss/i });
    fireEvent.click(dismissButton);
    fireEvent.click(dismissButton);

    resolve(rec({ status: "REJECTED" }));
    await waitFor(() =>
      expect(apiFetch.mock.calls.filter((c) => c[0] === "/analysis/recommendations/1/reject")).toHaveLength(1),
    );
  });
});
