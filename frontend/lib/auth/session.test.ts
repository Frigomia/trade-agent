import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiFetchServer: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { apiFetchServer } from "@/lib/api/client";
import { resolveSession } from "./session";

function mockSupabaseSession(session: { access_token: string } | null) {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getSession: async () => ({ data: { session } }) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double, not the real client shape
  } as any);
}

describe("resolveSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when there is no Supabase session", async () => {
    mockSupabaseSession(null);

    expect(await resolveSession()).toBeNull();
    expect(apiFetchServer).not.toHaveBeenCalled();
  });

  it("returns the resolved role and status when /me succeeds", async () => {
    mockSupabaseSession({ access_token: "tok" });
    vi.mocked(apiFetchServer).mockResolvedValue({
      id: "u1",
      email: "a@example.com",
      role: "admin",
      status: "active",
      accepted_terms_at: null,
    });

    const result = await resolveSession();

    expect(result).toEqual({ userId: "u1", email: "a@example.com", role: "admin", status: "active" });
    expect(apiFetchServer).toHaveBeenCalledWith("/me", "tok");
  });

  it("treats a non-admin role string as \"user\"", async () => {
    mockSupabaseSession({ access_token: "tok" });
    vi.mocked(apiFetchServer).mockResolvedValue({
      id: "u1",
      email: "a@example.com",
      role: "user",
      status: "active",
      accepted_terms_at: "2026-01-01T00:00:00",
    });

    expect((await resolveSession())?.role).toBe("user");
  });

  it("returns null when /me rejects the token (e.g. a disabled user)", async () => {
    mockSupabaseSession({ access_token: "tok" });
    vi.mocked(apiFetchServer).mockRejectedValue(new Error("403"));

    expect(await resolveSession()).toBeNull();
  });
});
