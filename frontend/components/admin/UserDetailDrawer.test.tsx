import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AdminUserOut } from "@/lib/api/admin-types";

const apiFetch = vi.fn();
// The class must be created inside vi.hoisted (not as a plain top-level `class` statement) —
// vi.mock's factory is hoisted above the import of "./UserDetailDrawer", which transitively
// imports "@/lib/api/client" and triggers the factory before a plain top-level class declaration
// would have run, throwing a "Cannot access before initialization" TDZ error.
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

import { UserDetailDrawer } from "./UserDetailDrawer";

const USER: AdminUserOut = {
  id: "u1",
  email: "active@example.com",
  role: "user",
  status: "active",
  created_at: "2026-01-01T00:00:00",
  invited_at: null,
  invite_expires_at: null,
  accepted_terms_at: "2026-01-02T00:00:00",
  last_seen_at: "2026-01-03T00:00:00",
  monthly_analysis_limit: 100,
  monthly_analysis_used: 5,
  monthly_chat_limit: 500,
  monthly_chat_used: 10,
};

const DISABLED_USER: AdminUserOut = {
  ...USER,
  id: "u2",
  email: "disabled@example.com",
  status: "disabled",
};

describe("UserDetailDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when user is null", () => {
    const { container } = render(<UserDetailDrawer user={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("has a Close button that closes the sheet", () => {
    const onClose = vi.fn();
    render(<UserDetailDrawer user={USER} onClose={onClose} onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<UserDetailDrawer user={USER} onClose={onClose} onChanged={vi.fn()} />);

    fireEvent.keyDown(screen.getByRole("presentation"), { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("sets an analysis-run limit override without touching chat_limit", async () => {
    apiFetch.mockResolvedValue(USER);
    const onChanged = vi.fn();
    render(<UserDetailDrawer user={USER} onClose={vi.fn()} onChanged={onChanged} />);

    fireEvent.change(screen.getByLabelText(/analysis runs/i), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: /save limits/i }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [, init] = apiFetch.mock.calls.find(([path]) => path === "/admin/users/u1/limits")!;
    expect(JSON.parse((init as { body: string }).body)).toEqual({ analysis_limit: 50 });
  });

  it("does not call the limits endpoint when Save limits is clicked with both fields empty", () => {
    render(<UserDetailDrawer user={USER} onClose={vi.fn()} onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /save limits/i }));

    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/limits"),
      expect.anything(),
    );
  });

  it("clears a limit by sending an explicit null, distinct from leaving it untouched", async () => {
    apiFetch.mockResolvedValue(USER);
    render(<UserDetailDrawer user={USER} onClose={vi.fn()} onChanged={vi.fn()} />);

    fireEvent.click(screen.getAllByRole("button", { name: /use default/i })[0]);

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/admin/users/u1/limits",
        expect.objectContaining({ body: JSON.stringify({ analysis_limit: null }) }),
      ),
    );
  });

  it("keeps Remove disabled until the typed email matches exactly", () => {
    render(<UserDetailDrawer user={USER} onClose={vi.fn()} onChanged={vi.fn()} />);

    const removeButton = screen.getByRole("button", { name: /^remove$/i });
    expect(removeButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/confirm email/i), { target: { value: "wrong@example.com" } });
    expect(removeButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/confirm email/i), { target: { value: USER.email } });
    expect(removeButton).not.toBeDisabled();
  });

  it("disables an active user and closes the drawer", async () => {
    apiFetch.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    const onClose = vi.fn();
    render(<UserDetailDrawer user={USER} onClose={onClose} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole("button", { name: /^disable$/i }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith(
      "/admin/users/u1/disable",
      expect.objectContaining({ method: "POST" }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("enables a disabled user and closes the drawer", async () => {
    apiFetch.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    const onClose = vi.fn();
    render(<UserDetailDrawer user={DISABLED_USER} onClose={onClose} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole("button", { name: /^enable$/i }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith(
      "/admin/users/u2/enable",
      expect.objectContaining({ method: "POST" }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("calls DELETE with confirm_email once the typed value matches", async () => {
    apiFetch.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    const onClose = vi.fn();
    render(<UserDetailDrawer user={USER} onClose={onClose} onChanged={onChanged} />);

    fireEvent.change(screen.getByLabelText(/confirm email/i), { target: { value: USER.email } });
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith(
      "/admin/users/u1",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ confirm_email: USER.email }),
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });
});
