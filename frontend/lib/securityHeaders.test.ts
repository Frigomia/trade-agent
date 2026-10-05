import { describe, it, expect } from "vitest";
import { buildSecurityHeaders } from "./securityHeaders";

const ENV = { apiUrl: "https://api.example.fly.dev/", supabaseUrl: "https://abc.supabase.co/some/path" };

function header(name: string, options = { ...ENV, dev: false }) {
  return buildSecurityHeaders(options).find((h) => h.key === name)?.value;
}

describe("buildSecurityHeaders", () => {
  it("forbids framing the app, in both the CSP and the older header", () => {
    expect(header("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(header("X-Frame-Options")).toBe("DENY");
  });

  it("limits where the page may connect to itself, the API and Supabase, by origin only", () => {
    const connect = header("Content-Security-Policy")!.split("; ").find((d) => d.startsWith("connect-src "));
    expect(connect).toBe("connect-src 'self' https://api.example.fly.dev https://abc.supabase.co");
  });

  it("skips an origin that is missing or not a URL instead of throwing", () => {
    const csp = header("Content-Security-Policy", { apiUrl: "", supabaseUrl: "not a url", dev: false })!;
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("undefined");
  });

  it("closes the other doors: plugins, base tag, form posts to other sites", () => {
    const csp = header("Content-Security-Policy")!;
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("default-src 'self'");
  });

  it("allows eval only in development (React refresh needs it)", () => {
    expect(header("Content-Security-Policy", { ...ENV, dev: true })).toContain("'unsafe-eval'");
    expect(header("Content-Security-Policy")).not.toContain("'unsafe-eval'");
  });

  it("sends the standard hardening headers, and HSTS only in production", () => {
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header("Permissions-Policy")).toContain("camera=()");
    expect(header("Strict-Transport-Security")).toContain("max-age=");
    expect(header("Strict-Transport-Security", { ...ENV, dev: true })).toBeUndefined();
  });
});
