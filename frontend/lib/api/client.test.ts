import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAction } from "@/lib/useAction";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import { apiFetch, apiFetchServer, ApiError } from "./client";

afterEach(() => vi.useRealTimers());

function mockSession(accessToken: string | null) {
  vi.mocked(createClient).mockReturnValue({
    auth: {
      getSession: async () => ({
        data: { session: accessToken ? { access_token: accessToken } : null },
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double, not the real client shape
  } as any);
}

describe("apiFetch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:8000";
  });

  it("attaches the bearer token when a session exists", async () => {
    mockSession("test-token");
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

    await apiFetch("/portfolio/holdings");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init?.headers as Headers).get("Authorization")).toBe("Bearer test-token");
  });

  it("omits the Authorization header entirely when there is no session", async () => {
    mockSession(null);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

    await apiFetch("/health");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init?.headers as Headers).has("Authorization")).toBe(false);
  });

  it("merges a caller-supplied Headers instance and preserves its Content-Type", async () => {
    mockSession(null);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

    await apiFetch("/health", { headers: new Headers({ "X-Custom": "abc" }) });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const headers = init?.headers as Headers;
    expect(headers.get("X-Custom")).toBe("abc");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("merges caller-supplied headers passed as a tuple array", async () => {
    mockSession(null);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

    await apiFetch("/health", { headers: [["X-Custom", "abc"]] });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init?.headers as Headers).get("X-Custom")).toBe("abc");
  });

  it("does not force Content-Type when the body is FormData", async () => {
    mockSession(null);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

    await apiFetch("/health", { method: "POST", body: new FormData() });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init?.headers as Headers).has("Content-Type")).toBe(false);
  });

  it("joins FastAPI's array-of-validation-errors detail shape into one message", async () => {
    mockSession(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: [
            { loc: ["body", "amount"], msg: "field required", type: "value_error.missing" },
            { loc: ["body", "symbol"], msg: "must not be empty", type: "value_error" },
          ],
        }),
        { status: 422 },
      ),
    );

    await expect(apiFetch("/portfolio/holdings")).rejects.toMatchObject({
      status: 422,
      detail: "field required; must not be empty",
    });
  });

  it("drops the 'Value error, ' prefix a custom validator's message carries", async () => {
    mockSession(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: [
            { loc: ["body", "isin"], msg: "Value error, Not a valid ISIN.", type: "value_error" },
            { loc: ["body", "x"], msg: "Keeps a Value error, in the middle", type: "value_error" },
          ],
        }),
        { status: 422 },
      ),
    );

    await expect(apiFetch("/portfolio/instruments/X/isin")).rejects.toMatchObject({
      status: 422,
      detail: "Not a valid ISIN.; Keeps a Value error, in the middle",
    });
  });

  it("parses the backend's error detail on a non-2xx response", async () => {
    mockSession(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not authenticated" }), { status: 401 }),
    );

    const promise = apiFetch("/portfolio/holdings");

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ status: 401, detail: "Not authenticated" });
  });

  it("exposes the error body's code on ApiError", async () => {
    mockSession(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: "Connect Claude first", code: "claude_key_required" }), {
        status: 409,
      }),
    );

    await expect(apiFetch("/chat")).rejects.toMatchObject({
      status: 409,
      detail: "Connect Claude first",
      code: "claude_key_required",
    });
  });

  it("leaves code undefined when the body has none", async () => {
    mockSession(null);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ detail: "Nope" }), { status: 429 }));

    await expect(apiFetch("/chat")).rejects.toHaveProperty("code", undefined);
  });

  it("falls back to the response's status text when the error body isn't JSON", async () => {
    mockSession(null);
    vi.mocked(fetch).mockResolvedValue(new Response("<html>Bad Gateway</html>", { status: 502, statusText: "Bad Gateway" }));

    await expect(apiFetch("/portfolio/holdings")).rejects.toMatchObject({
      status: 502,
      detail: "Bad Gateway",
    });
  });

  it("returns parsed JSON on success", async () => {
    mockSession(null);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

    const result = await apiFetch<{ status: string }>("/health");
    expect(result).toEqual({ status: "ok" });
  });

  it("releases a busy action with a useful error when fetch never settles", async () => {
    vi.useFakeTimers();
    mockSession(null);
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    const onBusy = vi.fn();
    const { result } = renderHook(() => useAction(onBusy));
    let action: Promise<void>;
    act(() => { action = result.current.run(() => apiFetch("/discover/ASML", { method: "PATCH" })); });
    expect(result.current.submitting).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      await action;
    });

    expect(result.current.submitting).toBe(false);
    expect(result.current.error).toBe("The request timed out. Check whether your changes were saved before trying again.");
    expect(onBusy.mock.calls).toEqual([[true], [false]]);
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds session lookup and never sends a write after a late session answer", async () => {
    vi.useFakeTimers();
    mockSession(null);
    const session = createClient().auth.getSession;
    let release!: () => void;
    vi.mocked(createClient).mockReturnValue({ auth: {
      getSession: async () => { await new Promise<void>((resolve) => { release = resolve; }); return session(); },
    } } as ReturnType<typeof createClient>);
    const request = expect(apiFetch("/discover/ASML", { method: "PATCH" })).rejects.toMatchObject({ code: "request_timeout" });
    await vi.advanceTimersByTimeAsync(30_000);
    await request;
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([apiFetch, (path: string) => apiFetchServer(path, "token")])("bounds a stalled response body for browser and server reads", async (request) => {
    vi.useFakeTimers();
    mockSession(null);
    vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({ start() {} })));
    const result = expect(request("/me")).rejects.toMatchObject({ code: "request_timeout" });
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
  });

  it("keeps caller cancellation and its reason", async () => {
    vi.useFakeTimers();
    mockSession(null);
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const reason = new Error("Cancelled by caller");
    const result = expect(apiFetch("/me", { signal: controller.signal })).rejects.toBe(reason);
    controller.abort(reason);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows a model reply beyond 30 seconds but still bounds Chat at five minutes", async () => {
    vi.useFakeTimers();
    mockSession(null);
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    const settled = vi.fn();
    const request = apiFetch("/chat").catch(settled);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(270_000);
    await request;
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ code: "request_timeout" }));
  });

  it("clears the deadline after success", async () => {
    vi.useFakeTimers();
    mockSession(null);
    vi.mocked(fetch).mockResolvedValue(new Response("{}"));
    await apiFetch("/me");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("apiFetchServer", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:8000";
  });

  it("attaches the given access token as the bearer header", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

    await apiFetchServer("/me", "server-token");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init?.headers as Headers).get("Authorization")).toBe("Bearer server-token");
  });

  it("parses the backend's error detail the same way apiFetch does", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: "No access to this service" }), { status: 403 }),
    );

    await expect(apiFetchServer("/admin/users", "tok")).rejects.toMatchObject({
      status: 403,
      detail: "No access to this service",
    });
  });

  it("returns parsed JSON on success", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ id: "u1" }), { status: 200 }));

    const result = await apiFetchServer<{ id: string }>("/me", "tok");

    expect(result).toEqual({ id: "u1" });
  });
});
