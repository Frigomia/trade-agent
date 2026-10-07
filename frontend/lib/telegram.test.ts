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

import { useTelegram, type TelegramStatus } from "./telegram";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children);

const unlinked: TelegramStatus = {
  configured: true,
  linked: false,
  status: null,
  digest_enabled: true,
  moves_enabled: true,
  move_threshold_pct: 5,
  bot_username: "trade_bot",
};
const linked: TelegramStatus = { ...unlinked, linked: true, status: "ok" };
const link = { url: "https://t.me/trade_bot?start=CODE123", expires_in: 600 };

const gets = () => apiFetch.mock.calls.filter(([p, init]) => p === "/me/telegram" && !init).length;

describe("useTelegram", () => {
  beforeEach(() => apiFetch.mockReset());
  afterEach(() => vi.useRealTimers());

  it("loads the status from GET /me/telegram", async () => {
    apiFetch.mockResolvedValue(unlinked);
    const { result } = renderHook(() => useTelegram(), { wrapper });
    await waitFor(() => expect(result.current.status).toEqual(unlinked));
    expect(apiFetch).toHaveBeenCalledWith("/me/telegram");
    expect(result.current.waiting).toBe(false);
  });

  it("connect POSTs /me/telegram/link and returns the link without keeping the code", async () => {
    apiFetch.mockImplementation(async (path: string) => (path === "/me/telegram/link" ? link : unlinked));
    const { result } = renderHook(() => useTelegram(), { wrapper });
    await waitFor(() => expect(result.current.status).toEqual(unlinked));

    let returned;
    await act(async () => {
      returned = await result.current.connect();
    });

    expect(apiFetch).toHaveBeenCalledWith("/me/telegram/link", { method: "POST" });
    expect(returned).toEqual(link);
    expect(result.current.waiting).toBe(true);
    expect(JSON.stringify(result.current.status)).not.toContain("CODE123");
  });

  it("cancel stops waiting", async () => {
    apiFetch.mockImplementation(async (path: string) => (path === "/me/telegram/link" ? link : unlinked));
    const { result } = renderHook(() => useTelegram(), { wrapper });
    await waitFor(() => expect(result.current.status).toEqual(unlinked));
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.waiting).toBe(true);
    act(() => result.current.cancel());
    expect(result.current.waiting).toBe(false);
  });

  it("connect surfaces the backend error and does not start waiting", async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === "/me/telegram/link") throw new FakeApiError(503, "Telegram is not set up on this server.");
      return unlinked;
    });
    const { result } = renderHook(() => useTelegram(), { wrapper });
    await waitFor(() => expect(result.current.status).toEqual(unlinked));

    await expect(result.current.connect()).rejects.toMatchObject({ status: 503 });
    expect(result.current.waiting).toBe(false);
  });

  it("update PATCHes only the given fields and shows the revalidated status", async () => {
    let patched = false;
    apiFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        patched = true;
        return { ...linked, moves_enabled: false };
      }
      return patched ? { ...linked, moves_enabled: false } : linked;
    });
    const { result } = renderHook(() => useTelegram(), { wrapper });
    await waitFor(() => expect(result.current.status).toEqual(linked));

    await act(() => result.current.update({ moves_enabled: false }));

    expect(apiFetch).toHaveBeenCalledWith("/me/telegram", {
      method: "PATCH",
      body: JSON.stringify({ moves_enabled: false }),
    });
    await waitFor(() => expect(result.current.status?.moves_enabled).toBe(false));
  });

  it("update surfaces the backend error", async () => {
    apiFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") throw new FakeApiError(422, "bad threshold");
      return linked;
    });
    const { result } = renderHook(() => useTelegram(), { wrapper });
    await waitFor(() => expect(result.current.status).toEqual(linked));

    await expect(result.current.update({ move_threshold_pct: 99 })).rejects.toMatchObject({ status: 422 });
  });

  it("disconnect sends DELETE and revalidates", async () => {
    let removed = false;
    apiFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        removed = true;
        return undefined;
      }
      return removed ? unlinked : linked;
    });
    const { result } = renderHook(() => useTelegram(), { wrapper });
    await waitFor(() => expect(result.current.status).toEqual(linked));

    await act(() => result.current.disconnect());

    expect(apiFetch).toHaveBeenCalledWith("/me/telegram", { method: "DELETE" });
    await waitFor(() => expect(result.current.status).toEqual(unlinked));
  });

  describe("waiting", () => {
    async function setup() {
      vi.useFakeTimers();
      let isLinked = false;
      apiFetch.mockImplementation(async (path: string) => {
        if (path === "/me/telegram/link") return link;
        return isLinked ? linked : unlinked;
      });
      const hook = renderHook(() => useTelegram(), { wrapper });
      await vi.advanceTimersByTimeAsync(0);
      await act(async () => {
        await hook.result.current.connect();
      });
      return { ...hook, setLinked: () => (isLinked = true) };
    }

    it("re-fetches every 3 seconds until linked, then stops", async () => {
      const { result, setLinked } = await setup();
      expect(result.current.waiting).toBe(true);

      const before = gets();
      await act(() => vi.advanceTimersByTimeAsync(9000));
      expect(gets() - before).toBeGreaterThanOrEqual(3);

      setLinked();
      await act(() => vi.advanceTimersByTimeAsync(3000));
      expect(result.current.status?.linked).toBe(true);
      expect(result.current.waiting).toBe(false);

      const after = gets();
      await act(() => vi.advanceTimersByTimeAsync(30000));
      expect(gets()).toBe(after);
    });

    it("stops after expires_in seconds", async () => {
      const { result } = await setup();
      await act(() => vi.advanceTimersByTimeAsync(600_000 + 1));
      expect(result.current.waiting).toBe(false);

      const after = gets();
      await act(() => vi.advanceTimersByTimeAsync(30000));
      expect(gets()).toBe(after);
    });

    it("stops on unmount", async () => {
      const { unmount } = await setup();
      const connected = gets();
      await act(() => vi.advanceTimersByTimeAsync(6000));
      expect(gets()).toBeGreaterThan(connected);
      unmount();
      const after = gets();
      await vi.advanceTimersByTimeAsync(30000);
      expect(gets()).toBe(after);
    });

    it("does not poll when never connecting", async () => {
      vi.useFakeTimers();
      apiFetch.mockResolvedValue(unlinked);
      renderHook(() => useTelegram(), { wrapper });
      await vi.advanceTimersByTimeAsync(0);
      const after = gets();
      expect(after).toBeGreaterThanOrEqual(1);
      await vi.advanceTimersByTimeAsync(9000);
      expect(gets()).toBe(after);
    });

    describe("reconnecting from blocked", () => {
      async function blockedSetup() {
        vi.useFakeTimers();
        let state: TelegramStatus = { ...linked, status: "blocked" };
        apiFetch.mockImplementation(async (path: string) => (path === "/me/telegram/link" ? link : state));
        const hook = renderHook(() => useTelegram(), { wrapper });
        await vi.advanceTimersByTimeAsync(0);
        expect(hook.result.current.waiting).toBe(false);
        await act(async () => {
          await hook.result.current.connect();
        });
        return { ...hook, recover: () => (state = linked), block: () => (state = { ...linked, status: "blocked" }) };
      }

      it("waits and polls while blocked, and stops once the status is ok", async () => {
        const { result, recover } = await blockedSetup();
        expect(result.current.waiting).toBe(true);
        const before = gets();
        await act(() => vi.advanceTimersByTimeAsync(9000));
        expect(gets() - before).toBeGreaterThanOrEqual(3);

        recover();
        await act(() => vi.advanceTimersByTimeAsync(3000));
        expect(result.current.status?.status).toBe("ok");
        expect(result.current.waiting).toBe(false);
        const after = gets();
        await act(() => vi.advanceTimersByTimeAsync(30000));
        expect(gets()).toBe(after);
      });

      it("a block after the recovery is not a new wait", async () => {
        const { result, recover, block } = await blockedSetup();
        recover();
        await act(() => vi.advanceTimersByTimeAsync(3000));
        expect(result.current.waiting).toBe(false);
        block();
        await act(() => vi.advanceTimersByTimeAsync(3000));
        await act(() => result.current.refresh());
        expect(result.current.status?.status).toBe("blocked");
        expect(result.current.waiting).toBe(false);
        const after = gets();
        await act(() => vi.advanceTimersByTimeAsync(30000));
        expect(gets()).toBe(after);
      });

      it("cancel stops the polling", async () => {
        const { result } = await blockedSetup();
        act(() => result.current.cancel());
        expect(result.current.waiting).toBe(false);
        const after = gets();
        await act(() => vi.advanceTimersByTimeAsync(30000));
        expect(gets()).toBe(after);
      });

      it("expiry stops the polling", async () => {
        const { result } = await blockedSetup();
        await act(() => vi.advanceTimersByTimeAsync(600_000 + 1));
        expect(result.current.waiting).toBe(false);
        const after = gets();
        await act(() => vi.advanceTimersByTimeAsync(30000));
        expect(gets()).toBe(after);
      });
    });

    it("keeps polling when the host re-renders every second", async () => {
      const { rerender } = await setup();
      const before = gets();
      for (let i = 0; i < 9; i++) {
        await act(() => vi.advanceTimersByTimeAsync(1000));
        rerender();
      }
      expect(gets() - before).toBeGreaterThanOrEqual(2);
    });
  });
});
