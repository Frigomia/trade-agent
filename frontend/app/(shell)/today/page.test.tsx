import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { RecommendationOut, JobStatus } from "@/lib/api/recommendation-types";

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

import TodayPage from "./page";

function renderFresh(ui: React.ReactElement) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

function rec(overrides: Partial<RecommendationOut> = {}): RecommendationOut {
  return {
    id: 1,
    user_id: "u1",
    created_at: "2026-01-01T00:00:00",
    ticker: "AAPL",
    asset_type: "STOCK",
    action: "BUY",
    reasoning: ["Technical signal: OVERSOLD"],
    ai_analysis: null,
    suggested_position_pct: null,
    status: "PENDING",
    reviewed_at: null,
    fundamental_score: null,
    technical_signal: null,
    price_at_recommendation: null,
    current_price: null,
    price_change_pct: null,
    ...overrides,
  };
}

describe("TodayPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists pending recommendations", async () => {
    apiFetch.mockImplementation((path: string) =>
      path.startsWith("/analysis/recommendations") ? Promise.resolve([rec()]) : Promise.reject(new Error("unexpected")),
    );
    renderFresh(<TodayPage />);

    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
  });

  it("shows a calm empty state with no pending recommendations", async () => {
    apiFetch.mockResolvedValue([]);
    renderFresh(<TodayPage />);

    await waitFor(() => expect(screen.getByText(/no recommendations right now/i)).toBeInTheDocument());
  });

  it("shows an inline error when the list fails to load", async () => {
    apiFetch.mockRejectedValue(new Error("boom"));
    renderFresh(<TodayPage />);

    await waitFor(() => expect(screen.getByText(/could not load/i)).toBeInTheDocument());
  });

  it("approving a card removes it from the list (no inline confirmation on Today)", async () => {
    let listCall = 0;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/analysis/recommendations?status=PENDING") {
        listCall += 1;
        return Promise.resolve(listCall === 1 ? [rec()] : []);
      }
      if (path === "/analysis/recommendations/1/approve" && init?.method === "POST") {
        return Promise.resolve(rec({ status: "APPROVED" }));
      }
      return Promise.reject(new Error("unexpected " + path));
    });
    renderFresh(<TodayPage />);

    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(screen.getByText(/no recommendations right now/i)).toBeInTheDocument());
    expect(screen.queryByText(/decision recorded/i)).not.toBeInTheDocument();
  });

  it("runs analysis, polls while running, and refreshes the list on completion", async () => {
    vi.useFakeTimers();
    const running: JobStatus = { status: "RUNNING", total: 1, done: 0, results: [] };
    const done: JobStatus = { status: "DONE", total: 1, done: 1, results: [{ ticker: "AAPL", recommendation_id: 1 }] };
    let listCall = 0;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/analysis/recommendations?status=PENDING") {
        listCall += 1;
        return Promise.resolve(listCall === 1 ? [] : [rec()]);
      }
      if (path === "/analysis/run" && init?.method === "POST") {
        return Promise.resolve({ job_id: "job-1" });
      }
      if (path === "/analysis/run/job-1") {
        return Promise.resolve(running.status === "RUNNING" ? running : done);
      }
      return Promise.reject(new Error("unexpected " + path));
    });
    renderFresh(<TodayPage />);

    await waitFor(() => expect(screen.getByText(/no recommendations right now/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/analysis/run", expect.objectContaining({ method: "POST" })));

    running.status = "DONE";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
    vi.useRealTimers();
  });

  it("shows a distinct banner when the analysis job fails outright", async () => {
    vi.useFakeTimers();
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/analysis/recommendations?status=PENDING") return Promise.resolve([]);
      if (path === "/analysis/run" && init?.method === "POST") return Promise.resolve({ job_id: "job-1" });
      if (path === "/analysis/run/job-1") {
        return Promise.resolve({ status: "FAILED", total: 1, done: 0, results: [] });
      }
      return Promise.reject(new Error("unexpected " + path));
    });
    renderFresh(<TodayPage />);

    await waitFor(() => expect(screen.getByText(/no recommendations right now/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    await waitFor(() => expect(screen.getByText(/analysis failed/i)).toBeInTheDocument());
    vi.useRealTimers();
  });

  it("shows the backend's detail message when Run analysis hits the monthly cap", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === "/analysis/recommendations?status=PENDING") return Promise.resolve([]);
      if (path === "/analysis/run") {
        return Promise.reject(new FakeApiError(429, "Monthly limit reached (100 analysis runs this month)."));
      }
      return Promise.reject(new Error("unexpected " + path));
    });
    renderFresh(<TodayPage />);

    await waitFor(() => expect(screen.getByText(/no recommendations right now/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));

    await waitFor(() => expect(screen.getByText(/monthly limit reached/i)).toBeInTheDocument());
  });

  it("does not warn on unmount while a job is still polling", async () => {
    vi.useFakeTimers();
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/analysis/recommendations?status=PENDING") return Promise.resolve([]);
      if (path === "/analysis/run" && init?.method === "POST") return Promise.resolve({ job_id: "job-1" });
      if (path === "/analysis/run/job-1") {
        return Promise.resolve({ status: "RUNNING", total: 1, done: 0, results: [] });
      }
      return Promise.reject(new Error("unexpected " + path));
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderFresh(<TodayPage />);

    await waitFor(() => expect(screen.getByText(/no recommendations right now/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/analysis/run", expect.anything()));

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
    vi.useRealTimers();
  });
});
