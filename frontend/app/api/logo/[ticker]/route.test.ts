import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { clearLogos } from "@/lib/logoCache";

const getClaims = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims } }) }));

import { GET } from "./route";

const PNG = new Uint8Array([137, 80, 78, 71]).buffer;

function ask(ticker: string, query = "") {
  return GET(new NextRequest(`http://localhost:3000/api/logo/${encodeURIComponent(ticker)}${query}`), {
    params: Promise.resolve({ ticker }),
  });
}

/** The init the route passed to its most recent upstream request. */
function lastInit(fetchMock: ReturnType<typeof vi.fn>) {
  expect(fetchMock).toHaveBeenCalled();
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1] as RequestInit & { next?: unknown };
}

/** A fetch that answers every call with a fresh response, so a second call is a real second request. */
function upstream(body: BodyInit | null, init: ResponseInit = {}) {
  return vi.fn().mockImplementation(async () => new Response(body, { status: 200, headers: { "content-type": "image/png" }, ...init }));
}

beforeEach(() => {
  clearLogos();
  getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
  vi.stubEnv("NEXT_PUBLIC_LOGO_DEV_TOKEN", "pk_test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  getClaims.mockReset();
});

describe("GET /api/logo/[ticker]", () => {
  it("refuses someone who is not signed in, without calling Logo.dev", async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error("no session") });
    const fetchMock = upstream(PNG);
    vi.stubGlobal("fetch", fetchMock);

    expect((await ask("AAPL")).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats an auth check that throws as not signed in, not a server error", async () => {
    getClaims.mockRejectedValue(new Error("auth server down"));
    const fetchMock = upstream(PNG);
    vi.stubGlobal("fetch", fetchMock);

    expect((await ask("AAPL")).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves the image from Logo.dev with the token only on the server's request", async () => {
    const fetchMock = upstream(PNG);
    vi.stubGlobal("fetch", fetchMock);

    const res = await ask("aapl", "?size=64");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(fetchMock.mock.calls[0][0]).toBe("https://img.logo.dev/ticker/AAPL?token=pk_test&size=64&fallback=404");
    expect(JSON.stringify([...res.headers])).not.toContain("pk_test");
  });

  it("keeps the upstream request out of Next's fetch cache, which would read the whole body for itself", async () => {
    const fetchMock = upstream(PNG);
    vi.stubGlobal("fetch", fetchMock);

    await ask("AAPL");
    const init = lastInit(fetchMock);
    expect(init.cache).toBe("no-store");
    expect(init.next).toBeUndefined();
    expect(init.redirect).toBe("error");
  });

  it.each([
    ["a missing logo", () => upstream(null, { status: 404 })],
    ["a rate limit", () => upstream(null, { status: 429 })],
    ["a type we do not serve", () => upstream("<svg/>", { headers: { "content-type": "image/svg+xml" } })],
    ["a declared length over the limit", () => upstream(new Uint8Array(10), { headers: { "content-type": "image/png", "content-length": "5000000" } })],
    ["an empty body", () => upstream(new Uint8Array(0))],
  ])("stops the upstream download once it is done with %s", async (_name, make) => {
    const fetchMock = make();
    vi.stubGlobal("fetch", fetchMock);

    await ask("AAPL");
    expect(lastInit(fetchMock).signal?.aborted).toBe(true);
  });

  describe("the in-memory cache", () => {
    it("asks Logo.dev once for a logo however many people ask", async () => {
      const fetchMock = upstream(PNG);
      vi.stubGlobal("fetch", fetchMock);

      const first = await ask("AAPL", "?size=64");
      const second = await ask("aapl", "?size=64");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(second.status).toBe(200);
      expect(second.headers.get("content-type")).toBe(first.headers.get("content-type"));
      expect(new Uint8Array(await second.arrayBuffer())).toEqual(new Uint8Array(PNG));
    });

    it("keeps one entry per size step, not per ticker only", async () => {
      const fetchMock = upstream(PNG);
      vi.stubGlobal("fetch", fetchMock);

      await ask("AAPL", "?size=64");
      await ask("AAPL", "?size=128");
      await ask("AAPL", "?size=100");

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("remembers a company with no logo", async () => {
      const fetchMock = upstream(null, { status: 404 });
      vi.stubGlobal("fetch", fetchMock);

      await ask("ZZZZ");
      const again = await ask("ZZZZ");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(again.status).toBe(404);
      expect(again.headers.get("cache-control")).toBe("private, max-age=3600");
    });

    it("does not remember a refused token, a rate limit or a server error", async () => {
      for (const status of [401, 403, 429, 500]) {
        clearLogos();
        const fetchMock = upstream(null, { status });
        vi.stubGlobal("fetch", fetchMock);

        const res = await ask("AAPL");
        expect(res.status).toBe(502);
        expect(res.headers.get("cache-control")).toBe("no-store");
        await ask("AAPL");
        expect(fetchMock).toHaveBeenCalledTimes(2);
      }
    });

    it("remembers an image it turned away as unusable, so it is not downloaded again", async () => {
      const fetchMock = upstream("<svg/>", { headers: { "content-type": "image/svg+xml" } });
      vi.stubGlobal("fetch", fetchMock);

      const first = await ask("AAPL");
      const second = await ask("AAPL");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect([first.status, second.status]).toEqual([404, 404]);
    });

    it("remembers an oversized or empty body the same way", async () => {
      for (const body of [new Uint8Array(200_001), new Uint8Array(0)]) {
        clearLogos();
        const fetchMock = upstream(body);
        vi.stubGlobal("fetch", fetchMock);

        await ask("AAPL");
        await ask("AAPL");
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }
    });
  });

  it.each(["BRK/B", "../../etc", "a b", "X".repeat(20), "$(id)"])("rejects the ticker %s without a request", async (ticker) => {
    const fetchMock = upstream(PNG);
    vi.stubGlobal("fetch", fetchMock);

    expect((await ask(ticker)).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["?size=68", 96],
    ["?size=999999", 512],
    ["?size=abc", 64],
    ["", 64],
  ])("snaps the size %s to the step %i", async (query, step) => {
    const fetchMock = upstream(PNG);
    vi.stubGlobal("fetch", fetchMock);

    await ask("AAPL", query);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`&size=${step}&`);
  });

  it("answers 404 that is not remembered when no token is set, so adding the token takes effect at once", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOGO_DEV_TOKEN", "");
    const fetchMock = upstream(PNG);
    vi.stubGlobal("fetch", fetchMock);

    const res = await ask("AAPL");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never serves SVG or any other type, which could carry script", async () => {
    vi.stubGlobal("fetch", upstream("<svg onload=alert(1)/>", { headers: { "content-type": "image/svg+xml" } }));
    expect((await ask("AAPL")).status).toBe(404);
    vi.stubGlobal("fetch", upstream("<html></html>", { headers: { "content-type": "text/html" } }));
    expect((await ask("AAPL")).status).toBe(404);
  });

  it("drops a body whose declared length is already too big, before reading it", async () => {
    vi.stubGlobal("fetch", upstream(new Uint8Array(10), { headers: { "content-type": "image/png", "content-length": "5000000" } }));
    expect((await ask("AAPL")).status).toBe(404);
  });

  it("drops an oversized or empty body", async () => {
    vi.stubGlobal("fetch", upstream(new Uint8Array(200_001)));
    expect((await ask("AAPL")).status).toBe(404);
    vi.stubGlobal("fetch", upstream(new Uint8Array(0)));
    expect((await ask("AAPL")).status).toBe(404);
  });

  it("answers a 502 that is not cached when Logo.dev is unreachable, so the logo is tried again", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const res = await ask("AAPL");
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("stops reading a body that has no declared length once it passes the limit", async () => {
    const chunk = new Uint8Array(100_000);
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        controller.enqueue(chunk);
        if (reads > 50) controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { status: 200, headers: { "content-type": "image/png" } })));

    expect((await ask("AAPL")).status).toBe(404);
    expect(reads).toBeLessThan(10);
  });
});
