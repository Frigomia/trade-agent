import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { AdminUserOut } from "@/lib/api/admin-types";

const apiFetch = vi.fn();
// The class must be created inside vi.hoisted (not as a plain top-level `class` statement) —
// vi.mock's factory is hoisted above the import of "./page", which transitively imports
// "@/lib/api/client" and triggers the factory before a plain top-level class declaration would
// have run, throwing a "Cannot access before initialization" TDZ error.
const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
    }
  }
  return { FakeApiError };
});
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: FakeApiError,
}));

import AdminPage from "./page";

function renderFresh(ui: React.ReactElement) {
  // A fresh SWR cache per test — the module-level default cache otherwise leaks state
  // between tests using the same key ("/admin/users").
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

const USERS: AdminUserOut[] = [
  {
    id: "u1",
    email: "active@example.com",
    role: "user",
    status: "active",
    created_at: "2026-01-01T00:00:00",
    invited_at: null,
    invite_expires_at: null,
    accepted_terms_at: "2026-01-02T00:00:00",
    last_seen_at: "2026-01-03T00:00:00",
    monthly_analysis_limit: 100,
    monthly_analysis_used: 5,
    monthly_chat_limit: 500,
    monthly_chat_used: 10,
  },
  {
    id: "u2",
    email: "invited@example.com",
    role: "user",
    status: "invited",
    created_at: "2026-01-01T00:00:00",
    invited_at: "2026-01-01T00:00:00",
    invite_expires_at: "2026-01-02T00:00:00",
    accepted_terms_at: null,
    last_seen_at: null,
    monthly_analysis_limit: 100,
    monthly_analysis_used: 0,
    monthly_chat_limit: 500,
    monthly_chat_used: 0,
  },
  {
    id: "u3",
    email: "disabled@example.com",
    role: "user",
    status: "disabled",
    created_at: "2026-01-01T00:00:00",
    invited_at: null,
    invite_expires_at: null,
    accepted_terms_at: "2026-01-02T00:00:00",
    last_seen_at: "2026-01-03T00:00:00",
    monthly_analysis_limit: 100,
    monthly_analysis_used: 0,
    monthly_chat_limit: 500,
    monthly_chat_used: 0,
  },
];

describe("AdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists every user returned by GET /admin/users", async () => {
    apiFetch.mockResolvedValue(USERS);
    renderFresh(<AdminPage />);

    await waitFor(() => expect(screen.getByText("active@example.com")).toBeInTheDocument());
    expect(screen.getByText("invited@example.com")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/admin/users");
  });

  it("resends an invite and refetches the list", async () => {
    apiFetch.mockResolvedValueOnce(USERS).mockResolvedValueOnce(undefined).mockResolvedValueOnce(USERS);
    renderFresh(<AdminPage />);

    await waitFor(() => expect(screen.getByText("invited@example.com")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /resend/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/admin/users/u2/resend", expect.objectContaining({ method: "POST" })),
    );
  });

  it("shows the backend's error detail inline when a resend fails", async () => {
    apiFetch
      .mockResolvedValueOnce(USERS)
      .mockRejectedValueOnce(new FakeApiError(409, "Invite already pending"));
    renderFresh(<AdminPage />);

    await waitFor(() => expect(screen.getByText("invited@example.com")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /resend/i }));

    await waitFor(() => expect(screen.getByText("Invite already pending")).toBeInTheDocument());
  });

  it("revokes an invite and refetches the list", async () => {
    apiFetch.mockResolvedValueOnce(USERS).mockResolvedValueOnce(undefined).mockResolvedValueOnce(USERS);
    renderFresh(<AdminPage />);

    await waitFor(() => expect(screen.getByText("invited@example.com")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /revoke/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/admin/users/u2/revoke", expect.objectContaining({ method: "POST" })),
    );
  });

  it("enables a disabled user and refetches the list", async () => {
    apiFetch.mockResolvedValueOnce(USERS).mockResolvedValueOnce(undefined).mockResolvedValueOnce(USERS);
    renderFresh(<AdminPage />);

    await waitFor(() => expect(screen.getByText("disabled@example.com")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /enable/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/admin/users/u3/enable", expect.objectContaining({ method: "POST" })),
    );
  });

  it("filters the list by status via the filter chips", async () => {
    apiFetch.mockResolvedValue(USERS);
    renderFresh(<AdminPage />);

    await waitFor(() => expect(screen.getByText("active@example.com")).toBeInTheDocument());
    expect(screen.getByText("invited@example.com")).toBeInTheDocument();
    expect(screen.getByText("disabled@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByText(/^Active/));

    await waitFor(() => {
      expect(screen.getByText("active@example.com")).toBeInTheDocument();
      expect(screen.queryByText("invited@example.com")).not.toBeInTheDocument();
      expect(screen.queryByText("disabled@example.com")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/^All/));

    await waitFor(() => {
      expect(screen.getByText("active@example.com")).toBeInTheDocument();
      expect(screen.getByText("invited@example.com")).toBeInTheDocument();
      expect(screen.getByText("disabled@example.com")).toBeInTheDocument();
    });
  });

  it("opens the user detail drawer when an active row's details button is clicked", async () => {
    apiFetch.mockResolvedValue(USERS);
    renderFresh(<AdminPage />);

    await waitFor(() => expect(screen.getByText("active@example.com")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: /user details/i })[0]);

    // UserDetailDrawer renders a "Remove user" heading once open for this user.
    await waitFor(() => expect(screen.getByText(/remove user/i)).toBeInTheDocument());
  });

  it("opens the user detail drawer for a disabled row too", async () => {
    apiFetch.mockResolvedValue(USERS);
    renderFresh(<AdminPage />);

    await waitFor(() => expect(screen.getByText("disabled@example.com")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: /user details/i })[1]);

    await waitFor(() => expect(screen.getByText(/remove user/i)).toBeInTheDocument());
  });
});
