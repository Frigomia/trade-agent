import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { RecommendationOut, JobStatus } from "@/lib/api/recommendation-types";

const apiFetch = vi.fn();
const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    detail: string;
    code?: string;
    constructor(status: number, detail: string, code?: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
      this.code = code;
    }
  }
  return { FakeApiError };
});
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: FakeApiError,
}));

// Each is tested on its own; here they would only add unrelated requests to the shared apiFetch mock.
vi.mock("@/components/portfolio/PortfolioTile", () => ({ PortfolioTile: () => "portfolio-tile" }));
vi.mock("@/lib/portfolio/useDailySnapshot", () => ({ useDailySnapshot: () => {} }));

import TodayPage from "./page";

function renderFresh(ui: React.ReactElement) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, focusThrottleInterval: 0 }}>{ui}</SWRConfig>);
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

const EMPTY_SUMMARY = { holdings: [], watchlist: [] };
const SUMMARY_WITH_HOLDING = { holdings: [{ ticker: "AAPL", shares: 2 }], watchlist: [] };

function mockApi({ recs = [], summary }: { recs?: RecommendationOut[]; summary: unknown }) {
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    if (path.startsWith("/analysis/recommendations")) return Promise.resolve(recs);
    if (path === "/portfolio/summary") return Promise.resolve(summary);
    if (path === "/analysis/run" && init?.method === "POST") return Promise.resolve({ job_id: "job-1" });
    return Promise.reject(new Error("unexpected " + path));
  });
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

  it("shows the portfolio tile", async () => {
    mockApi({ summary: SUMMARY_WITH_HOLDING });
    renderFresh(<TodayPage />);

    await waitFor(() => expect(screen.getByText("portfolio-tile")).toBeInTheDocument());
  });

  describe("empty states", () => {
    it("walks a new user through the first steps when there is no portfolio yet", async () => {
      mockApi({ summary: EMPTY_SUMMARY });
      renderFresh(<TodayPage />);

      expect(await screen.findByText(/get your first recommendation/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /open portfolio/i })).toHaveAttribute("href", "/portfolio");
      expect(screen.getByText(/nothing is bought or sold/i)).toBeInTheDocument();
      expect(screen.queryByText(/nothing to decide right now/i)).not.toBeInTheDocument();
    });

    it("runs the analysis from the second step", async () => {
      mockApi({ summary: EMPTY_SUMMARY });
      renderFresh(<TodayPage />);

      await screen.findByText(/get your first recommendation/i);
      fireEvent.click(screen.getByRole("button", { name: /run an analysis now/i }));

      await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/analysis/run", expect.objectContaining({ method: "POST" })));
    });

    it("shows the calm all-clear when there is a portfolio but nothing pending", async () => {
      mockApi({ summary: SUMMARY_WITH_HOLDING });
      renderFresh(<TodayPage />);

      expect(await screen.findByText(/nothing to decide right now/i)).toBeInTheDocument();
      expect(screen.queryByText(/get your first recommendation/i)).not.toBeInTheDocument();
    });

    it("counts a watchlist alone as a portfolio", async () => {
      mockApi({ summary: { ...EMPTY_SUMMARY, watchlist: [{ ticker: "AAPL" }] } });
      renderFresh(<TodayPage />);

      expect(await screen.findByText(/nothing to decide right now/i)).toBeInTheDocument();
      expect(screen.queryByText(/get your first recommendation/i)).not.toBeInTheDocument();
    });

    it("shows neither state while the portfolio is still loading", async () => {
      apiFetch.mockImplementation((path: string) =>
        path.startsWith("/analysis/recommendations") ? Promise.resolve([]) : new Promise(() => {}),
      );
      renderFresh(<TodayPage />);

      await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/portfolio/summary"));
      expect(screen.queryByText(/get your first recommendation/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/nothing to decide right now/i)).not.toBeInTheDocument();
    });

    it("shows no empty state when recommendations are waiting", async () => {
      mockApi({ recs: [rec()], summary: SUMMARY_WITH_HOLDING });
      renderFresh(<TodayPage />);

      await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
      expect(screen.queryByText(/nothing to decide right now/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/get your first recommendation/i)).not.toBeInTheDocument();
    });
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

    await waitFor(() => expect(screen.getByText(/nothing to decide right now/i)).toBeInTheDocument());
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

    await waitFor(() => expect(screen.getByText(/nothing to decide right now/i)).toBeInTheDocument());
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

    await waitFor(() => expect(screen.getByText(/nothing to decide right now/i)).toBeInTheDocument());
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

    await waitFor(() => expect(screen.getByText(/nothing to decide right now/i)).toBeInTheDocument());
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

    await waitFor(() => expect(screen.getByText(/nothing to decide right now/i)).toBeInTheDocument());
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

describe("TodayPage without a usable Claude key", () => {
  let keyStatus: unknown;
  let role: string;
  let runError: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    keyStatus = { connected: false, last4: null, needs_attention: false };
    role = "user";
    runError = null;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/me/claude-key") {
        return keyStatus instanceof Error ? Promise.reject(keyStatus) : Promise.resolve(keyStatus);
      }
      if (path === "/me") return Promise.resolve({ role });
      if (path.startsWith("/analysis/recommendations")) return Promise.resolve([]);
      if (path === "/portfolio/summary") return Promise.resolve(SUMMARY_WITH_HOLDING);
      if (path === "/analysis/run" && init?.method === "POST") {
        if (!runError) return Promise.resolve({ job_id: "job-1" });
        keyStatus = { connected: true, last4: "abcd", needs_attention: true };
        return Promise.reject(runError);
      }
      return Promise.reject(new Error("unexpected " + path));
    });
  });

  it("shows the reminder and disables Run analysis with the explanation", async () => {
    renderFresh(<TodayPage />);

    expect(await screen.findByText("Connect Claude to start analyzing")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up" })).toHaveAttribute("href", "/more/connect-claude");
    expect(screen.getByText(/connect claude to run an analysis\. everything else works without it/i)).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: /run (an |a fresh )?analysis/i })) {
      expect(button).toBeDisabled();
    }
  });

  it("asks to reconnect when the key is flagged", async () => {
    keyStatus = { connected: true, last4: "abcd", needs_attention: true };
    renderFresh(<TodayPage />);

    expect(await screen.findByText("Your Claude key needs attention")).toBeInTheDocument();
    expect(screen.getByText(/reconnect claude to run an analysis/i)).toBeInTheDocument();
  });

  it("shows nothing extra with a connected key", async () => {
    keyStatus = { connected: true, last4: "abcd", needs_attention: false };
    renderFresh(<TodayPage />);

    await screen.findByText(/nothing to decide right now/i);
    expect(screen.queryByText("Connect Claude to start analyzing")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^run analysis$/i })).toBeEnabled();
  });

  it("never locks an admin with no personal key", async () => {
    role = "admin";
    renderFresh(<TodayPage />);

    await screen.findByText(/nothing to decide right now/i);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/me"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(screen.queryByText("Connect Claude to start analyzing")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^run analysis$/i })).toBeEnabled();
  });

  it("does not lock the user out when the status request fails", async () => {
    keyStatus = new Error("boom");
    renderFresh(<TodayPage />);

    await screen.findByText(/nothing to decide right now/i);
    expect(screen.queryByText("Connect Claude to start analyzing")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^run analysis$/i })).toBeEnabled();
  });

  it("turns into the reconnect variant on a 409 claude_key_required, with no generic error", async () => {
    keyStatus = { connected: true, last4: "abcd", needs_attention: false };
    runError = new FakeApiError(409, "Connect Claude to use this.", "claude_key_required");
    renderFresh(<TodayPage />);

    await screen.findByText(/nothing to decide right now/i);
    fireEvent.click(screen.getByRole("button", { name: /^run analysis$/i }));

    expect(await screen.findByText("Your Claude key needs attention")).toBeInTheDocument();
    expect(screen.queryByText("Connect Claude to use this.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("locks an admin whose own key is flagged", async () => {
    role = "admin";
    keyStatus = { connected: true, last4: "abcd", needs_attention: true };
    renderFresh(<TodayPage />);

    expect(await screen.findByText("Your Claude key needs attention")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^run analysis$/i })).toBeDisabled();
  });

  it("shows no card while the status request is still pending", async () => {
    keyStatus = undefined;
    apiFetch.mockImplementation((path: string) => {
      if (path === "/me/claude-key") return new Promise(() => {});
      if (path.startsWith("/analysis/recommendations")) return Promise.resolve([]);
      if (path === "/portfolio/summary") return Promise.resolve(SUMMARY_WITH_HOLDING);
      return Promise.reject(new Error("unexpected " + path));
    });
    renderFresh(<TodayPage />);

    await screen.findByText(/nothing to decide right now/i);
    expect(screen.queryByText(/connect claude to/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Your Claude key needs attention")).not.toBeInTheDocument();
  });

  it("unlocks after a 409 once a refetch finds the key usable again", async () => {
    keyStatus = { connected: true, last4: "abcd", needs_attention: false };
    runError = new FakeApiError(409, "Connect Claude to use this.", "claude_key_required");
    renderFresh(<TodayPage />);

    await screen.findByText(/nothing to decide right now/i);
    fireEvent.click(screen.getByRole("button", { name: /^run analysis$/i }));
    await screen.findByText("Your Claude key needs attention");

    keyStatus = { connected: true, last4: "wxyz", needs_attention: false };
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(screen.queryByText("Your Claude key needs attention")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^run analysis$/i })).toBeEnabled();
  });
});
