// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp } }),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

describe("GET /auth/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifies the token and redirects to next on success", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const request = new NextRequest(
      "https://example.com/auth/confirm?token_hash=abc&type=invite&next=/accept-invitation",
    );

    const response = await GET(request);

    expect(verifyOtp).toHaveBeenCalledWith({ type: "invite", token_hash: "abc" });
    expect(response.headers.get("location")).toBe("https://example.com/accept-invitation");
  });

  it("redirects to /accept-invitation when verifyOtp fails", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    const request = new NextRequest("https://example.com/auth/confirm?token_hash=abc&type=invite");

    const response = await GET(request);

    expect(response.headers.get("location")).toBe("https://example.com/accept-invitation");
  });

  it("redirects to /accept-invitation when token_hash is missing", async () => {
    const request = new NextRequest("https://example.com/auth/confirm?type=invite");

    const response = await GET(request);

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://example.com/accept-invitation");
  });

  it("ignores an off-site next param and falls back to /accept-invitation", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const request = new NextRequest(
      "https://example.com/auth/confirm?token_hash=abc&type=invite&next=https://evil.example/phish",
    );

    const response = await GET(request);

    expect(response.headers.get("location")).toBe("https://example.com/accept-invitation");
  });

  it("ignores a protocol-relative next param and falls back to /accept-invitation", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const request = new NextRequest(
      "https://example.com/auth/confirm?token_hash=abc&type=invite&next=//evil.example",
    );

    const response = await GET(request);

    expect(response.headers.get("location")).toBe("https://example.com/accept-invitation");
  });
});
