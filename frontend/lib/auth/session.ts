import { createClient } from "@/lib/supabase/server";
import { apiFetchServer } from "@/lib/api/client";

export type Role = "admin" | "user";

export interface SessionInfo {
  userId: string;
  email: string;
  role: Role;
  status: string;
}

interface MeResponse {
  id: string;
  email: string;
  role: string;
  status: string;
  accepted_terms_at: string | null;
}

/**
 * Resolves the caller's identity server-side, or null if there's no valid, active-enough
 * session. Any failure — no Supabase session, an expired token, the backend rejecting the token
 * (a disabled user gets 403 from GET /me), a backend outage — is treated the same way: no
 * session. This keeps the shell/admin layouts' own logic to one check ("is this null?") instead
 * of distinguishing failure classes a visitor can't act on differently anyway — they see the
 * same calm "please sign in" redirect either way.
 */
export async function resolveSession(): Promise<SessionInfo | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return null;
  }

  try {
    const me = await apiFetchServer<MeResponse>("/me", session.access_token);
    return {
      userId: me.id,
      email: me.email,
      role: me.role === "admin" ? "admin" : "user",
      status: me.status,
    };
  } catch {
    return null;
  }
}
