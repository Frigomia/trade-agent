import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { DiscoveryRecommendation } from "@/lib/api/discovery-types";
import { testRec } from "./testData";

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
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args), ApiError: FakeApiError }));

import { DecidedPhoneBar, DecidedRail, WithdrawnPhoneBar, WithdrawnRail } from "./DecidedRail";

const SUMMARY = { holdings: [], watchlist: [], total_market_value: 0, total_cost_basis: 0, total_pl: 0, total_pl_pct: null, unpriced_count: 0 };

function decided(status: "APPROVED" | "REJECTED", over: Partial<DiscoveryRecommendation> = {}): DiscoveryRecommendation {
  return { ...testRec(), status, reviewed_at: "2026-10-21T09:00:00Z", price_at_recommendation: 176.4, current_price: 184.2, ...over };
}

const withdrawn = (over: Partial<DiscoveryRecommendation> = {}) =>
  decided("APPROVED", { status: "SUPERSEDED", reviewed_at: null, withdrawal: { kind: "not_compelling", reason: "No longer clears the bar.", as_of: "2026-11-08T06:00:00Z" }, ...over });

function wrap(ui: React.ReactElement) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockImplementation((path: string) => (path === "/portfolio/summary" ? Promise.resolve(SUMMARY) : Promise.reject(new Error("unexpected " + path))));
});

describe("DecidedRail", () => {
  it("approved rail offers Log the trade I placed, Change my decision and Ask AI", async () => {
    wrap(<DecidedRail rec={decided("APPROVED")} onChanged={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "Log the trade I placed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change my decision" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ask AI" })).toHaveAttribute("href", "/chat?idea=1");
    expect(screen.getByText("Recorded only. No order was placed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("dismissed rail offers Change my decision and Ask AI but no log button", async () => {
    wrap(<DecidedRail rec={decided("REJECTED")} onChanged={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Change my decision" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ask AI" })).toBeInTheDocument();
    expect(screen.getByText("Recorded only. Nothing was sent to a broker.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Log the trade I placed" })).toBeNull();
  });

  it("Change my decision on an approved idea opens the dismiss sheet", async () => {
    wrap(<DecidedRail rec={decided("APPROVED")} onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Change my decision" }));
    expect(await screen.findByRole("dialog", { name: "Dismiss this recommendation?" })).toBeInTheDocument();
  });

  it("Change my decision on a dismissed idea approves it", async () => {
    const updated = decided("APPROVED");
    apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      path === "/analysis/recommendations/1/approve" && init?.method === "POST" ? Promise.resolve(updated) : Promise.resolve(SUMMARY),
    );
    const onChanged = vi.fn();
    wrap(<DecidedRail rec={decided("REJECTED")} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole("button", { name: "Change my decision" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(updated));
  });

  it("the since line shows the price at recommendation and the move", () => {
    wrap(<DecidedRail rec={decided("REJECTED")} onChanged={vi.fn()} />);

    expect(screen.getByText("USD 184.20")).toBeInTheDocument(); // the live price, not the scan quote's label
    expect(screen.queryByText(/Scan quote/)).toBeNull();
    expect(screen.getByText(/^Recommended .*2026$/)).toBeInTheDocument();
    expect(screen.getByText("USD 176.40")).toBeInTheDocument();
    expect(screen.getByText("+4.4%")).toBeInTheDocument();
  });

  it("no since line when a price is missing", () => {
    for (const current_price of [null, 0]) {
      const { unmount } = wrap(<DecidedRail rec={decided("REJECTED", { current_price })} onChanged={vi.fn()} />);
      expect(screen.queryByText(/^Recommended /)).toBeNull();
      expect(screen.queryByText("USD 0.00")).toBeNull();
      expect(screen.getByText("USD 184.20")).toBeInTheDocument(); // the saved scan quote, dated
      expect(screen.getByText(/Scan quote/)).toBeInTheDocument();
      unmount();
    }
  });

  it("links the sources count to the Sources tab", () => {
    const onSeeSources = vi.fn();
    wrap(<DecidedRail rec={decided("REJECTED")} onChanged={vi.fn()} onSeeSources={onSeeSources} />);
    expect(screen.getByText("3 sources")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See sources" }));
    expect(onSeeSources).toHaveBeenCalled();
  });

  it("no control anywhere reads buy, sell, deposit or withdraw", async () => {
    wrap(
      <>
        <DecidedRail rec={decided("APPROVED")} onChanged={vi.fn()} />
        <DecidedRail rec={decided("REJECTED")} onChanged={vi.fn()} />
        <DecidedPhoneBar rec={decided("APPROVED")} onChanged={vi.fn()} />
        <DecidedPhoneBar rec={decided("REJECTED")} onChanged={vi.fn()} />
        <WithdrawnRail rec={withdrawn()} />
        <WithdrawnPhoneBar rec={withdrawn()} />
      </>,
    );

    await screen.findAllByRole("button", { name: "Log the trade I placed" });
    const controls = [...screen.getAllByRole("button"), ...screen.getAllByRole("link")];
    for (const control of controls) expect(control.textContent + (control.getAttribute("aria-label") ?? "")).not.toMatch(/\b(buy|sell|deposit|withdraw)\b/i);
  });
});

describe("WithdrawnRail", () => {
  it("withdrawn rail links to the company overview, shows Run a new analysis disabled with its explanation, makes no request when it is clicked, and has no decision buttons", () => {
    wrap(<WithdrawnRail rec={withdrawn()} onSeeSources={vi.fn()} />);

    expect(screen.getByRole("link", { name: "Company overview" })).toHaveAttribute("href", "/discover/company/HLDN");
    expect(screen.getByRole("button", { name: "See sources" })).toBeInTheDocument();
    const run = screen.getByRole("button", { name: "Run a new analysis" });
    expect(run).toHaveAttribute("aria-disabled", "true");
    expect(run).toHaveAccessibleDescription("Re-running a researched company is not available yet.");
    fireEvent.click(run);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Ask AI" })).toBeInTheDocument();
    for (const name of ["Approve", "Dismiss", "Change my decision", "Save to Discover"]) expect(screen.queryByRole("button", { name })).toBeNull();
  });
});
