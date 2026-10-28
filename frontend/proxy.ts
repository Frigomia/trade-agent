import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // api/logo is left out: a page load has just refreshed the session, and each logo request checks it
  // itself, so thirty logos do not mean thirty more Supabase Auth round trips.
  matcher: ["/((?!_next/static|_next/image|api/logo/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
