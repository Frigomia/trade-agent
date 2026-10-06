import { describe, it, expect, vi, beforeEach } from "vitest";
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

import { useClaudeKey, isClaudeKeyRequired } from "./claudeKey";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children);

const none = { connected: false, last4: null, needs_attention: false };
const connected = { connected: true, last4: "wxyz", needs_attention: false };

describe("useClaudeKey", () => {
  beforeEach(() => apiFetch.mockReset());

  it("loads the status from GET /me/claude-key", async () => {
    apiFetch.mockResolvedValue(connected);
    const { result } = renderHook(() => useClaudeKey(), { wrapper });
    await waitFor(() => expect(result.current.status).toEqual(connected));
    expect(apiFetch).toHaveBeenCalledWith("/me/claude-key");
  });

  it("save PUTs {api_key}, then shows the response status", async () => {
    let saved = false;
    apiFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        saved = true;
        return connected;
      }
      return saved ? connected : none;
    });
    const { result } = renderHook(() => useClaudeKey(), { wrapper });
    await waitFor(() => expect(result.current.status).toEqual(none));

    await act(() => result.current.save("sk-ant-secret-wxyz"));

    expect(apiFetch).toHaveBeenCalledWith("/me/claude-key", {
      method: "PUT",
      body: JSON.stringify({ api_key: "sk-ant-secret-wxyz" }),
    });
    await waitFor(() => expect(result.current.status).toEqual(connected));
    expect(JSON.stringify(result.current.status)).not.toContain("sk-ant");
  });

  it("save surfaces the backend error (invalid_key) to the caller", async () => {
    apiFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === "PUT") throw new FakeApiError(422, "Anthropic rejected this key.", "invalid_key");
      return none;
    });
    const { result } = renderHook(() => useClaudeKey(), { wrapper });
    await waitFor(() => expect(result.current.status).toEqual(none));

    await expect(result.current.save("sk-ant-bad")).rejects.toMatchObject({
      status: 422,
      code: "invalid_key",
      detail: "Anthropic rejected this key.",
    });
    expect(result.current.status).toEqual(none);
  });

  it("remove sends DELETE and revalidates", async () => {
    let removed = false;
    apiFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        removed = true;
        return undefined;
      }
      return removed ? none : connected;
    });
    const { result } = renderHook(() => useClaudeKey(), { wrapper });
    await waitFor(() => expect(result.current.status).toEqual(connected));

    await act(() => result.current.remove());

    expect(apiFetch).toHaveBeenCalledWith("/me/claude-key", { method: "DELETE" });
    await waitFor(() => expect(result.current.status).toEqual(none));
  });
});

describe("isClaudeKeyRequired", () => {
  it("is true only for a 409 with code claude_key_required", () => {
    expect(isClaudeKeyRequired(new FakeApiError(409, "x", "claude_key_required"))).toBe(true);
    expect(isClaudeKeyRequired(new FakeApiError(409, "x"))).toBe(false);
    expect(isClaudeKeyRequired(new FakeApiError(422, "x", "claude_key_required"))).toBe(false);
    expect(isClaudeKeyRequired(new Error("x"))).toBe(false);
    expect(isClaudeKeyRequired(null)).toBe(false);
  });
});
