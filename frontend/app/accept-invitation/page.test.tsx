import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const getSession = vi.fn();
const updateUser = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession, updateUser } }),
}));

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import AcceptInvitationPage from "./page";

describe("AcceptInvitationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an expired-link message when there is no session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    render(<AcceptInvitationPage />);

    await waitFor(() =>
      expect(screen.getByText(/no longer valid/i)).toBeInTheDocument(),
    );
  });

  it("sets the password and accepts terms on submit", async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { email: "sara.m@example.com" } } },
    });
    updateUser.mockResolvedValue({ error: null });
    apiFetch.mockResolvedValue({ status: "active" });

    render(<AcceptInvitationPage />);
    await waitFor(() => expect(screen.getByDisplayValue("sara.m@example.com")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/create password/i), { target: { value: "verystrongpw123" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "verystrongpw123" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/today"));
    expect(updateUser).toHaveBeenCalledWith({ password: "verystrongpw123" });
    expect(apiFetch).toHaveBeenCalledWith(
      "/me/accept",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows an error and does not submit when the passwords don't match", async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { email: "sara.m@example.com" } } },
    });
    render(<AcceptInvitationPage />);
    await waitFor(() => expect(screen.getByDisplayValue("sara.m@example.com")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/create password/i), { target: { value: "aaaaaaaaaaaa" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "bbbbbbbbbbbb" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(screen.getByText(/don't match/i)).toBeInTheDocument());
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("keeps the submit button disabled until the terms box is checked", async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { email: "sara.m@example.com" } } },
    });
    render(<AcceptInvitationPage />);
    await waitFor(() => expect(screen.getByDisplayValue("sara.m@example.com")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /create account/i })).toBeDisabled();
  });
});
