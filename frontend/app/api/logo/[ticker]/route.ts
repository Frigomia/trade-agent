import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Company logos for the signed-in app. The browser asks this route, never Logo.dev, so Logo.dev
// sees this server (one cached request a day per logo, shared by everyone) and not a person's IP,
// referrer or the tickers they hold or watch, and the token is not in any page URL.
const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,14}$/; // AAPL, BRK.B, 0700.HK, AZN.L
const RASTER = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]); // never SVG: it can carry script
const MAX_BYTES = 200_000;
const DAY = 86_400;
const SIZES = [64, 96, 128, 192, 256, 512]; // a few steps, so one logo is one cache entry, not one per pixel size

// A short private cache on a real miss: a company with no logo is not asked about again on every render.
const miss = () => new NextResponse(null, { status: 404, headers: { "cache-control": "private, max-age=3600" } });
// A timeout, a rate limit or a server error is not a miss: it must not be remembered.
const unavailable = () => new NextResponse(null, { status: 502, headers: { "cache-control": "no-store" } });

/** The body, or null as soon as it passes `limit` bytes, so a response without a length cannot fill memory. */
async function readCapped(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

async function signedIn(): Promise<boolean> {
  try {
    const { data } = await (await createClient()).auth.getClaims();
    return data !== null;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  // Signed-in people only: this is not an open image proxy for the Logo.dev quota.
  if (!(await signedIn())) return new NextResponse(null, { status: 401 });

  const token = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;
  const ticker = (await params).ticker.toUpperCase();
  if (!token || !TICKER.test(ticker)) return miss();
  const wanted = Number(request.nextUrl.searchParams.get("size")) || 0;
  const size = SIZES.find((s) => s >= wanted) ?? SIZES[SIZES.length - 1];

  try {
    const upstream = await fetch(
      `https://img.logo.dev/ticker/${encodeURIComponent(ticker)}?token=${encodeURIComponent(token)}&size=${size}&fallback=404`,
      { next: { revalidate: DAY }, signal: AbortSignal.timeout(5000), redirect: "error" },
    );
    const type = upstream.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (upstream.status === 429 || upstream.status >= 500) return unavailable();
    if (!upstream.ok || !RASTER.has(type) || Number(upstream.headers.get("content-length")) > MAX_BYTES) return miss();
    const body = await readCapped(upstream, MAX_BYTES);
    if (!body || body.byteLength === 0) return miss();
    return new NextResponse(body, {
      headers: { "content-type": type, "cache-control": `private, max-age=${DAY}`, "x-content-type-options": "nosniff" },
    });
  } catch {
    return unavailable(); // a timeout or an unreachable CDN shows the initials, and is tried again next time
  }
}
