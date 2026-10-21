import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";

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

import { useDiscovery } from "./useDiscovery";

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

const IDEAS = { recommendations: [], latest_scan: null };

describe("useDiscovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  function mockJob(poll: () => Promise<unknown>) {
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/discovery/ideas") return Promise.resolve(IDEAS);
      if (path === "/discovery/run" && init?.method === "POST") return Promise.resolve({ job_id: "j1" });
      if (path === "/discovery/run/j1") return poll();
      return Promise.resolve({});
    });
  }

  it("remembers a started scan for this browser tab", async () => {
    mockJob(() => new Promise(() => {}));
    const { result } = renderHook(() => useDiscovery(() => {}), { wrapper });

    await act(async () => {
      await result.current.start();
    });
    expect(sessionStorage.getItem("discovery:job")).toBe("j1");
  });

  it("picks a still-running scan up again after the page was left", async () => {
    sessionStorage.setItem("discovery:job", "j1");
    mockJob(() => Promise.resolve({ status: "RUNNING", stage: "researching", total: 8, done: 3, error: null }));
    const { result } = renderHook(() => useDiscovery(() => {}), { wrapper });

    await waitFor(() => expect(result.current.job?.done).toBe(3));
    expect(result.current.running).toBe(true);
  });

  it("stops resuming a scan that finished while away, and reloads the ideas and the run count", async () => {
    sessionStorage.setItem("discovery:job", "j1");
    mockJob(() => Promise.resolve({ status: "DONE", stage: "completed", total: 8, done: 8, error: null }));
    const { result } = renderHook(() => useDiscovery(() => {}), { wrapper });

    await waitFor(() => expect(sessionStorage.getItem("discovery:job")).toBeNull());
    expect(result.current.running).toBe(false);
    await waitFor(() =>
      expect(apiFetch.mock.calls.filter(([p]) => p === "/discovery/ideas").length).toBeGreaterThan(1),
    );
  });

  it("shows the failure of a scan that failed while away, once", async () => {
    sessionStorage.setItem("discovery:job", "j1");
    mockJob(() => Promise.resolve({ status: "FAILED", stage: "failed", total: 0, done: 0, error: "Scan interrupted." }));
    const { result } = renderHook(() => useDiscovery(() => {}), { wrapper });

    await waitFor(() => expect(result.current.job?.status).toBe("FAILED"));
    expect(sessionStorage.getItem("discovery:job")).toBeNull(); // a reload will not show it again
  });

  it("keeps the id and says the progress could not be read after a transient poll error", async () => {
    sessionStorage.setItem("discovery:job", "j1");
    mockJob(() => Promise.reject(new FakeApiError(503, "Unavailable")));
    const { result } = renderHook(() => useDiscovery(() => {}), { wrapper });

    await waitFor(() => expect(result.current.job?.status).toBe("FAILED"));
    expect(sessionStorage.getItem("discovery:job")).toBe("j1"); // still resumable
    expect(result.current.running).toBe(false);
  });

  it("drops an id the server no longer knows without showing an error", async () => {
    sessionStorage.setItem("discovery:job", "j1");
    mockJob(() => Promise.reject(new FakeApiError(404, "Job not found")));
    const { result } = renderHook(() => useDiscovery(() => {}), { wrapper });

    await waitFor(() => expect(sessionStorage.getItem("discovery:job")).toBeNull());
    expect(result.current.job).toBeUndefined();
    expect(result.current.running).toBe(false);
  });

  it("starts one scan when tapped again before the first answer", async () => {
    let resolvePost: (v: { job_id: string }) => void = () => {};
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/discovery/ideas") return Promise.resolve(IDEAS);
      if (path === "/discovery/run" && init?.method === "POST") return new Promise((r) => (resolvePost = r));
      return new Promise(() => {});
    });
    const { result } = renderHook(() => useDiscovery(() => {}), { wrapper });

    act(() => {
      void result.current.start();
    });
    expect(result.current.running).toBe(true); // already running while the request is in flight
    act(() => {
      void result.current.start(); // a second tap before the answer arrives
    });
    await act(async () => resolvePost({ job_id: "j1" }));

    const posts = apiFetch.mock.calls.filter(([p, init]) => p === "/discovery/run" && init?.method === "POST");
    expect(posts).toHaveLength(1);
  });

  it("ends the scan with an unreadable-progress failure when polling errors, instead of spinning", async () => {
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/discovery/ideas") return Promise.resolve(IDEAS);
      if (path === "/discovery/run" && init?.method === "POST") return Promise.resolve({ job_id: "j1" });
      if (path === "/discovery/run/j1") return Promise.reject(new FakeApiError(404, "Job not found"));
      return Promise.resolve({});
    });
    const { result } = renderHook(() => useDiscovery(() => {}), { wrapper });

    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(result.current.job?.status).toBe("FAILED"));
    expect(result.current.running).toBe(false);
  });

  it("calls onKeyRequired, and shows no error, when the scan is refused for want of a Claude key", async () => {
    const onKeyRequired = vi.fn();
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/discovery/ideas") return Promise.resolve(IDEAS);
      if (path === "/discovery/run" && init?.method === "POST") {
        return Promise.reject(new FakeApiError(409, "Connect Claude", "claude_key_required"));
      }
      return Promise.resolve({});
    });
    const { result } = renderHook(() => useDiscovery(onKeyRequired), { wrapper });

    await act(async () => {
      await result.current.start();
    });
    expect(onKeyRequired).toHaveBeenCalledTimes(1);
    expect(result.current.startError).toBeNull();
    expect(result.current.running).toBe(false);
  });
});
