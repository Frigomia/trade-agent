import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { AdminUserOut } from "@/lib/api/admin-types";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import AdminUsagePage from "./page";

function renderFresh(ui: React.ReactElement) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

const USERS: AdminUserOut[] = [
  {
    id: "u1",
    email: "a@example.com",
    role: "user",
    status: "active",
    created_at: "2026-01-01T00:00:00",
    invited_at: null,
    invite_expires_at: null,
    accepted_terms_at: "2026-01-02T00:00:00",
    last_seen_at: null,
    monthly_analysis_limit: 100,
    monthly_analysis_used: 7,
    monthly_chat_limit: 500,
    monthly_chat_used: 42,
    claude_key_state: "none",
  },
];

describe("AdminUsagePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const serve = (overrides: Record<string, unknown> = {}) =>
    apiFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path in overrides) return overrides[path];
      if (path === "/admin/limit-defaults") return { analysis_limit: 100, chat_limit: 500 };
      if (path === "/admin/users") return USERS;
      throw new Error(`unexpected ${init?.method ?? "GET"} ${path}`);
    });

  it("shows each user's usage against their effective limit", async () => {
    serve();
    renderFresh(<AdminUsagePage />);

    await waitFor(() => expect(screen.getByText("a@example.com")).toBeInTheDocument());
    expect(screen.getByText("7 / 100")).toBeInTheDocument();
    expect(screen.getByText("42 / 500")).toBeInTheDocument();
  });

  it("totals the month's usage across people", async () => {
    serve({ "/admin/users": [USERS[0], { ...USERS[0], id: "u2", email: "b@example.com", monthly_analysis_used: 3, monthly_chat_used: 8 }] });
    renderFresh(<AdminUsagePage />);

    expect(await screen.findByText("10 runs")).toBeInTheDocument();
    expect(screen.getByText("50 messages")).toBeInTheDocument();
  });

  it("shows the default limits and saves new ones", async () => {
    serve({ "/admin/limit-defaults": { analysis_limit: 100, chat_limit: 500 } });
    renderFresh(<AdminUsagePage />);

    const analysis = await screen.findByLabelText("Analysis runs");
    expect(analysis).toHaveValue(100);
    fireEvent.change(analysis, { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save defaults" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/admin/limit-defaults", {
        method: "PUT",
        body: JSON.stringify({ analysis_limit: 20, chat_limit: 500 }),
      }),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("refuses a negative or non-integer default without calling the API", async () => {
    serve();
    renderFresh(<AdminUsagePage />);

    fireEvent.change(await screen.findByLabelText("Chat messages"), { target: { value: "-3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save defaults" }));

    expect(await screen.findByText(/whole numbers, zero or more/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith("/admin/limit-defaults", expect.objectContaining({ method: "PUT" }));
  });

  it("shows an inline error when the usage list fails to load", async () => {
    apiFetch.mockRejectedValue(new Error("Forbidden"));
    renderFresh(<AdminUsagePage />);


    await waitFor(() => expect(screen.getByText(/could not load usage/i)).toBeInTheDocument());
  });
});
