import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import TrackRecordPage from "./page";

function renderFresh() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TrackRecordPage />
    </SWRConfig>,
  );
}

function rec(id: number, action: RecommendationOut["action"], ret: number | null, evaluated = true): RecommendationOut {
  return {
    id, user_id: "u1", created_at: `2026-08-0${id}T00:00:00`, ticker: `T${id}`, asset_type: "STOCK",
    action, reasoning: [], ai_analysis: null, suggested_position_pct: null, status: "APPROVED",
    reviewed_at: null, fundamental_score: null, technical_signal: null, price_at_recommendation: 100,
    current_price: null, price_change_pct: null, outcome_forward_return_pct: ret,
    outcome_evaluated_at: evaluated ? "2026-08-25T00:00:00" : null,
  };
}

describe("TrackRecordPage", () => {
  beforeEach(() => apiFetch.mockReset());

  it("shows the summary, a small-sample label and each scored row with a word and sign", async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === "/analysis/recommendations") return [rec(1, "BUY", 0.05), rec(2, "SELL", 0.03), rec(3, "HOLD", 0.01)];
      return { evaluated: 0, remaining: 0 };
    });
    renderFresh();
    expect(await screen.findByText(/calls moved the way the action implied/i)).toBeInTheDocument();
    expect(screen.getByText(/of 2/)).toBeInTheDocument();
    expect(screen.getByText(/small sample, not a forecast/i)).toBeInTheDocument();
    expect(screen.getByText("+5.0%")).toBeInTheDocument();
    expect(screen.getByText("+3.0%")).toBeInTheDocument();
    expect(screen.getByText(/matched/i)).toBeInTheDocument();
    expect(screen.getByText(/missed/i)).toBeInTheDocument();
    expect(screen.getByText(/not scored/i)).toBeInTheDocument();
  });

  it("shows an empty state instead of 0 of 0 when nothing is scored", async () => {
    apiFetch.mockImplementation(async (path: string) =>
      path === "/analysis/recommendations" ? [rec(1, "BUY", null, false), rec(2, "HOLD", 0.02)] : { evaluated: 0, remaining: 0 },
    );
    renderFresh();
    expect(await screen.findByText(/no scored calls yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 of 0/)).not.toBeInTheDocument();
  });

  it("asks the backend to evaluate due outcomes once, and refetches after", async () => {
    apiFetch.mockImplementation(async (path: string) =>
      path === "/analysis/recommendations" ? [] : { evaluated: 2, remaining: 0 },
    );
    renderFresh();
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/memory/evaluate-outcomes", { method: "POST" }),
    );
    const evaluateCalls = apiFetch.mock.calls.filter((c) => c[0] === "/memory/evaluate-outcomes");
    expect(evaluateCalls).toHaveLength(1);
    await waitFor(() =>
      expect(apiFetch.mock.calls.filter((c) => c[0] === "/analysis/recommendations").length).toBeGreaterThan(1),
    );
  });

  it("still shows the list when evaluate-outcomes fails", async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === "/memory/evaluate-outcomes") throw new Error("upstream down");
      return [rec(1, "BUY", 0.05)];
    });
    renderFresh();
    expect(await screen.findByText(/calls moved the way the action implied/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an error when the list cannot load", async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === "/analysis/recommendations") throw new Error("boom");
      return { evaluated: 0, remaining: 0 };
    });
    renderFresh();
    expect(await screen.findByText(/could not load your track record/i)).toBeInTheDocument();
  });
});
