import { NextRequest, NextResponse } from "next/server";
import { getLogo, putLogo } from "@/lib/logoCache";
import { createClient } from "@/lib/supabase/server";

// Company logos for the signed-in app. The browser asks this route, never Logo.dev, so Logo.dev
// sees this server and not a person's IP, referrer or the tickers they hold or watch, and the token
// is not in any page URL. The upstream fetch is deliberately not put in Next's shared fetch cache:
// that cache reads the whole upstream body for its own copy, which would defeat the size cap below.
// Instead only an accepted, size-checked image goes into lib/logoCache, shared by everyone on this
// server for a day, and each browser keeps it for a day too.
const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,14}$/; // AAPL, BRK.B, 0700.HK, AZN.L
const RASTER = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]); // never SVG: it can carry script
const MAX_BYTES = 200_000;
const DAY = 86_400;
const SIZES = [64, 96, 128, 192, 256, 512]; // a few steps, so one logo is one cache entry, not one per pixel size

// A short private cache on a real miss: a company with no logo is not asked about again on every render.
const miss = () => new NextResponse(null, { status: 404, headers: { "cache-control": "private, max-age=3600" } });
// Not a miss, and not to be remembered: a timeout, a rate limit, a server error or a refused token
// must all be tried again once they are fixed.
const unavailable = () => new NextResponse(null, { status: 502, headers: { "cache-control": "no-store" } });
// Logos are switched off here (no token). Not remembered, so adding the token takes effect at once.
const off = () => new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });
// A 200 we cannot use (an unserved type, too big, empty) is remembered like a missing logo, so the same
// bytes are not downloaded and thrown away again for every browser.
const unusable = (key: string) => {
  putLogo(key, null);
  return miss();
};

const logo = (type: string, bytes: Uint8Array<ArrayBuffer>) =>
  new NextResponse(bytes, {
    headers: { "content-type": type, "cache-control": `private, max-age=${DAY}`, "x-content-type-options": "nosniff" },
  });

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
  if (!token) return off();
  const ticker = (await params).ticker.toUpperCase();
  if (!TICKER.test(ticker)) return miss();
  const wanted = Number(request.nextUrl.searchParams.get("size")) || 0;
  const size = SIZES.find((s) => s >= wanted) ?? SIZES[SIZES.length - 1];

  const key = `${ticker}:${size}`;
  const cached = getLogo(key);
  if (cached) return cached.image ? logo(cached.image.type, cached.image.bytes) : miss();

  // Whatever happens, stop the download of a response we are not using; after a fully read body it is a no-op.
  const stop = new AbortController();
  try {
    const upstream = await fetch(
      `https://img.logo.dev/ticker/${encodeURIComponent(ticker)}?token=${encodeURIComponent(token)}&size=${size}&fallback=404`,
      { cache: "no-store", signal: AbortSignal.any([AbortSignal.timeout(5000), stop.signal]), redirect: "error" },
    );
    // Only a plain "no logo" is a miss. Any other refusal (a bad or over-quota token, a rate limit, a
    // server error) says nothing about this company, so it is not remembered.
    if (upstream.status === 404) {
      putLogo(key, null);
      return miss();
    }
    if (!upstream.ok) return unavailable();
    const type = upstream.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (!RASTER.has(type) || Number(upstream.headers.get("content-length")) > MAX_BYTES) return unusable(key);
    const bytes = await readCapped(upstream, MAX_BYTES);
    if (!bytes || bytes.byteLength === 0) return unusable(key);
    putLogo(key, { type, bytes });
    return logo(type, bytes);
  } catch {
    return unavailable(); // a timeout or an unreachable CDN shows the initials, and is tried again next time
  } finally {
    stop.abort();
  }
}
