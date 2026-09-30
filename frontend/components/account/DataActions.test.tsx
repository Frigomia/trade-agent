import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const apiFetch = vi.fn();
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
const signOut = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut } }) }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const downloadJson = vi.fn();
vi.mock("@/lib/download", () => ({ downloadJson: (...a: unknown[]) => downloadJson(...a) }));

import { DataActions } from "./DataActions";

function openAndType(value: string) {
  fireEvent.click(screen.getByRole("button", { name: /^delete my data$/i }));
  fireEvent.change(screen.getByLabelText(/type your email/i), { target: { value } });
}

describe("DataActions", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    signOut.mockReset();
    push.mockReset();
    downloadJson.mockReset();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
  });

  it("downloads the export under a dated filename", async () => {
    apiFetch.mockResolvedValue({ holdings: [] });
    render(<DataActions email="me@example.com" />);
    fireEvent.click(screen.getByRole("button", { name: /export my data/i }));
    await waitFor(() =>
      expect(downloadJson).toHaveBeenCalledWith("trade-agent-export-2026-09-30.json", { holdings: [] }),
    );
  });

  it("keeps delete disabled until the email matches, ignoring case and spaces", () => {
    render(<DataActions email="Me@Example.com" />);
    openAndType("");
    const confirmButton = screen.getByRole("button", { name: /confirm delete my data/i });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/type your email/i), { target: { value: "  me@example.com " } });
    expect(confirmButton).toBeEnabled();
  });

  it("says what is and is not deleted", () => {
    render(<DataActions email="me@example.com" />);
    fireEvent.click(screen.getByRole("button", { name: /^delete my data$/i }));
    expect(screen.getByText(/holdings, watchlist, trades, recommendations/i)).toBeInTheDocument();
    expect(screen.getByText(/sign-in and access stay/i)).toBeInTheDocument();
    expect(screen.getByText(/removing access is done by your administrator/i)).toBeInTheDocument();
  });

  it("deletes, then signs out and goes to login", async () => {
    apiFetch.mockResolvedValue(undefined);
    signOut.mockResolvedValue({});
    render(<DataActions email="me@example.com" />);
    openAndType("me@example.com");
    fireEvent.click(screen.getByRole("button", { name: /confirm delete my data/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(apiFetch).toHaveBeenCalledWith("/me/data", { method: "DELETE", body: JSON.stringify({ confirm: true }) });
    expect(signOut).toHaveBeenCalled();
  });

  it("does not sign out when the delete fails", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(500, "Could not delete"));
    render(<DataActions email="me@example.com" />);
    openAndType("me@example.com");
    fireEvent.click(screen.getByRole("button", { name: /confirm delete my data/i }));
    expect(await screen.findByText("Could not delete")).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
