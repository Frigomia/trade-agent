import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/lib/auth/session", () => ({ resolveSession: vi.fn() }));
vi.mock("@/components/shell/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("@/components/shell/TabBar", () => ({ TabBar: () => null }));
vi.mock("@/components/shell/ThemeToggle", () => ({ ThemeToggle: () => null }));

import { redirect } from "next/navigation";
import { resolveSession } from "@/lib/auth/session";
import ShellLayout from "./layout";

describe("ShellLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when there is no session", async () => {
    vi.mocked(resolveSession).mockResolvedValue(null);

    await expect(ShellLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login when the session isn't active yet (still invited)", async () => {
    vi.mocked(resolveSession).mockResolvedValue({
      userId: "u1",
      email: "a@example.com",
      role: "user",
      status: "invited",
    });

    await expect(ShellLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("renders the shell for an active session, without redirecting", async () => {
    vi.mocked(resolveSession).mockResolvedValue({
      userId: "u1",
      email: "a@example.com",
      role: "user",
      status: "active",
    });

    const result = await ShellLayout({ children: null });

    expect(result).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});
