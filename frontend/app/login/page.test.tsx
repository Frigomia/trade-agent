import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const signInWithPassword = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword, signOut } }),
}));

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import LoginPage from "./page";

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /today on a successful sign-in", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    apiFetch.mockResolvedValue({});
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/today"));
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "a@example.com", password: "secret123" });
  });

  it("signs the user back out and shows a calm message when the account has no access", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    apiFetch.mockRejectedValue(new Error("Forbidden"));
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(screen.getByText(/this account doesn't have access/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows an inline error on a wrong password, and does not redirect", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByText(/email or password is incorrect/i)).toBeInTheDocument(),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("clears the whole SWR cache before signing in", async () => {
    const cache = new Map<string, unknown>([
      ["/plans/orders/open", { data: { open_lines: 3, plans: [] } }],
      ["/portfolio/summary", { data: { holdings: [] } }],
    ]);
    const cached = () => [...cache.values()].map((v) => (v as { data?: unknown }).data);
    let atSignIn: unknown[] = [];
    signInWithPassword.mockImplementation(async () => {
      atSignIn = cached();
      return { error: null };
    });
    apiFetch.mockResolvedValue({});
    render(
      <SWRConfig value={{ provider: () => cache as never }}>
        <LoginPage />
      </SWRConfig>,
    );

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/today"));
    expect(atSignIn).toEqual([undefined, undefined]);
  });

  it("links to /reset-password", () => {
    render(<LoginPage />);
    expect(screen.getByRole("link", { name: /forgot password/i })).toHaveAttribute(
      "href",
      "/reset-password",
    );
  });
});
