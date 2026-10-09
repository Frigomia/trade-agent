import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { SWRConfig } from "swr";
import { createElement, type ReactNode } from "react";

const { apiFetch, FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    constructor(
      public status: number,
      public detail: string,
      public code?: string,
    ) {
      super(detail);
    }
  }
  return { apiFetch: vi.fn(), FakeApiError };
});
vi.mock("@/lib/api/client", () => ({ apiFetch, ApiError: FakeApiError }));

import { usePlans, useDrift, useOpenOrders, previewPlan, parseAmount, planMonth, formatRate, type Plan } from "./plans";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children);

const summary = {
  id: 1,
  created_at: "2026-10-01T08:00:00",
  amount_eur: 500,
  line_count: 2,
};
const plan: Plan = {
  id: null,
  created_at: null,
  amount_eur: 500,
  whole_shares: true,
  total_before_eur: 10000,
  leftover_eur: 3.5,
  lines: [],
  notes: [],
  disclaimer: "Advisory only. Nothing is sent to a broker.",
};
const req = { amount: 500, whole_shares: true };
const listCalls = () => apiFetch.mock.calls.filter(([p, init]) => p === "/plans" && !init).length;

describe("plans", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it("lists saved plans", async () => {
    apiFetch.mockResolvedValue([summary]);
    const { result } = renderHook(() => usePlans(), { wrapper });
    await waitFor(() => expect(result.current.plans).toEqual([summary]));
  });

  it("previews with a POST of the numeric payload", async () => {
    apiFetch.mockResolvedValue(plan);
    await expect(previewPlan(req)).resolves.toBe(plan);
    expect(apiFetch).toHaveBeenCalledWith("/plans/preview", {
      method: "POST",
      body: JSON.stringify(req),
    });
  });

  it("save posts then revalidates the list", async () => {
    apiFetch.mockImplementation(async (_path: string, init?: RequestInit) => (init ? { ...plan, id: 2 } : [summary]));
    const { result } = renderHook(() => usePlans(), { wrapper });
    await waitFor(() => expect(result.current.plans).toBeDefined());
    const before = listCalls();
    let saved: Plan | undefined;
    await act(async () => {
      saved = await result.current.save(req);
    });
    expect(saved?.id).toBe(2);
    expect(apiFetch).toHaveBeenCalledWith("/plans", {
      method: "POST",
      body: JSON.stringify(req),
    });
    expect(listCalls()).toBe(before + 1);
  });

  it("remove deletes then revalidates; load fetches one plan", async () => {
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) =>
      init?.method === "DELETE" ? undefined : path === "/plans/1" ? plan : [summary],
    );
    const { result } = renderHook(() => usePlans(), { wrapper });
    await waitFor(() => expect(result.current.plans).toBeDefined());
    const before = listCalls();
    await act(async () => {
      await result.current.remove(1);
    });
    expect(apiFetch).toHaveBeenCalledWith("/plans/1", { method: "DELETE" });
    expect(listCalls()).toBe(before + 1);
    await expect(result.current.load(1)).resolves.toBe(plan);
  });

  it.each([
    [422, "amount must be positive"],
    [429, "Too many requests"],
    [409, "Plan limit reached (120)"],
  ])("surfaces the %i detail", async (status, detail) => {
    apiFetch.mockRejectedValue(new FakeApiError(status, detail));
    await expect(previewPlan(req)).rejects.toMatchObject({ status, detail });
    apiFetch.mockImplementation(async (_p: string, init?: RequestInit) => {
      if (init) throw new FakeApiError(status, detail);
      return [];
    });
    const { result } = renderHook(() => usePlans(), { wrapper });
    await waitFor(() => expect(result.current.plans).toEqual([]));
    await act(async () => {
      await expect(result.current.save(req)).rejects.toMatchObject({
        status,
        detail,
      });
    });
  });

  it("drift is fetched once and does not poll or revalidate on focus or reconnect", async () => {
    vi.useFakeTimers();
    apiFetch.mockResolvedValue([]);
    const { result } = renderHook(() => useDrift(), { wrapper });
    await vi.advanceTimersByTimeAsync(0);
    expect(result.current.drift).toEqual([]);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/plans/drift");
  });

  it("drift failure sets error without throwing and is not retried", async () => {
    vi.useFakeTimers();
    apiFetch.mockImplementation(async () => {
      throw new FakeApiError(500, "boom");
    });
    const { result } = renderHook(() => useDrift(), { wrapper });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(result.current.error?.detail).toBe("boom");
    expect(result.current.drift).toBeUndefined();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("drift returns items", async () => {
    const item = {
      ticker: "VWCE",
      name: "World",
      weight: 0.6,
      target: 0.5,
      points: 10,
    };
    apiFetch.mockResolvedValue([item]);
    const { result } = renderHook(() => useDrift(), { wrapper });
    await waitFor(() => expect(result.current.drift).toEqual([item]));
  });
});

describe("parseAmount", () => {
  it("accepts more than 0 up to 1,000,000 with two decimals at most", () => {
    expect(parseAmount("500")).toBe(500);
    expect(parseAmount(" 235,29 ")).toBe(235.29);
    expect(parseAmount("1000000")).toBe(1_000_000);
    expect(parseAmount("0.01")).toBe(0.01);
    for (const bad of ["", "0", "0.00", "0.001", "-5", "1000000.01", "1.234", "abc", "1e3"]) {
      expect(parseAmount(bad)).toBeNull();
    }
  });
});

describe("formatRate", () => {
  it("uses four significant digits and no raw floats", () => {
    expect(formatRate("USD", 0.9259259259259259)).toBe("1 USD = 0.9259 EUR");
    expect(formatRate("GBp", 0.011764705882352941)).toBe("1 penny = 0.01176 EUR");
    expect(formatRate("GBX", 0.0118)).toBe("1 penny = 0.0118 EUR");
    expect(formatRate("JPY", 0.00601)).toBe("1 JPY = 0.00601 EUR");
  });
});

describe("planMonth", () => {
  it("names the month and year", () => {
    expect(planMonth("2026-09-15T12:00:00")).toBe("September 2026");
  });
});

describe("useOpenOrders", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it("reads the open-orders route once and exposes the count and plans", async () => {
    apiFetch.mockResolvedValue({ open_lines: 3, plans: [plan] });
    const { result } = renderHook(() => useOpenOrders(), { wrapper });
    expect(result.current.openLines).toBe(0);
    await waitFor(() => expect(result.current.openLines).toBe(3));
    expect(result.current.plans).toEqual([plan]);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/plans/orders/open");
  });

  it("tolerates a failure: openLines 0, error set, no throw, no retry", async () => {
    vi.useFakeTimers();
    apiFetch.mockImplementation(async () => {
      throw new FakeApiError(500, "boom");
    });
    const { result } = renderHook(() => useOpenOrders(), { wrapper });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(result.current.error?.detail).toBe("boom");
    expect(result.current.openLines).toBe(0);
    expect(result.current.plans).toEqual([]);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("does not poll or refetch on focus or reconnect", async () => {
    vi.useFakeTimers();
    apiFetch.mockResolvedValue({ open_lines: 1, plans: [] });
    const { result } = renderHook(() => useOpenOrders(), { wrapper });
    await vi.advanceTimersByTimeAsync(0);
    expect(result.current.openLines).toBe(1);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
