export interface Header {
  key: string;
  value: string;
}

// "https://host/some/path" -> "https://host". Missing or malformed values are skipped, never thrown on.
function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The response headers every page gets. `script-src` keeps 'unsafe-inline' because Next.js and the
 * theme bootstrap emit inline scripts; the policy still blocks framing, plugins, a hijacked <base>,
 * form posts elsewhere, and any connection except to this site, the API and Supabase, which limits
 * where an injected script could send data. A per-request nonce would tighten script-src later.
 */
export function buildSecurityHeaders({
  apiUrl,
  supabaseUrl,
  dev,
}: {
  apiUrl?: string;
  supabaseUrl?: string;
  dev: boolean;
}): Header[] {
  const connect = ["'self'", origin(apiUrl), origin(supabaseUrl)].filter((o): o is string => o !== null);
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}${dev ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  const headers: Header[] = [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
  if (!dev) headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  return headers;
}
