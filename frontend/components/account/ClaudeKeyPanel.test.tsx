import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

const { FakeApiError } = vi.hoisted(() => ({
  FakeApiError: class extends Error {
    status: number;
    code: string | null;
    detail: string;
    constructor(status: number, detail: string, code: string | null = null) {
      super(detail);
      this.status = status;
      this.detail = detail;
      this.code = code;
    }
  },
}));
const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a), ApiError: FakeApiError }));

import { ClaudeKeyPanel } from "./ClaudeKeyPanel";

type Status = { connected: boolean; last4: string | null; needs_attention: boolean };
let status: Status;

function renderPanel() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ClaudeKeyPanel />
    </SWRConfig>,
  );
}

describe("ClaudeKeyPanel", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    status = { connected: false, last4: null, needs_attention: false };
    apiFetch.mockImplementation(async (_p: string, init?: { method?: string }) => {
      if (init?.method === "DELETE") {
        status = { connected: false, last4: null, needs_attention: false };
        return undefined;
      }
      return status;
    });
  });

  it("not connected: copy, chip and a Connect Claude link to the guide", async () => {
    renderPanel();
    expect(await screen.findByText("Connect your own Claude account to use Chat and Run analysis.")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Claude" })).toHaveAttribute("href", "/more/connect-claude");
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("connected: chip, masked key with only the last four, Replace opens step 5", async () => {
    status = { connected: true, last4: "a1B2", needs_attention: false };
    renderPanel();
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("sk-ant-…a1B2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Replace" })).toHaveAttribute("href", "/more/connect-claude?step=5");
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("needs attention: reconnect text, Reconnect link to step 5 and Remove", async () => {
    status = { connected: true, last4: "a1B2", needs_attention: true };
    renderPanel();
    expect(await screen.findByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText(/Anthropic did not accept your key/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect" })).toHaveAttribute("href", "/more/connect-claude?step=5");
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("shows nothing wrong while loading", () => {
    apiFetch.mockImplementation(() => new Promise(() => {}));
    renderPanel();
    expect(screen.queryByText("Not connected")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect Claude" })).not.toBeInTheDocument();
  });

  it("a failed status load shows a retry that refetches", async () => {
    apiFetch.mockRejectedValueOnce(new Error("boom"));
    renderPanel();
    expect(await screen.findByText(/could not load your claude status/i)).toBeInTheDocument();
    expect(screen.queryByText("Not connected")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
  });

  it("Remove opens a labelled dialog; Keep it has focus and closes without deleting", async () => {
    status = { connected: true, last4: "a1B2", needs_attention: false };
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove your Claude key?" });
    expect(dialog).toHaveTextContent(
      "Chat and Run analysis stop working until you connect a key again. Your portfolio, watchlist and past recommendations stay as they are.",
    );
    expect(screen.getByRole("button", { name: "Keep it" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Remove key" })).not.toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(apiFetch).not.toHaveBeenCalledWith("/me/claude-key", expect.objectContaining({ method: "DELETE" }));
  });

  it("Escape closes the dialog", async () => {
    status = { connected: true, last4: "a1B2", needs_attention: false };
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("confirming deletes, refreshes the status and closes", async () => {
    status = { connected: true, last4: "a1B2", needs_attention: false };
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove key" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledWith("/me/claude-key", { method: "DELETE" });
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByText(/a1B2/)).not.toBeInTheDocument();
  });

  it("a failed remove keeps the dialog open with an inline error", async () => {
    status = { connected: true, last4: "a1B2", needs_attention: false };
    apiFetch.mockImplementation(async (_p: string, init?: { method?: string }) => {
      if (init?.method === "DELETE") throw new FakeApiError(500, "Could not remove the key.");
      return status;
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove key" }));
    expect(await screen.findByText("Could not remove the key.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
