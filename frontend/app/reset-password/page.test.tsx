import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));

const getSession = vi.fn();
const resetPasswordForEmail = vi.fn();
const updateUser = vi.fn();
const unsubscribe = vi.fn();
let authListener: ((event: string) => void) | undefined;
const onAuthStateChange = vi.fn((cb: (event: string) => void) => {
  authListener = cb;
  return { data: { subscription: { unsubscribe } } };
});
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession, resetPasswordForEmail, updateUser, onAuthStateChange } }),
}));

import ResetPasswordPage from "./page";

const SESSION = { access_token: "tok", user: { email: "me@example.com" } };

function clearRecoveryCookie() {
  document.cookie = "ta_recovery=; Max-Age=0; Path=/";
}

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authListener = undefined;
    clearRecoveryCookie();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    clearRecoveryCookie();
  });

  it("sends a reset email when there is no session yet (request mode)", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    resetPasswordForEmail.mockResolvedValue({ error: null });
    render(<ResetPasswordPage />);

    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => expect(screen.getByText(/check your email/i)).toBeInTheDocument());
    expect(resetPasswordForEmail).toHaveBeenCalledWith("a@example.com", {
      redirectTo: `${window.location.origin}/reset-password`,
    });
  });

  it("builds redirectTo from NEXT_PUBLIC_SITE_URL when set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.com/");
    getSession.mockResolvedValue({ data: { session: null } });
    resetPasswordForEmail.mockResolvedValue({ error: null });
    render(<ResetPasswordPage />);

    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalled());
    expect(resetPasswordForEmail).toHaveBeenCalledWith("a@example.com", {
      redirectTo: "https://app.example.com/reset-password",
    });
  });

  it("shows the form with the account email after the recovery redirect (cookie)", async () => {
    document.cookie = "ta_recovery=1; Path=/";
    getSession.mockResolvedValue({ data: { session: SESSION } });
    updateUser.mockResolvedValue({ error: null });
    render(<ResetPasswordPage />);

    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeInTheDocument());
    expect(screen.getByText("me@example.com")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: "newpassword123" } });
    fireEvent.click(screen.getByRole("button", { name: /save password/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/today"));
    expect(updateUser).toHaveBeenCalledWith({ password: "newpassword123" });
    expect(document.cookie).not.toContain("ta_recovery");
  });

  it("shows the form after a PASSWORD_RECOVERY auth event", async () => {
    getSession.mockResolvedValue({ data: { session: SESSION } });
    render(<ResetPasswordPage />);

    await waitFor(() => expect(replace).toHaveBeenCalled());
    replace.mockClear();
    act(() => authListener?.("PASSWORD_RECOVERY"));

    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeInTheDocument());
  });

  it("sends a signed-in user without a recovery context to the account page, no form", async () => {
    getSession.mockResolvedValue({ data: { session: SESSION } });
    render(<ResetPasswordPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/more/account"));
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
  });

  it("ignores a recovery cookie when there is no session", async () => {
    document.cookie = "ta_recovery=1; Path=/";
    getSession.mockResolvedValue({ data: { session: null } });
    render(<ResetPasswordPage />);

    await waitFor(() => expect(screen.getByRole("button", { name: /send reset link/i })).toBeInTheDocument());
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
  });
});
