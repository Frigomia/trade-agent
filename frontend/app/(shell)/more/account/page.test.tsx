import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

const mutateMock = vi.fn();
vi.mock("swr", async (orig) => ({ ...(await orig<typeof import("swr")>()), mutate: (...a: unknown[]) => mutateMock(...a) }));
const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
const signOut = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut } }) }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/account/ChangePasswordForm", () => ({ ChangePasswordForm: () => "change-password" }));
vi.mock("@/components/account/DataActions", () => ({ DataActions: ({ email }: { email: string }) => `data-actions:${email}` }));

import AccountPage from "./page";

function renderFresh() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AccountPage />
    </SWRConfig>,
  );
}

describe("AccountPage", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    signOut.mockReset();
    mutateMock.mockReset();
    push.mockReset();
    apiFetch.mockImplementation(async (path: string) =>
      path === "/me"
        ? { email: "me@example.com", role: "user", status: "active" }
        : { analysis_runs: { used: 2, limit: 10 }, chat_messages: { used: 1, limit: 50 } },
    );
  });

  it("shows the email, usage, section links and the child sections", async () => {
    renderFresh();
    expect(await screen.findByText("me@example.com")).toBeInTheDocument();
    expect(await screen.findByText("2 / 10")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /track record/i })).toHaveAttribute("href", "/more/track-record");
    expect(screen.getByRole("link", { name: /backtests/i })).toHaveAttribute("href", "/more/backtests");
    expect(screen.getByRole("link", { name: /preferences/i })).toHaveAttribute("href", "/more/preferences");
    expect(screen.getByText("change-password")).toBeInTheDocument();
    expect(screen.getByText("data-actions:me@example.com")).toBeInTheDocument();
  });

  it("signs out and returns to login", async () => {
    signOut.mockResolvedValue({});
    renderFresh();
    await screen.findByText("me@example.com");
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(signOut).toHaveBeenCalled();
    expect(mutateMock).toHaveBeenCalledWith(expect.any(Function), undefined, { revalidate: false });
    expect(mutateMock.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0]);
  });

  it("shows an error when the account cannot load", async () => {
    apiFetch.mockRejectedValue(new Error("boom"));
    renderFresh();
    expect(await screen.findByText(/could not load your account/i)).toBeInTheDocument();
  });

  it("does not render data actions when the account cannot load", async () => {
    apiFetch.mockRejectedValue(new Error("boom"));
    renderFresh();
    await screen.findByText(/could not load your account/i);
    expect(screen.queryByText(/data-actions/)).not.toBeInTheDocument();
  });
});
