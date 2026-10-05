import { type EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Only the pages the invite and reset emails link to. Checking for a leading "/" is not enough:
// browsers read "/\evil.example" and "/<tab>/evil.example" as off-site, so an open redirect hides there.
const NEXT_PAGES = new Set(["/accept-invitation", "/reset-password"]);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const rawNext = searchParams.get("next");
  const next = rawNext && NEXT_PAGES.has(rawNext) ? rawNext : "/accept-invitation";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(new URL("/accept-invitation", request.url));
}
