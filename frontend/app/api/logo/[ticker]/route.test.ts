import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getClaims = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims } }) }));

import { GET } from "./route";

const PNG = new Uint8Array([137, 80, 78, 71]).buffer;

function ask(ticker: string, query = "") {
  return GET(new NextRequest(`http://localhost:3000/api/logo/${encodeURIComponent(ticker)}${query}`), {
    params: Promise.resolve({ ticker }),
  });
}

function upstream(body: BodyInit | null, init: ResponseInit = {}) {
  return vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: { "content-type": "image/png" }, ...init }));
}

beforeEach(() => {
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

  it("treats an auth check that throws as not signed in, not a server error", async () => {
    getClaims.mockRejectedValue(new Error("auth server down"));
    const fetchMock = upstream(PNG);
    vi.stubGlobal("fetch", fetchMock);

    expect((await ask("AAPL")).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("lets the browser keep a missing logo for an hour", async () => {
    vi.stubGlobal("fetch", upstream(null, { status: 404 }));
    expect((await ask("AAPL")).headers.get("cache-control")).toBe("private, max-age=3600");
  });

  it("shows initials (404) when no token is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOGO_DEV_TOKEN", "");
    const fetchMock = upstream(PNG);
    vi.stubGlobal("fetch", fetchMock);

    expect((await ask("AAPL")).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes on a missing logo as a 404", async () => {
    vi.stubGlobal("fetch", upstream(null, { status: 404 }));
    expect((await ask("AAPL")).status).toBe(404);
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

  it.each([429, 500, 503])("does not remember a rate limit or server error (%i) as a missing logo", async (status) => {
    vi.stubGlobal("fetch", upstream(null, { status }));
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
    vi.stubGlobal("fetch", upstream(stream));

    expect((await ask("AAPL")).status).toBe(404);
    expect(reads).toBeLessThan(10);
  });
});
