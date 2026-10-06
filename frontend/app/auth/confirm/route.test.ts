// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp } }),
}));

import { NextRequest } from "next/server";
import { GET, POST } from "./route";

const ORIGIN = "https://example.com";

function getRequest(query: string, cookie?: string) {
  return new NextRequest(`${ORIGIN}/auth/confirm?${query}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

function postRequest(fields: Record<string, string>, headers: Record<string, string> = { origin: ORIGIN }) {
  return new NextRequest(`${ORIGIN}/auth/confirm`, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields),
  });
}

describe("GET /auth/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a confirmation page and never verifies the token", async () => {
    const response = await GET(getRequest("token_hash=abc&type=invite&next=/accept-invitation"));
    const html = await response.text();

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(html).toContain("Continue to accept your invitation");
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/auth/confirm"');
    expect(html).toContain('name="token_hash" value="abc"');
    expect(html).toContain('name="type" value="invite"');
    expect(html).toContain('name="next" value="/accept-invitation"');
  });

  it("describes a password reset for recovery links", async () => {
    const response = await GET(getRequest("token_hash=abc&type=recovery&next=/reset-password"));
    expect(await response.text()).toContain("Continue to reset your password");
  });

  it("escapes the token in the form", async () => {
    const response = await GET(getRequest('token_hash=%22%3E%3Cscript%3E&type=invite'));
    const html = await response.text();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("falls back to /accept-invitation for an unlisted next", async () => {
    const response = await GET(getRequest("token_hash=abc&type=invite&next=https://evil.example/x"));
    expect(await response.text()).toContain('name="next" value="/accept-invitation"');
  });

  it("warns when another session is already signed in", async () => {
    const response = await GET(
      getRequest("token_hash=abc&type=invite", "sb-proj-auth-token=somevalue"),
    );
    expect(await response.text()).toContain("already signed in");
  });

  it("does not warn without a session cookie", async () => {
    const response = await GET(getRequest("token_hash=abc&type=invite"));
    expect(await response.text()).not.toContain("already signed in");
  });

  it.each([
    ["missing token_hash", "type=invite"],
    ["missing type", "token_hash=abc"],
    ["an unsupported type", "token_hash=abc&type=magiclink"],
  ])("renders an error page with a login link for %s", async (_label, query) => {
    const response = await GET(getRequest(query));
    const html = await response.text();
    expect(response.status).toBe(400);
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('method="post"');
  });
});

describe("POST /auth/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifies the token and redirects 303 to next on success", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const response = await POST(postRequest({ token_hash: "abc", type: "invite", next: "/accept-invitation" }));

    expect(verifyOtp).toHaveBeenCalledWith({ type: "invite", token_hash: "abc" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/accept-invitation`);
  });

  it("follows next to the password-reset page for recovery", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const response = await POST(postRequest({ token_hash: "abc", type: "recovery", next: "/reset-password" }));

    expect(verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "abc" });
    expect(response.headers.get("location")).toBe(`${ORIGIN}/reset-password`);
  });

  it("accepts a same-origin request that only carries Sec-Fetch-Site", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const response = await POST(
      postRequest({ token_hash: "abc", type: "invite" }, { "sec-fetch-site": "same-origin" }),
    );
    expect(response.status).toBe(303);
  });

  it("shows an error page when verifyOtp fails", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    const response = await POST(postRequest({ token_hash: "abc", type: "invite" }));
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('href="/login"');
  });

  it.each([
    ["a foreign Origin", { origin: "https://evil.example" }],
    ["a cross-site Sec-Fetch-Site", { "sec-fetch-site": "cross-site" }],
    ["no Origin and no Sec-Fetch-Site", {}],
  ])("rejects a cross-origin POST with %s", async (_label, headers) => {
    const response = await POST(postRequest({ token_hash: "abc", type: "invite" }, headers));
    expect(response.status).toBe(403);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it.each([
    ["missing token_hash", { type: "invite" }],
    ["an unsupported type", { token_hash: "abc", type: "email" }],
  ])("rejects %s without verifying", async (_label, fields) => {
    const response = await POST(postRequest(fields));
    expect(response.status).toBe(400);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  // Browsers read a backslash as a slash and drop tabs, so the first two go off-site despite the
  // leading "/"; the third is a same-site page the emails never link to.
  it.each([
    ["an off-site URL", "https://evil.example/phish"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash", "/\evil.example"],
    ["a tab", "/\t/evil.example"],
    ["an unlisted page", "/today"],
  ])("ignores a next param with %s", async (_label, next) => {
    verifyOtp.mockResolvedValue({ error: null });
    const response = await POST(postRequest({ token_hash: "abc", type: "invite", next }));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/accept-invitation`);
  });
});
