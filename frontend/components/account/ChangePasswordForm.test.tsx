import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const updateUser = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { updateUser } }) }));

import { ChangePasswordForm } from "./ChangePasswordForm";

function fill(pw: string, confirm: string) {
  fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: pw } });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: /change password/i }));
}

describe("ChangePasswordForm", () => {
  beforeEach(() => updateUser.mockReset());

  it("blocks a short password and a mismatch without calling Supabase", () => {
    render(<ChangePasswordForm />);
    fill("short", "short");
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    fill("longenough1", "different1");
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("changes the password and clears the fields", async () => {
    updateUser.mockResolvedValue({ error: null });
    render(<ChangePasswordForm />);
    fill("longenough1", "longenough1");
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: "longenough1" }));
    expect(await screen.findByText(/password changed/i)).toBeInTheDocument();
    expect((screen.getByLabelText(/^new password/i) as HTMLInputElement).value).toBe("");
  });

  it("shows Supabase's message when it refuses", async () => {
    updateUser.mockResolvedValue({ error: { message: "New password should be different from the old password." } });
    render(<ChangePasswordForm />);
    fill("longenough1", "longenough1");
    expect(await screen.findByText(/should be different from the old password/i)).toBeInTheDocument();
    expect(screen.queryByText(/password changed/i)).not.toBeInTheDocument();
  });
});
