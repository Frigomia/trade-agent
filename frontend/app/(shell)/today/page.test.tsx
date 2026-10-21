import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

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
const SUMMARY_WITH_HOLDING = { holdings: [{ ticker: "AAPL", shares: 3 }], watchlist: [] };
const USAGE = { analysis_runs: { used: 3, limit: 100 }, chat_messages: { used: 0, limit: 100 } };
const NO_IDEAS = { recommendations: [], latest_scan: null };

interface Api {
  recs?: RecommendationOut[] | Error;
  summary?: unknown;
  ideas?: unknown;
  alerts?: unknown;
  run?: (init?: RequestInit) => Promise<unknown>;
  extra?: (path: string, init?: RequestInit) => Promise<unknown> | undefined;
}

// One router for every path Today asks for; a test overrides only what it is about.
function mockApi({ recs = [], summary = SUMMARY_WITH_HOLDING, ideas = NO_IDEAS, alerts, run, extra }: Api = {}) {
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const handled = extra?.(path, init);
    if (handled) return handled;
    if (path.startsWith("/analysis/recommendations")) return recs instanceof Error ? Promise.reject(recs) : Promise.resolve(recs);
    if (path === "/portfolio/summary") return Promise.resolve(summary);
    if (path === "/discovery/ideas") return Promise.resolve(ideas);
    if (path === "/portfolio/alerts") return alerts ? Promise.resolve(alerts) : Promise.reject(new FakeApiError(404, "Not found"));
    if (path === "/me/usage") return Promise.resolve(USAGE);
    if (path === "/discovery/run" && init?.method === "POST") return run ? run(init) : Promise.resolve({ job_id: "job-1" });
    if (path.startsWith("/discovery/run/")) return new Promise(() => {}); // a scan that never ends
    return Promise.reject(new Error("unexpected " + path));
  });
}

const scanButton = () => screen.getByRole("button", { name: /refresh scan|run scan|try the scan again|running/i });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("TodayPage", () => {
  it("shows the page title and its one-line subtitle, and no separate Run analysis button", async () => {
    mockApi();
    renderFresh(<TodayPage />);

    expect(await screen.findByRole("heading", { level: 1, name: "Today" })).toBeInTheDocument();
    expect(screen.getByText(/your latest research ideas and what needs attention on your holdings/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run analysis/i })).not.toBeInTheDocument();
  });

  it("lists pending holdings recommendations under Portfolio alerts", async () => {
    mockApi({ recs: [rec()] });
    renderFresh(<TodayPage />);

    expect(await screen.findByText("AAPL")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Portfolio alerts" })).toBeInTheDocument();
  });

  it("keeps discovery ideas out of the holdings alerts and shows the discovery section", async () => {
    mockApi({ recs: [rec(), rec({ id: 9, ticker: "HLDN", source: "discovery" })] });
    renderFresh(<TodayPage />);

    expect(await screen.findByText("AAPL")).toBeInTheDocument();
    expect(screen.queryByText("HLDN")).not.toBeInTheDocument();
    expect(screen.getByText("Run your first scan")).toBeInTheDocument();
  });

  it("has no portfolio, cost-basis or awaiting-you cards: they are not part of the new Today", async () => {
    mockApi({ recs: [rec()] });
    renderFresh(<TodayPage />);

    await screen.findByText("AAPL");
    expect(screen.queryByText("Awaiting you")).not.toBeInTheDocument();
    expect(screen.queryByText("Vs cost basis")).not.toBeInTheDocument();
    expect(screen.queryByText("Portfolio")).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith("/portfolio/snapshots");
  });

  it("shows the typed alerts for earnings and moves above the pending-call cards, on a phone", async () => {
    mockApi({
      recs: [rec()],
      alerts: {
        alerts: [
          { ticker: "AAPL", name: "Apple Inc.", kind: "new_recommendation", text: "New AI recommendation: BUY", when: null, direction: null, recommendation_id: 1 },
          { ticker: "AURL", name: "Aurelle Foods", kind: "earnings_upcoming", text: "Earnings tomorrow", when: "2026-10-22", direction: null, recommendation_id: null },
        ],
        missing: [],
      },
    });
    renderFresh(<TodayPage />);

    const panel = await screen.findByRole("region", { name: "Portfolio alerts" });
    expect(panel).toHaveTextContent("Aurelle Foods");
    expect(panel).toHaveTextContent("Earnings tomorrow");
    expect(panel).not.toHaveTextContent("New AI recommendation"); // the call is a decision card below, not repeated here
    expect(screen.getByRole("heading", { name: "New recommendations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument();
  });

  it("keeps working, with the calls alone, when the alerts endpoint is not there", async () => {
    mockApi({ recs: [rec()] }); // /portfolio/alerts answers 404

    renderFresh(<TodayPage />);

    expect(await screen.findByText("AAPL")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Portfolio alerts" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Portfolio alerts" })).not.toBeInTheDocument();
  });

  it("shows an inline error when the list fails to load", async () => {
    mockApi({ recs: new Error("boom") });
    renderFresh(<TodayPage />);

    expect(await screen.findByText("Could not load recommendations.")).toBeInTheDocument();
  });

  it("approving a card removes it from the list (no inline confirmation on Today)", async () => {
    let listCall = 0;
    mockApi({
      extra: (path, init) => {
        if (path === "/analysis/recommendations?status=PENDING") {
          listCall += 1;
          return Promise.resolve(listCall === 1 ? [rec()] : []);
        }
        if (path === "/analysis/recommendations/1/approve" && init?.method === "POST") return Promise.resolve(rec({ status: "APPROVED" }));
        return undefined;
      },
    });
    renderFresh(<TodayPage />);

    await screen.findByText("AAPL");
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(screen.getByText(/nothing to decide right now/i)).toBeInTheDocument());
    expect(screen.queryByText(/decision recorded/i)).not.toBeInTheDocument();
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

    it("points the first-run user at the scan bar instead of adding a second scan button", async () => {
      mockApi({ summary: EMPTY_SUMMARY });
      renderFresh(<TodayPage />);

      await screen.findByText(/get your first recommendation/i);
      expect(screen.getByText(/use refresh in the scan bar above/i)).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /refresh scan|run scan/i })).toHaveLength(1);
    });

    it("shows the calm all-clear, pointing at the daily analysis, when there is a portfolio but nothing pending", async () => {
      mockApi();
      renderFresh(<TodayPage />);

      expect(await screen.findByText(/nothing to decide right now/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /open preferences/i })).toHaveAttribute("href", "/more/preferences");
      expect(screen.queryByText(/get your first recommendation/i)).not.toBeInTheDocument();
    });

    it("counts a watchlist alone as a portfolio", async () => {
      mockApi({ summary: { ...EMPTY_SUMMARY, watchlist: [{ ticker: "AAPL" }] } });
      renderFresh(<TodayPage />);

      expect(await screen.findByText(/nothing to decide right now/i)).toBeInTheDocument();
      expect(screen.queryByText(/get your first recommendation/i)).not.toBeInTheDocument();
    });

    it("shows neither state while the portfolio is still loading", async () => {
      mockApi({ extra: (path) => (path === "/portfolio/summary" ? new Promise(() => {}) : undefined) });
      renderFresh(<TodayPage />);

      await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/portfolio/summary"));
      expect(screen.queryByText(/get your first recommendation/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/nothing to decide right now/i)).not.toBeInTheDocument();
    });

    it("shows no empty state when recommendations are waiting", async () => {
      mockApi({ recs: [rec()] });
      renderFresh(<TodayPage />);

      await screen.findByText("AAPL");
      expect(screen.queryByText(/nothing to decide right now/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/get your first recommendation/i)).not.toBeInTheDocument();
    });
  });

  describe("the one scan button", () => {
    it("starts a discovery scan with the refresh button", async () => {
      mockApi();
      renderFresh(<TodayPage />);

      await screen.findByText(/nothing to decide right now/i);
      await waitFor(() => expect(scanButton()).toBeEnabled());
      fireEvent.click(scanButton());

      await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/discovery/run", expect.objectContaining({ method: "POST" })));
      expect(await screen.findByText("Scanning the market")).toBeInTheDocument();
    });

    it("shows that a scan failed while keeping the page usable", async () => {
      mockApi({
        extra: (path) =>
          path === "/discovery/run/job-1"
            ? Promise.resolve({ status: "FAILED", stage: "failed", total: 0, done: 0, error: "Scan interrupted. Please try again." })
            : undefined,
      });
      renderFresh(<TodayPage />);

      await screen.findByText(/nothing to decide right now/i);
      await waitFor(() => expect(scanButton()).toBeEnabled());
      fireEvent.click(scanButton());

      expect(await screen.findByText("The scan did not finish")).toBeInTheDocument();
      expect(screen.getByText(/nothing to decide right now/i)).toBeInTheDocument();
    });

    it("shows the backend's detail message when the scan hits the monthly cap", async () => {
      mockApi({ run: () => Promise.reject(new FakeApiError(429, "Monthly limit reached (100 analysis runs this month).")) });
      renderFresh(<TodayPage />);

      await screen.findByText(/nothing to decide right now/i);
      await waitFor(() => expect(scanButton()).toBeEnabled());
      fireEvent.click(scanButton());

      expect(await screen.findByText(/monthly limit reached/i)).toBeInTheDocument();
    });
  });
});

describe("TodayPage without a usable Claude key", () => {
  let keyStatus: unknown;
  let role: string;
  let runError: unknown;

  beforeEach(() => {
    keyStatus = { connected: false, last4: null, needs_attention: false };
    role = "user";
    runError = null;
    mockApi({
      extra: (path) => {
        if (path === "/me/claude-key") return keyStatus instanceof Error ? Promise.reject(keyStatus) : Promise.resolve(keyStatus);
        if (path === "/me") return Promise.resolve({ role });
        return undefined;
      },
      run: () => {
        if (!runError) return Promise.resolve({ job_id: "job-1" });
        keyStatus = { connected: true, last4: "abcd", needs_attention: true };
        return Promise.reject(runError);
      },
    });
  });

  it("shows the reminder and disables the scan button with the explanation", async () => {
    renderFresh(<TodayPage />);

    expect(await screen.findByText("Connect Claude to start analyzing")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up" })).toHaveAttribute("href", "/more/connect-claude");
    expect(screen.getByText(/connect claude to run a scan\. everything else works without it/i)).toBeInTheDocument();
    expect(scanButton()).toBeDisabled();
  });

  it("asks to reconnect when the key is flagged", async () => {
    keyStatus = { connected: true, last4: "abcd", needs_attention: true };
    renderFresh(<TodayPage />);

    expect(await screen.findByText("Your Claude key needs attention")).toBeInTheDocument();
    expect(screen.getByText(/reconnect claude to run a scan/i)).toBeInTheDocument();
  });

  it("shows nothing extra with a connected key", async () => {
    keyStatus = { connected: true, last4: "abcd", needs_attention: false };
    renderFresh(<TodayPage />);

    await screen.findByText(/nothing to decide right now/i);
    expect(screen.queryByText("Connect Claude to start analyzing")).not.toBeInTheDocument();
    await waitFor(() => expect(scanButton()).toBeEnabled());
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
    expect(scanButton()).toBeEnabled();
  });

  it("does not lock the user out when the status request fails", async () => {
    keyStatus = new Error("boom");
    renderFresh(<TodayPage />);

    await screen.findByText(/nothing to decide right now/i);
    expect(screen.queryByText("Connect Claude to start analyzing")).not.toBeInTheDocument();
    await waitFor(() => expect(scanButton()).toBeEnabled());
  });

  it("turns into the reconnect variant on a 409 claude_key_required, with no generic error", async () => {
    keyStatus = { connected: true, last4: "abcd", needs_attention: false };
    runError = new FakeApiError(409, "Connect Claude to use this.", "claude_key_required");
    renderFresh(<TodayPage />);

    await screen.findByText(/nothing to decide right now/i);
    await waitFor(() => expect(scanButton()).toBeEnabled());
    fireEvent.click(scanButton());

    expect(await screen.findByText("Your Claude key needs attention")).toBeInTheDocument();
    expect(screen.queryByText("Connect Claude to use this.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("locks an admin whose own key is flagged", async () => {
    role = "admin";
    keyStatus = { connected: true, last4: "abcd", needs_attention: true };
    renderFresh(<TodayPage />);

    expect(await screen.findByText("Your Claude key needs attention")).toBeInTheDocument();
    expect(scanButton()).toBeDisabled();
  });

  it("shows no card while the status request is still pending", async () => {
    mockApi({ extra: (path) => (path === "/me/claude-key" ? new Promise(() => {}) : undefined) });
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
    await waitFor(() => expect(scanButton()).toBeEnabled());
    fireEvent.click(scanButton());
    await screen.findByText("Your Claude key needs attention");

    keyStatus = { connected: true, last4: "wxyz", needs_attention: false };
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(screen.queryByText("Your Claude key needs attention")).not.toBeInTheDocument());
    await waitFor(() => expect(scanButton()).toBeEnabled());
  });
});
