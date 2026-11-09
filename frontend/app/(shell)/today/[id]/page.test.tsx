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
const replace = vi.fn();
let routeId = "1";
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useParams: () => ({ id: routeId }),
  useSearchParams: () => search,
}));

vi.mock("@/components/portfolio/LogTradeCta", () => ({ LogTradeCta: () => null }));

import RecommendationDetailPage from "./page";
import { testIdea } from "@/components/workbench/testData";

// A discovery idea: the saved research, so the page opens as the company page.
const idea = (overrides: Partial<RecommendationOut> = {}) =>
  rec({ source: "discovery", idea: testIdea(), action: "BUY", ticker: "HLDN", ...overrides });

/** Serves one recommendation by id (and a decision on it); the price history is not needed here. */
function serve(byId: Record<string, RecommendationOut>, decisions: Record<string, RecommendationOut> = {}) {
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const id = path.match(/^\/analysis\/recommendations\/(\d+)$/)?.[1];
    if (id && byId[id]) return Promise.resolve(byId[id]);
    if (init?.method === "POST" && decisions[path]) return Promise.resolve(decisions[path]);
    return Promise.reject(new Error("unexpected " + path));
  });
}

// A discovery idea as GET returns it: with the live quote the page shows.
const live = (overrides: Partial<RecommendationOut> = {}) => idea({ current_price: 135.2, price_change_pct: 0.5, ...overrides });

// What approve and reject really return: the bare record, with no live quote and no name.
const bare = (overrides: Partial<RecommendationOut> = {}) => idea({ current_price: null, price_change_pct: null, name: null, ...overrides });

function expectLiveQuoteAndMoveKept() {
  expect(screen.getByText("USD 135.20")).toBeInTheDocument();
  expect(screen.getByText("since")).toBeInTheDocument(); // 135.2 against 121.6 recommended
}

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
    search = new URLSearchParams();
  });

  it("opens a discovery idea as the company page, with the full bear case and the decision rail, not the web opinion box", async () => {
    apiFetch.mockImplementation((path: string) =>
      path.startsWith("/discovery/ideas/")
        ? Promise.reject(new Error("no history in this test"))
        : Promise.resolve(rec({ source: "discovery", idea: testIdea(), ai_analysis: "Recurring revenue and widening margins." } as unknown as Partial<RecommendationOut>)),
    );
    renderFresh(<RecommendationDetailPage />);

    expect(await screen.findByRole("heading", { level: 1, name: "Halden Systems" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bear case" }).closest("section")).toHaveTextContent("The final sentence of the risk.");
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.queryByText(/web second opinion/i)).not.toBeInTheDocument();
  });

  it("never calls the API for a non-numeric id", () => {
    routeId = "..%2F..%2Fadmin%2Fusers";
    renderFresh(<RecommendationDetailPage />);

    expect(screen.getByText("Recommendation not found.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("shows the structured evidence and web opinion, without repeating the raw reasoning", async () => {
    apiFetch.mockResolvedValue(rec());
    renderFresh(<RecommendationDetailPage />);

    await waitFor(() => expect(screen.getByText("NVDA")).toBeInTheDocument());
    expect(screen.getByText("52/100")).toBeInTheDocument();
    expect(screen.getByText("Neutral")).toBeInTheDocument();
    expect(screen.queryByText("Technical signal: NEUTRAL")).not.toBeInTheDocument();
    expect(screen.getByText(/not part of the score/i)).toBeInTheDocument();
    expect(screen.getByText(/conflicts with the fundamentals reading/i)).toBeInTheDocument();
  });

  it("shows the Automatic tag in the header for a scheduled recommendation only", async () => {
    apiFetch.mockResolvedValue(rec({ source: "scheduled" }));
    const { unmount } = renderFresh(<RecommendationDetailPage />);
    await waitFor(() => expect(screen.getByText("Automatic")).toBeInTheDocument());
    expect(screen.getByText("NVDA").parentElement).toHaveStyle({ flexWrap: "wrap" });
    unmount();

    apiFetch.mockResolvedValue(rec({ source: "manual" }));
    renderFresh(<RecommendationDetailPage />);
    await waitFor(() => expect(screen.getByText("NVDA")).toBeInTheDocument());
    expect(screen.queryByText("Automatic")).not.toBeInTheDocument();
  });

  it("says a newer analysis replaced a superseded recommendation, with no approve/dismiss", async () => {
    apiFetch.mockResolvedValue(rec({ status: "SUPERSEDED" }));
    renderFresh(<RecommendationDetailPage />);

    await waitFor(() => expect(screen.getByText(/newer analysis replaced/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/decision recorded/i)).not.toBeInTheDocument();
  });

  it("redirects a superseded idea to its successor with from=superseded", async () => {
    serve({ "1": idea({ status: "SUPERSEDED", successor_id: 7 }) });
    renderFresh(<RecommendationDetailPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/today/7?from=superseded"));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/newer analysis replaced/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("a successor that is already decided shows the decided strip and never says waiting", async () => {
    routeId = "7";
    search = new URLSearchParams("from=superseded");
    serve({ "7": idea({ id: 7, status: "APPROVED", reviewed_at: "2026-10-21T09:00:00Z" }) });
    renderFresh(<RecommendationDetailPage />);

    expect(await screen.findByText(/You approved this idea/)).toBeInTheDocument();
    expect(screen.queryByText(/waiting/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Newer analysis/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Discover" })).toHaveAttribute("href", "/discover");
  });

  it("a superseded idea with a withdrawal shows the withdrawn view and never says replaced", async () => {
    serve({ "1": idea({ status: "SUPERSEDED", successor_id: null, withdrawal: { kind: "invalidated", reason: "The thesis broke.", as_of: null } }) });
    renderFresh(<RecommendationDetailPage />);

    expect(await screen.findByText("This idea was withdrawn.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("The thesis broke.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Halden Systems" })).toBeInTheDocument();
    expect(screen.queryByText(/newer analysis replaced/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Company overview" })[0]).toHaveAttribute("href", "/discover/company/HLDN");
    expect(screen.getByRole("link", { name: "Back to Discover" })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("a superseded idea with no idea payload keeps the old alert", async () => {
    serve({ "1": rec({ source: "discovery", idea: null, status: "SUPERSEDED", successor_id: null, withdrawal: null }) });
    renderFresh(<RecommendationDetailPage />);

    expect(await screen.findByText(/newer analysis replaced this recommendation for NVDA/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Today" })).toBeInTheDocument();
  });

  it("a decided discovery idea opened later shows the strip and the research, not Decision recorded", async () => {
    serve({ "1": idea({ status: "REJECTED", reviewed_at: "2026-10-22T09:00:00Z", dismissal_reason: "Too expensive." }) });
    renderFresh(<RecommendationDetailPage />);

    expect(await screen.findByText(/You dismissed this idea/)).toBeInTheDocument();
    expect(screen.getByText("Too expensive.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Halden Systems" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Company sections" })).toBeInTheDocument();
    expect(screen.queryByText(/decision recorded/i)).not.toBeInTheDocument();
  });

  it("deciding in this visit shows Decision recorded once, and View the company page then shows the decided view", async () => {
    serve({ "1": live() }, { "/analysis/recommendations/1/approve": bare({ status: "APPROVED", reviewed_at: "2026-10-21T09:00:00Z" }) });
    renderFresh(<RecommendationDetailPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByText(/decision recorded/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View the company page" }));

    expect(await screen.findByText(/You approved this idea/)).toBeInTheDocument();
    expect(screen.queryByText(/decision recorded/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Halden Systems" })).toBeInTheDocument();
    expectLiveQuoteAndMoveKept(); // the bare answer did not wipe the quote the page loaded
  });

  it("a decided recommendation without an idea still shows the confirmation", async () => {
    serve({ "1": rec({ status: "REJECTED" }) });
    renderFresh(<RecommendationDetailPage />);

    expect(await screen.findByText(/decision recorded/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View the company page" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Today" })).toBeInTheDocument();
  });

  it("a successor id that is not a plain integer keeps the old alert instead of a blank page", async () => {
    for (const successor_id of [-1, 0]) {
      serve({ "1": idea({ status: "SUPERSEDED", successor_id }) });
      const { unmount } = renderFresh(<RecommendationDetailPage />);
      expect(await screen.findByText(/newer analysis replaced this recommendation/i)).toBeInTheDocument();
      expect(replace).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("a decision in this visit does not follow the page to another idea", async () => {
    serve(
      { "1": idea(), "2": idea({ id: 2, status: "APPROVED", reviewed_at: "2026-10-21T09:00:00Z" }) },
      { "/analysis/recommendations/1/approve": idea({ status: "APPROVED", reviewed_at: "2026-10-21T09:00:00Z" }) },
    );
    const { rerender } = renderFresh(<RecommendationDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByText(/decision recorded/i)).toBeInTheDocument();

    routeId = "2";
    rerender(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><RecommendationDetailPage /></SWRConfig>);
    expect(await screen.findByText(/You approved this idea/)).toBeInTheDocument();
    expect(screen.queryByText(/decision recorded/i)).not.toBeInTheDocument();
  });

  it("changing an approved idea to dismissed on the reopened page shows the Dismissed strip", async () => {
    serve(
      { "1": live({ status: "APPROVED", reviewed_at: "2026-10-21T09:00:00Z" }) },
      { "/analysis/recommendations/1/reject": bare({ status: "REJECTED", reviewed_at: "2026-10-22T09:00:00Z" }) },
    );
    renderFresh(<RecommendationDetailPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Change my decision" }));
    fireEvent.click(await screen.findByRole("button", { name: "Skip reason and dismiss" }));
    expect(await screen.findByText(/You dismissed this idea/)).toBeInTheDocument();
    expect(screen.queryByText(/decision recorded/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Halden Systems" })).toBeInTheDocument();
    expectLiveQuoteAndMoveKept();
  });

  it("changing a dismissed idea to approved on the reopened page shows the Approved strip", async () => {
    serve(
      { "1": live({ status: "REJECTED", reviewed_at: "2026-10-22T09:00:00Z", dismissal_reason: "Too expensive." }) },
      { "/analysis/recommendations/1/approve": bare({ status: "APPROVED", reviewed_at: "2026-10-23T09:00:00Z" }) },
    );
    renderFresh(<RecommendationDetailPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Change my decision" }));
    expect(await screen.findByText(/You approved this idea/)).toBeInTheDocument();
    expect(screen.queryByText(/decision recorded/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Too expensive.")).not.toBeInTheDocument(); // the old reason went with the old decision
    expectLiveQuoteAndMoveKept();
  });

  it("from=superseded on a pending idea shows the newer strip", async () => {
    search = new URLSearchParams("from=superseded");
    serve({ "1": idea() });
    renderFresh(<RecommendationDetailPage />);

    expect(await screen.findByText("Newer analysis")).toBeInTheDocument();
    expect(screen.getByText(/still waiting for your decision/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Discover" })).toBeInTheDocument();
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
    const skip = screen.getByRole("button", { name: /skip reason and dismiss/i });
    fireEvent.click(skip);
    fireEvent.click(skip);

    resolve(rec({ status: "REJECTED" }));
    await waitFor(() =>
      expect(apiFetch.mock.calls.filter((c) => c[0] === "/analysis/recommendations/1/reject")).toHaveLength(1),
    );
  });
});
