import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const updateUser = vi.fn();
const getUser = vi.fn();
const signInWithPassword = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { updateUser, getUser, signInWithPassword } }),
}));

import { ChangePasswordForm } from "./ChangePasswordForm";

function fill(pw: string, confirm: string, current = "oldpassword1") {
  fireEvent.change(screen.getByLabelText(/^current password/i), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: pw } });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: /change password/i }));
}

describe("ChangePasswordForm", () => {
  beforeEach(() => {
    updateUser.mockReset();
    getUser.mockReset().mockResolvedValue({ data: { user: { email: "me@example.com" } } });
    signInWithPassword.mockReset().mockResolvedValue({ error: null });
  });

  it("blocks a short password and a mismatch without calling Supabase", () => {
    render(<ChangePasswordForm />);
    fill("short", "short");
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    fill("longenough1", "different1");
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
    expect(getUser).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("checks the current password, then changes it and clears all three fields", async () => {
    updateUser.mockResolvedValue({ error: null });
    render(<ChangePasswordForm />);
    fill("longenough1", "longenough1");
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: "longenough1" }));
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "me@example.com", password: "oldpassword1" });
    expect(signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(updateUser.mock.invocationCallOrder[0]);
    expect(await screen.findByText(/password changed/i)).toBeInTheDocument();
    for (const label of [/^current password/i, /^new password/i, /confirm new password/i]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe("");
    }
  });

  it("refuses a wrong current password without updating", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    render(<ChangePasswordForm />);
    fill("longenough1", "longenough1");
    expect(await screen.findByText("The current password is not correct.")).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
    expect(screen.queryByText(/password changed/i)).not.toBeInTheDocument();
  });

  it("shows an error when the session has no email", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    render(<ChangePasswordForm />);
    fill("longenough1", "longenough1");
    expect(await screen.findByText(/could not confirm your account/i)).toBeInTheDocument();
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("shows Supabase's message when it refuses", async () => {
    updateUser.mockResolvedValue({ error: { message: "New password should be different from the old password." } });
    render(<ChangePasswordForm />);
    fill("longenough1", "longenough1");
    expect(await screen.findByText(/should be different from the old password/i)).toBeInTheDocument();
    expect(screen.queryByText(/password changed/i)).not.toBeInTheDocument();
  });
});
