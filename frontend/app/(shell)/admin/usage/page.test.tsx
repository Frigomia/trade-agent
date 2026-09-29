import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  },
];

describe("AdminUsagePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows each user's usage against their effective limit", async () => {
    apiFetch.mockResolvedValue(USERS);
    renderFresh(<AdminUsagePage />);

    await waitFor(() => expect(screen.getByText("a@example.com")).toBeInTheDocument());
    expect(screen.getByText("7 / 100")).toBeInTheDocument();
    expect(screen.getByText("42 / 500")).toBeInTheDocument();
  });

  it("shows an inline error when the usage list fails to load", async () => {
    apiFetch.mockRejectedValue(new Error("Forbidden"));
    renderFresh(<AdminUsagePage />);

    await waitFor(() => expect(screen.getByText(/could not load usage/i)).toBeInTheDocument());
  });
});
