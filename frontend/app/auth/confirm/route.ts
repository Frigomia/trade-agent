import { type EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Allowlist: "/\evil.example" and "/<tab>/evil.example" pass a startsWith("/") check but go off-site.
const NEXT_PAGES = new Set(["/accept-invitation", "/reset-password"]);
// Only the email links the app really sends (see docs/email-templates).
const TYPES: Record<string, { type: EmailOtpType; action: string }> = {
  invite: { type: "invite", action: "accept your invitation" },
  recovery: { type: "recovery", action: "reset your password" },
};

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// Plain server-rendered page: it carries the app's tokens (dark and light) without loading the
// app bundle, so a scanner or a stray click that merely opens the link changes nothing.
function page(status: number, title: string, body: string): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title} - trade-agent</title><style>
:root{--bg:#060d0c;--text:#e7f3ef;--muted:#8aa89f;--accent:#34e7a9;--on:#032116;--line:rgba(120,255,214,.11)}
@media(prefers-color-scheme:light){:root{--bg:#f2f8f5;--text:#0b1f19;--muted:#52695f;--accent:#067a52;--on:#fff;--line:rgba(8,110,80,.15)}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font-family:system-ui,sans-serif}
main{max-width:380px;padding:24px}h1{font-size:22px;letter-spacing:-.02em;margin:0 0 8px}p{color:var(--muted);line-height:1.5}
.warn{border:1px solid var(--line);border-radius:10px;padding:10px 12px;color:var(--text)}
button,a.btn{display:block;width:100%;box-sizing:border-box;text-align:center;padding:12px;border:0;border-radius:10px;background:var(--accent);color:var(--on);font:600 15px system-ui,sans-serif;text-decoration:none;cursor:pointer}
</style></head><body><main>${body}</main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function errorPage(status: number, message: string): NextResponse {
  return page(
    status,
    "Link problem",
    `<h1>This link cannot be used</h1><p>${escapeHtml(message)}</p><a class="btn" href="/login">Go to sign in</a>`,
  );
}

function readParams(get: (key: string) => string | null) {
  const tokenHash = get("token_hash");
  const entry = TYPES[get("type") ?? ""];
  const rawNext = get("next");
  const next = rawNext && NEXT_PAGES.has(rawNext) ? rawNext : "/accept-invitation";
  return tokenHash && entry ? { tokenHash, entry, type: get("type") as string, next } : null;
}

const BAD_LINK = "It is incomplete or no longer valid. Ask for a new one, or sign in.";

// GET only shows a page. Verifying the token here would let a plain link click replace the
// browser's session (login CSRF) and let email link scanners burn the single-use token.
export async function GET(request: NextRequest) {
  const params = readParams((k) => request.nextUrl.searchParams.get(k));
  if (!params) return errorPage(400, BAD_LINK);

  const hasSession = request.cookies.getAll().some((c) => /^sb-.*-auth-token/.test(c.name));
  const warning = hasSession
    ? `<p class="warn">Someone is already signed in on this browser. Continuing will replace that session. Only continue if this link is meant for you.</p>`
    : "";
  return page(
    200,
    "Confirm",
    `<h1>Continue to ${params.entry.action}</h1><p>Press Continue to finish.</p>${warning}
<form method="post" action="/auth/confirm">
<input type="hidden" name="token_hash" value="${escapeHtml(params.tokenHash)}">
<input type="hidden" name="type" value="${escapeHtml(params.type)}">
<input type="hidden" name="next" value="${escapeHtml(params.next)}">
<button type="submit">Continue</button></form>`,
  );
}

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (origin) return origin === request.nextUrl.origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorPage(403, "This request did not come from this site.");

  const form = await request.formData();
  const params = readParams((k) => {
    const value = form.get(k);
    return typeof value === "string" ? value : null;
  });
  if (!params) return errorPage(400, BAD_LINK);

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type: params.entry.type,
    token_hash: params.tokenHash,
  });
  if (error) return errorPage(400, BAD_LINK);

  return NextResponse.redirect(new URL(params.next, request.url), 303);
}
