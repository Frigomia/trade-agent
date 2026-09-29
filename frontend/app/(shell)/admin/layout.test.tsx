import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/lib/auth/session", () => ({ resolveSession: vi.fn() }));

import { redirect } from "next/navigation";
import { resolveSession } from "@/lib/auth/session";
import AdminLayout from "./layout";

describe("AdminLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a non-admin to /today", async () => {
    vi.mocked(resolveSession).mockResolvedValue({
      userId: "u1",
      email: "a@example.com",
      role: "user",
      status: "active",
    });

    await expect(AdminLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/today");
  });

  it("redirects to /today when there is no session at all", async () => {
    vi.mocked(resolveSession).mockResolvedValue(null);

    await expect(AdminLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/today");
  });

  it("renders for an admin, without redirecting", async () => {
    vi.mocked(resolveSession).mockResolvedValue({
      userId: "u1",
      email: "admin@example.com",
      role: "admin",
      status: "active",
    });

    const result = await AdminLayout({ children: "admin content" });

    expect(result).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});
