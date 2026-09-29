// Temporary: returns a fixed role so the shell's nav can be built and tested now.
// Sub-project 4 replaces this with a real Supabase-session-backed role lookup, keeping the
// same function name and return type so nothing that calls it needs to change.
export type Role = "admin" | "user";

export function getCurrentRole(): Role {
  return "user";
}
