import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { SWRConfig, useSWRConfig } from "swr";
import type { BacktestListItem, BacktestResult } from "@/lib/backtest";

const { FakeApiError } = vi.hoisted(() => ({
  FakeApiError: class FakeApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
    }
  },
}));
const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: FakeApiError,
}));

import BacktestsPage from "./page";

const LIST_ITEM: BacktestListItem = {
  id: 7,
  created_at: "2026-09-30T10:00:00",
  ticker: "AAPL",
  start_date: "2023-01-02",
  end_date: "2026-09-30",
  final_value: 11000,
  buy_and_hold_value: 10500,
  excess_return_pct: 0.0476,
  hit_rate_by_signal: {
    STRONG_UPTREND: { count: 12, avg_forward_return_pct: 0.0238, hit_rate: 0.65 },
  },
  status: "DONE",
};
const RESULT: BacktestResult = {
  ...LIST_ITEM,
  equity_curve: { strategy: [10000, 11000], buy_and_hold: [10000, 10500] },
};
const WARNING = "The backtest could not run for that ticker and range. Check the ticker and dates.";

type Routes = Record<string, (init?: RequestInit) => unknown>;

function mockApi(routes: Routes) {
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    const handler = routes[path];
    if (!handler) throw new Error(`unexpected ${path}`);
    return handler(init);
  });
}

const calls = (path: string) => apiFetch.mock.calls.filter((c) => c[0] === path);

let swrMutate: ReturnType<typeof useSWRConfig>["mutate"];
function GrabMutate() {
  const { mutate } = useSWRConfig();
  useEffect(() => {
    swrMutate = mutate;
  }, [mutate]);
  return null;
}

function renderFresh() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <GrabMutate />
      <BacktestsPage />
    </SWRConfig>,
  );
}

function startRun() {
  fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "AAPL" } });
  fireEvent.click(screen.getByRole("button", { name: "Run backtest" }));
}

async function step() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2100);
  });
}

describe("BacktestsPage", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows an empty state and the page heading", async () => {
    mockApi({ "/backtest/results": () => [] });
    renderFresh();
    expect(await screen.findByText("No backtests yet.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Backtests" })).toBeInTheDocument();
  });

  it("runs, polls until done, shows the result and refreshes the list", async () => {
    let polls = 0;
    mockApi({
      "/backtest/results": () => [],
      "/backtest/run": () => ({ job_id: "j1" }),
      "/backtest/run/j1": () => (++polls === 1 ? { status: "RUNNING", backtest_result_id: null } : { status: "DONE", backtest_result_id: 7 }),
      "/backtest/results/7": () => RESULT,
    });
    renderFresh();
    await screen.findByText("No backtests yet.");
    startRun();
    expect(await screen.findByRole("status")).toHaveTextContent(/running the backtest/i);
    const post = calls("/backtest/run")[0][1] as RequestInit;
    expect(post.method).toBe("POST");
    expect(JSON.parse(post.body as string)).toEqual({
      ticker: "AAPL",
      start_date: (screen.getByLabelText("From") as HTMLInputElement).value,
      end_date: (screen.getByLabelText("To") as HTMLInputElement).value,
    });
    expect(screen.queryByText(/Strategy final value/)).not.toBeInTheDocument();
    await waitFor(() => expect(calls("/backtest/run/j1")).toHaveLength(1));
    const listCallsBefore = calls("/backtest/results").length;
    await step();
    expect(await screen.findByText("11,000.00")).toBeInTheDocument();
    expect(calls("/backtest/results").length).toBeGreaterThan(listCallsBefore);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a calm warning for a failed job and leaves the form usable", async () => {
    mockApi({
      "/backtest/results": () => [],
      "/backtest/run": () => ({ job_id: "j1" }),
      "/backtest/run/j1": () => ({ status: "FAILED", backtest_result_id: null }),
    });
    renderFresh();
    await screen.findByText("No backtests yet.");
    startRun();
    expect(await screen.findByText(WARNING)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run backtest" })).toBeEnabled();
    expect(screen.queryByText(/Strategy final value/)).not.toBeInTheDocument();
    await step();
    expect(calls("/backtest/run/j1")).toHaveLength(1);
  });

  it("treats an expired job (404) like a failure and stops polling", async () => {
    mockApi({
      "/backtest/results": () => [],
      "/backtest/run": () => ({ job_id: "j1" }),
      "/backtest/run/j1": () => {
        throw new FakeApiError(404, "Job not found");
      },
    });
    renderFresh();
    await screen.findByText("No backtests yet.");
    startRun();
    expect(await screen.findByText(WARNING)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run backtest" })).toBeEnabled();
    const before = calls("/backtest/run/j1").length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(calls("/backtest/run/j1")).toHaveLength(before);
  });

  it("shows a server error from starting the run and starts no polling", async () => {
    mockApi({
      "/backtest/results": () => [],
      "/backtest/run": () => {
        throw new FakeApiError(422, "start_date must not be after end_date");
      },
    });
    renderFresh();
    await screen.findByText("No backtests yet.");
    startRun();
    expect(await screen.findByText("start_date must not be after end_date")).toBeInTheDocument();
    await step();
    expect(apiFetch.mock.calls.some((c) => String(c[0]).startsWith("/backtest/run/"))).toBe(false);
  });

  it("loads a past run when its row is clicked", async () => {
    mockApi({
      "/backtest/results": () => [LIST_ITEM],
      "/backtest/results/7": () => RESULT,
    });
    renderFresh();
    const row = await screen.findByRole("button", { name: /AAPL/ });
    expect(row).toHaveTextContent("2023-01-02 to 2026-09-30");
    expect(row).toHaveTextContent("+4.8%");
    fireEvent.click(row);
    expect(await screen.findByText("11,000.00")).toBeInTheDocument();
    expect(calls("/backtest/results/7").length).toBeGreaterThanOrEqual(1);
    expect(row).toHaveClass("Mui-selected");
  });

  it("shows numbers and the table but no chart for an older run without a curve", async () => {
    mockApi({
      "/backtest/results": () => [LIST_ITEM],
      "/backtest/results/7": () => ({ ...RESULT, equity_curve: null }),
    });
    renderFresh();
    fireEvent.click(await screen.findByRole("button", { name: /AAPL/ }));
    expect(await screen.findByText("11,000.00")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /strong uptrend/i })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("does not show the failure warning when a later job fetch fails after DONE", async () => {
    let polls = 0;
    mockApi({
      "/backtest/results": () => [],
      "/backtest/run": () => ({ job_id: "j1" }),
      "/backtest/run/j1": () => {
        if (++polls === 1) return { status: "DONE", backtest_result_id: 7 };
        throw new FakeApiError(404, "Job not found");
      },
      "/backtest/results/7": () => RESULT,
    });
    renderFresh();
    await screen.findByText("No backtests yet.");
    startRun();
    expect(await screen.findByText("11,000.00")).toBeInTheDocument();
    await act(async () => {
      await swrMutate("/backtest/run/j1");
    });
    await waitFor(() => expect(calls("/backtest/run/j1")).toHaveLength(2));
    expect(screen.getByText("11,000.00")).toBeInTheDocument();
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it("clears an old failure warning when the next run fails to start", async () => {
    mockApi({
      "/backtest/results": () => [],
      "/backtest/run": (() => {
        let n = 0;
        return () => {
          if (++n === 1) return { job_id: "j1" };
          throw new FakeApiError(422, "start_date must not be after end_date");
        };
      })(),
      "/backtest/run/j1": () => ({ status: "FAILED", backtest_result_id: null }),
    });
    renderFresh();
    await screen.findByText("No backtests yet.");
    startRun();
    expect(await screen.findByText(WARNING)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run backtest" }));
    expect(await screen.findByText("start_date must not be after end_date")).toBeInTheDocument();
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it("shows the new run's result, not a previously selected past run", async () => {
    const NEW = { ...RESULT, id: 8, ticker: "MSFT", final_value: 12500 };
    mockApi({
      "/backtest/results": () => [LIST_ITEM],
      "/backtest/results/7": () => RESULT,
      "/backtest/results/8": () => NEW,
      "/backtest/run": () => ({ job_id: "j2" }),
      "/backtest/run/j2": () => ({ status: "DONE", backtest_result_id: 8 }),
    });
    renderFresh();
    fireEvent.click(await screen.findByRole("button", { name: /AAPL/ }));
    expect(await screen.findByText("11,000.00")).toBeInTheDocument();
    startRun();
    expect(await screen.findByText("12,500.00")).toBeInTheDocument();
    expect(screen.queryByText("11,000.00")).not.toBeInTheDocument();
  });

  it("hides the failure warning once a past run is selected", async () => {
    mockApi({
      "/backtest/results": () => [LIST_ITEM],
      "/backtest/results/7": () => RESULT,
      "/backtest/run": () => ({ job_id: "j1" }),
      "/backtest/run/j1": () => ({ status: "FAILED", backtest_result_id: null }),
    });
    renderFresh();
    await screen.findByRole("button", { name: /AAPL/ });
    startRun();
    expect(await screen.findByText(WARNING)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /AAPL/ }));
    expect(await screen.findByText("11,000.00")).toBeInTheDocument();
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it("keeps the shown result when the next run fails to start", async () => {
    let n = 0;
    mockApi({
      "/backtest/results": () => [],
      "/backtest/run": () => {
        if (++n === 1) return { job_id: "j1" };
        throw new FakeApiError(422, "start_date must not be after end_date");
      },
      "/backtest/run/j1": () => ({ status: "DONE", backtest_result_id: 7 }),
      "/backtest/results/7": () => RESULT,
    });
    renderFresh();
    await screen.findByText("No backtests yet.");
    startRun();
    expect(await screen.findByText("11,000.00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run backtest" }));
    expect(await screen.findByText("start_date must not be after end_date")).toBeInTheDocument();
    expect(screen.getByText("11,000.00")).toBeInTheDocument();
  });

  it("shows load errors for the list and for a single backtest", async () => {
    mockApi({
      "/backtest/results": () => {
        throw new Error("boom");
      },
    });
    const first = renderFresh();
    expect(await screen.findByText("Could not load your recent runs.")).toBeInTheDocument();
    first.unmount();

    mockApi({
      "/backtest/results": () => [LIST_ITEM],
      "/backtest/results/7": () => {
        throw new Error("boom");
      },
    });
    renderFresh();
    fireEvent.click(await screen.findByRole("button", { name: /AAPL/ }));
    expect(await screen.findByText("Could not load that backtest.")).toBeInTheDocument();
  });
});
