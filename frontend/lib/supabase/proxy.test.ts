// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser } })),
}));

import { NextRequest } from "next/server";
import { updateSession } from "./proxy";

describe("updateSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: null } });
  });

  it("calls getUser to trigger a token refresh and returns a response", async () => {
    const request = new NextRequest("https://example.com/today");

    const response = await updateSession(request);

    expect(getUser).toHaveBeenCalled();
    expect(response).toBeDefined();
    expect(response.status).toBe(200);
  });
});
