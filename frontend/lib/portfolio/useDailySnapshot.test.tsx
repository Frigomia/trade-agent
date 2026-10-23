// frontend/lib/portfolio/useDailySnapshot.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig, useSWRConfig } from "swr";
import type { ReactNode } from "react";
import type { PortfolioSummary, Snapshot } from "@/lib/api/portfolio-types";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { useDailySnapshot, resetDailySnapshotGuard, snapshotNote } from "./useDailySnapshot";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
  );
}

function summary(overrides: Partial<PortfolioSummary> = {}): PortfolioSummary {
  return {
    holdings: [
      {
        ticker: "AAPL",
        name: "Apple",
        asset_type: "STOCK",
        shares: 10,
        cost_basis: 150,
        first_purchase_date: "2024-01-01",
        sector: null,
        target_weight: null,
        current_price: 200,
        market_value: 2000,
        unrealized_pl: 500,
        unrealized_pl_pct: 33,
        weight: 1,
      },
    ],
    watchlist: [],
    total_market_value: 2000,
    total_cost_basis: 1500,
    total_pl: 500,
    total_pl_pct: 33,
    unpriced_count: 0,
    ...overrides,
  };
}

function snapshot(created_at: string): Snapshot {
  return { id: 1, created_at, total_market_value: 1, total_cost_basis: 1 };
}

function serve(sum: PortfolioSummary, snaps: Snapshot[]) {
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/portfolio/summary") return Promise.resolve(sum);
    if (path === "/portfolio/snapshots") return Promise.resolve(snaps);
    if (path === "/portfolio/snapshot" && init?.method === "POST") return Promise.resolve({});
    return Promise.reject(new Error("unexpected " + path));
  });
}

function posts(): unknown[][] {
  return apiFetch.mock.calls.filter((c) => c[0] === "/portfolio/snapshot");
}

// For "does nothing" assertions: wait until both reads happened, then give the hook's effect a
// real moment to (not) act, so the assertion can't pass just because it ran too early. Only Date is
// faked in these tests, so this timeout is real.
async function settled() {
  await waitFor(() => {
    expect(apiFetch.mock.calls.some((c) => c[0] === "/portfolio/summary")).toBe(true);
    expect(apiFetch.mock.calls.some((c) => c[0] === "/portfolio/snapshots")).toBe(true);
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("useDailySnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDailySnapshotGuard();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records a snapshot when the latest one is from a previous day", async () => {
    serve(summary(), [snapshot("2026-09-29T09:00:00")]);
    renderHook(() => useDailySnapshot(), { wrapper });

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][1]).toEqual(expect.objectContaining({ method: "POST" }));
  });

  it("records one when there are no snapshots yet", async () => {
    serve(summary(), []);
    renderHook(() => useDailySnapshot(), { wrapper });

    await waitFor(() => expect(posts()).toHaveLength(1));
  });

  it("does nothing when a snapshot from today already exists", async () => {
    serve(summary(), [snapshot("2026-09-30T08:00:00")]);
    renderHook(() => useDailySnapshot(), { wrapper });

    await settled();
    expect(posts()).toHaveLength(0);
  });

  it("never records a partial total when a holding is unpriced", async () => {
    serve(summary({ unpriced_count: 1 }), [snapshot("2026-09-29T09:00:00")]);
    renderHook(() => useDailySnapshot(), { wrapper });

    await settled();
    expect(posts()).toHaveLength(0);
  });

  it("does nothing with no open positions", async () => {
    serve(summary({ holdings: [] }), []);
    renderHook(() => useDailySnapshot(), { wrapper });

    await settled();
    expect(posts()).toHaveLength(0);
  });

  it("does not try again when Today and Portfolio each mount the hook the same day", async () => {
    serve(summary(), [snapshot("2026-09-29T09:00:00")]);
    const first = renderHook(() => useDailySnapshot(), { wrapper });
    await waitFor(() => expect(posts()).toHaveLength(1));
    first.unmount();

    // The mocked snapshot list is still "stale", so only the once-per-day guard can stop a second POST.
    renderHook(() => useDailySnapshot(), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(posts()).toHaveLength(1);
  });

  it("swallows a failed snapshot request", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === "/portfolio/summary") return Promise.resolve(summary());
      if (path === "/portfolio/snapshots") return Promise.resolve([]);
      return Promise.reject(new Error("No current price available for AAPL"));
    });
    renderHook(() => useDailySnapshot(), { wrapper });

    await waitFor(() => expect(posts()).toHaveLength(1));
    // No unhandled rejection: the test finishing without error is the assertion.
  });

  const failingPost = (sum: PortfolioSummary, snaps: Snapshot[]) =>
    apiFetch.mockImplementation((path: string) => {
      if (path === "/portfolio/summary") return Promise.resolve(sum);
      if (path === "/portfolio/snapshots") return Promise.resolve(snaps);
      return Promise.reject(new Error("boom"));
    });

  it("tries a failed save again on the next visit the same day, but not within the same visit", async () => {
    failingPost(summary(), [snapshot("2026-09-29T09:00:00")]);
    const first = renderHook(() => ({ daily: useDailySnapshot(), swr: useSWRConfig() }), { wrapper });
    await waitFor(() => expect(posts()).toHaveLength(1));
    await waitFor(() => expect(first.result.current.daily.note).toMatch(/could not be saved/i));
    // A fresh read that returns changed data (a focus revalidation, say) re-runs the hook; it must not post again.
    failingPost(summary(), [snapshot("2026-09-29T09:00:00"), { ...snapshot("2026-09-29T10:00:00"), id: 2 }]);
    await act(() => first.result.current.swr.mutate("/portfolio/snapshots"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(posts()).toHaveLength(1); // the same visit does not hammer a failing server
    first.unmount();

    renderHook(() => useDailySnapshot(), { wrapper });
    await waitFor(() => expect(posts()).toHaveLength(2));
  });

  it("tells the page that is open when a save fails after the person moved on from the page that started it", async () => {
    let fail: (reason: Error) => void = () => {};
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/portfolio/summary") return Promise.resolve(summary());
      if (path === "/portfolio/snapshots") return Promise.resolve([snapshot("2026-09-29T09:00:00")]);
      if (init?.method === "POST") return new Promise((_, reject) => (fail = reject));
      return Promise.reject(new Error("unexpected " + path));
    });
    const today = renderHook(() => useDailySnapshot(), { wrapper });
    await waitFor(() => expect(posts()).toHaveLength(1));
    today.unmount();

    const portfolio = renderHook(() => useDailySnapshot(), { wrapper });
    await settled();
    expect(posts()).toHaveLength(1); // the first save is still running, so this page does not start another
    expect(portfolio.result.current.note).toBeNull();

    await act(async () => fail(new Error("boom")));
    await waitFor(() => expect(portfolio.result.current.note).toMatch(/could not be saved/i));
  });

  it("says the save failed after a failed attempt, and stops saying it once a retry works", async () => {
    failingPost(summary(), [snapshot("2026-09-29T09:00:00")]);
    const first = renderHook(() => useDailySnapshot(), { wrapper });
    await waitFor(() => expect(first.result.current.note).toMatch(/could not be saved/i));
    first.unmount();

    serve(summary(), [snapshot("2026-09-29T09:00:00")]);
    const second = renderHook(() => useDailySnapshot(), { wrapper });
    await waitFor(() => expect(posts()).toHaveLength(2));
    await waitFor(() => expect(second.result.current.note).toBeNull());
  });
});

describe("snapshotNote", () => {
  const TODAY = "2026-09-30";
  const priced = summary().holdings[0];
  const unpriced = (ticker: string) => ({ ...priced, ticker, current_price: null });

  it("names the holding that has no live price", () => {
    const sum = summary({ holdings: [priced, unpriced("MSFT")], unpriced_count: 1 });
    expect(snapshotNote(sum, [], TODAY, false)).toBe("Today's value was not saved because MSFT has no live price.");
  });

  it("joins two names with and", () => {
    const sum = summary({ holdings: [unpriced("A"), unpriced("B")], unpriced_count: 2 });
    expect(snapshotNote(sum, [], TODAY, false)).toBe("Today's value was not saved because A and B have no live price.");
  });

  it("names up to three and counts the rest", () => {
    const sum = summary({ holdings: ["A", "B", "C", "D", "E"].map(unpriced), unpriced_count: 5 });
    expect(snapshotNote(sum, [], TODAY, false)).toBe("Today's value was not saved because A, B, C and 2 more have no live price.");
  });

  it("says nothing when today already has a snapshot, there are no open positions, or nothing is wrong", () => {
    const sum = summary({ holdings: [unpriced("MSFT")], unpriced_count: 1 });
    expect(snapshotNote(sum, [snapshot("2026-09-30T08:00:00")], TODAY, true)).toBeNull();
    expect(snapshotNote(summary({ holdings: [] }), [], TODAY, true)).toBeNull();
    expect(snapshotNote(summary(), [snapshot("2026-09-29T09:00:00")], TODAY, false)).toBeNull();
    expect(snapshotNote(undefined, [], TODAY, true)).toBeNull();
  });

  it("prefers the unpriced holding over a failed save as the reason", () => {
    const sum = summary({ holdings: [unpriced("MSFT")], unpriced_count: 1 });
    expect(snapshotNote(sum, [], TODAY, true)).toMatch(/MSFT has no live price/);
  });
});
