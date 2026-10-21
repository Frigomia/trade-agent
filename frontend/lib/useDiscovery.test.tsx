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
  beforeEach(() => vi.clearAllMocks());

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
