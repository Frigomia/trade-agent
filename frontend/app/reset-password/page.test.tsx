import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const getSession = vi.fn();
const resetPasswordForEmail = vi.fn();
const updateUser = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession, resetPasswordForEmail, updateUser } }),
}));

import ResetPasswordPage from "./page";

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a reset email when there is no session yet (request mode)", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    resetPasswordForEmail.mockResolvedValue({ error: null });
    render(<ResetPasswordPage />);

    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => expect(screen.getByText(/check your email/i)).toBeInTheDocument());
    expect(resetPasswordForEmail).toHaveBeenCalledWith(
      "a@example.com",
      expect.objectContaining({ redirectTo: expect.stringContaining("/reset-password") }),
    );
  });

  it("sets the new password and redirects when a reset session exists (confirm mode)", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
    updateUser.mockResolvedValue({ error: null });
    render(<ResetPasswordPage />);

    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: "newpassword123" } });
    fireEvent.click(screen.getByRole("button", { name: /save password/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/today"));
    expect(updateUser).toHaveBeenCalledWith({ password: "newpassword123" });
  });
});
