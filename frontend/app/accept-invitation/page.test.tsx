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

const STRONG = "verystrongpw123";

function signedIn(sessionEmail: string, me: { email: string; status: string } | Error) {
  getSession.mockResolvedValue({ data: { session: { user: { email: sessionEmail } } } });
  apiFetch.mockImplementation((path: string) => {
    if (path === "/me") return me instanceof Error ? Promise.reject(me) : Promise.resolve(me);
    return Promise.resolve({ status: "active" });
  });
}

async function renderInvitedForm() {
  signedIn("sara.m@example.com", { email: "sara.m@example.com", status: "invited" });
  render(<AcceptInvitationPage />);
  await waitFor(() => expect(screen.getByDisplayValue("sara.m@example.com")).toBeInTheDocument());
}

function fill(password: string, confirm: string, terms = true) {
  fireEvent.change(screen.getByLabelText(/create password/i), { target: { value: password } });
  fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: confirm } });
  if (terms) fireEvent.click(screen.getByRole("checkbox"));
}

const submitButton = () => screen.getByRole("button", { name: /create account/i });

describe("AcceptInvitationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an expired-link message when there is no session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    render(<AcceptInvitationPage />);

    await waitFor(() => expect(screen.getByText(/no longer valid/i)).toBeInTheDocument());
  });

  it("shows the invited person's email from the account, not from another session", async () => {
    signedIn("admin@example.com", { email: "sara.m@example.com", status: "invited" });
    render(<AcceptInvitationPage />);

    await waitFor(() => expect(screen.getByDisplayValue("sara.m@example.com")).toBeInTheDocument());
    expect(screen.queryByDisplayValue("admin@example.com")).not.toBeInTheDocument();
  });

  it("refuses the form when the signed-in account is not an invited one", async () => {
    signedIn("admin@example.com", { email: "admin@example.com", status: "active" });
    render(<AcceptInvitationPage />);

    await waitFor(() => expect(screen.getByText(/no longer valid/i)).toBeInTheDocument());
    expect(screen.queryByLabelText(/create password/i)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("admin@example.com")).not.toBeInTheDocument();
  });

  it("refuses the form when the account cannot be loaded", async () => {
    signedIn("sara.m@example.com", new Error("boom"));
    render(<AcceptInvitationPage />);

    await waitFor(() => expect(screen.getByText(/no longer valid/i)).toBeInTheDocument());
    expect(screen.queryByLabelText(/create password/i)).not.toBeInTheDocument();
  });

  it("sets the password and accepts terms on submit", async () => {
    updateUser.mockResolvedValue({ error: null });
    await renderInvitedForm();

    fill(STRONG, STRONG);
    fireEvent.click(submitButton());

    await waitFor(() => expect(push).toHaveBeenCalledWith("/today"));
    expect(updateUser).toHaveBeenCalledWith({ password: STRONG });
    expect(apiFetch).toHaveBeenCalledWith(
      "/me/accept",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("keeps the submit button disabled while the form is empty", async () => {
    await renderInvitedForm();

    expect(submitButton()).toBeDisabled();
  });

  it("keeps the submit button disabled until the terms box is checked", async () => {
    await renderInvitedForm();

    fill(STRONG, STRONG, false);

    expect(submitButton()).toBeDisabled();
  });

  it("keeps the submit button disabled for a short password and says why", async () => {
    await renderInvitedForm();

    fill("short", "short");

    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it("keeps the submit button disabled and says so when the passwords don't match", async () => {
    await renderInvitedForm();

    fill("aaaaaaaaaaaa", "bbbbbbbbbbbb");

    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(/don't match/i)).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("enables the submit button once the form is valid", async () => {
    await renderInvitedForm();

    fill(STRONG, STRONG);

    expect(submitButton()).toBeEnabled();
  });
});
