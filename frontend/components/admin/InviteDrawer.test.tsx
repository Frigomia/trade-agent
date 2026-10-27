import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const apiFetch = vi.fn();
// The class must be created inside vi.hoisted (not as a plain top-level `class` statement) —
// vi.mock's factory is hoisted above the import of "./InviteDrawer", which transitively imports
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

import { InviteDrawer } from "./InviteDrawer";

describe("InviteDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks backdrop and Escape during an invite, then unlocks on failure", async () => {
    let fail!: (reason: Error) => void;
    apiFetch.mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
    const onClose = vi.fn();
    render(<InviteDrawer open onClose={onClose} onInvited={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send invite/i }));
    const paper = document.querySelector(".MuiDrawer-paper")!;
    expect(paper).toHaveAttribute("aria-busy", "true");
    fireEvent.click(document.querySelector(".MuiBackdrop-root")!);
    fireEvent.keyDown(paper, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fail(new FakeApiError(0, "The request timed out."));
    expect(await screen.findByText("The request timed out.")).toBeInTheDocument();
    expect(paper).toHaveAttribute("aria-busy", "false");
    fireEvent.keyDown(paper, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("invites the entered email and calls onInvited + onClose on success", async () => {
    apiFetch.mockResolvedValue({ id: "u1" });
    const onInvited = vi.fn();
    const onClose = vi.fn();
    render(<InviteDrawer open onClose={onClose} onInvited={onInvited} />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send invite/i }));

    await waitFor(() => expect(onInvited).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith(
      "/admin/users/invite",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "new@example.com" }) }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the backend's error detail on a 409 and does not close", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(409, "That address already has access"));
    const onClose = vi.fn();
    render(<InviteDrawer open onClose={onClose} onInvited={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "existing@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send invite/i }));

    await waitFor(() =>
      expect(screen.getByText("That address already has access")).toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
