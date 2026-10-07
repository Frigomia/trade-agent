import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const { FakeApiError } = vi.hoisted(() => ({
  FakeApiError: class extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
    }
  },
}));
vi.mock("@/lib/api/client", () => ({ ApiError: FakeApiError }));

import type { TelegramStatus } from "@/lib/telegram";

const hook = vi.hoisted(() => ({
  status: undefined as unknown,
  error: undefined as unknown,
  waiting: false,
  connect: vi.fn(),
  cancel: vi.fn(),
  update: vi.fn(),
  disconnect: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/telegram", () => ({ useTelegram: () => ({ isLoading: false, ...hook }) }));

import { TelegramPanel } from "./TelegramPanel";

const base: TelegramStatus = {
  configured: true,
  linked: false,
  status: null,
  digest_enabled: true,
  moves_enabled: false,
  move_threshold_pct: 5,
  bot_username: "trade_bot",
};
const connected: TelegramStatus = { ...base, linked: true, status: "ok" };
const URL_ = "https://t.me/trade_bot?start=CODE123";

let open: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.assign(hook, { status: base, error: undefined, waiting: false });
  hook.connect.mockReset().mockResolvedValue({ url: URL_, expires_in: 600 });
  hook.cancel.mockReset();
  hook.update.mockReset().mockResolvedValue(undefined);
  hook.disconnect.mockReset().mockResolvedValue(undefined);
  open = vi.fn().mockReturnValue(null); // like real noopener opens: null either way
  vi.stubGlobal("open", open);
});
afterEach(() => vi.unstubAllGlobals());

describe("TelegramPanel", () => {
  it("not configured: only the title and the unavailable line, no preview", () => {
    hook.status = { ...base, configured: false };
    render(<TelegramPanel />);
    expect(screen.getByRole("heading", { name: "Telegram" })).toBeInTheDocument();
    expect(screen.getByText("Telegram is not available on this server.")).toBeInTheDocument();
    expect(screen.queryByText("What a message looks like")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("not connected: pitch, note, chip, and the static preview", () => {
    render(<TelegramPanel />);
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByText("Get a short message on weekday mornings when there is something to look at.")).toBeInTheDocument();
    expect(screen.getByText("Messages list tickers and actions only, never amounts or reasoning. Advisory only.")).toBeInTheDocument();
    expect(screen.getByText("What a message looks like")).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/app\.example\.com\/today/)).toBeInTheDocument();
    expect(screen.getByText("Advisory only. Nothing is sent to a broker.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /app\.example\.com/ })).not.toBeInTheDocument();
  });

  it("Connect opens the returned link in a new tab with noopener,noreferrer", async () => {
    render(<TelegramPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Telegram" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(URL_, "_blank", "noopener,noreferrer"));
  });

  it("disables Connect while the request is pending so only one link is issued", async () => {
    let release!: (v: unknown) => void;
    hook.connect.mockReturnValue(new Promise((r) => (release = r)));
    render(<TelegramPanel />);
    const btn = screen.getByRole("button", { name: "Connect Telegram" });
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    fireEvent.click(btn);
    expect(hook.connect).toHaveBeenCalledTimes(1);
    release({ url: URL_, expires_in: 600 });
    await waitFor(() => expect(open).toHaveBeenCalled());
  });

  it("shows the backend detail when connect fails and opens nothing", async () => {
    hook.connect.mockRejectedValue(new FakeApiError(429, "Too many links, try again later."));
    render(<TelegramPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Telegram" }));
    expect(await screen.findByText("Too many links, try again later.")).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  async function startWaiting(rerender: (ui: ReactElement) => void) {
    fireEvent.click(screen.getByRole("button", { name: /^(Connect Telegram|Reconnect)$/ }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    hook.waiting = true;
    rerender(<TelegramPanel />);
  }

  it("waiting: announced status, one real link to open Telegram, and Cancel", async () => {
    const { rerender } = render(<TelegramPanel />);
    await startWaiting(rerender);

    expect(screen.getByRole("status")).toHaveTextContent("Waiting for you to press Start in Telegram…");
    expect(screen.getByText("The link works for 10 minutes.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Telegram" })).not.toBeInTheDocument();

    const links = screen.getAllByRole("link", { name: /open telegram/i });
    expect(links).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /open telegram/i })).not.toBeInTheDocument();
    expect(links[0]).toHaveAccessibleName("Open Telegram again");
    expect(links[0]).toHaveAttribute("href", URL_);
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(open).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(hook.cancel).toHaveBeenCalled();
  });

  it("Cancel clears the link and returns to the connect card", async () => {
    const { rerender } = render(<TelegramPanel />);
    await startWaiting(rerender);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    hook.waiting = false;
    rerender(<TelegramPanel />);
    expect(screen.getByRole("button", { name: "Connect Telegram" })).toBeInTheDocument();
    hook.waiting = true; // a later wait must not resurrect the old link
    rerender(<TelegramPanel />);
    expect(screen.queryByRole("link", { name: /open telegram/i })).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("CODE123");
  });

  it("reconnecting from blocked: waiting card with the link; ok clears it; a new block shows the blocked card", async () => {
    hook.status = { ...connected, status: "blocked" };
    const { rerender } = render(<TelegramPanel />);
    await startWaiting(rerender);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for you to press Start in Telegram…");
    const links = screen.getAllByRole("link", { name: /open telegram/i });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toContain("CODE123");
    expect(screen.queryByRole("button", { name: "Reconnect" })).not.toBeInTheDocument();

    hook.status = connected; // the hook clears the wait when the status turns ok
    hook.waiting = false;
    rerender(<TelegramPanel />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("CODE123");

    hook.status = { ...connected, status: "blocked" };
    rerender(<TelegramPanel />);
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open telegram/i })).not.toBeInTheDocument();
  });

  it("cancel from the blocked reconnect returns to the blocked card", async () => {
    hook.status = { ...connected, status: "blocked" };
    const { rerender } = render(<TelegramPanel />);
    await startWaiting(rerender);
    hook.waiting = false;
    rerender(<TelegramPanel />);
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open telegram/i })).not.toBeInTheDocument();
  });

  describe("focus after a state change", () => {
    async function flip() {
      const { rerender } = render(<TelegramPanel />);
      await startWaiting(rerender);
      return rerender;
    }

    it("is not stolen from a field outside the panel", async () => {
      const outside = document.createElement("input");
      document.body.appendChild(outside);
      const rerender = await flip();
      outside.focus();
      hook.status = connected;
      hook.waiting = false;
      rerender(<TelegramPanel />);
      expect(outside).toHaveFocus();
      outside.remove();
    });

    it("moves into the panel when focus was inside it", async () => {
      const rerender = await flip();
      screen.getByRole("button", { name: "Cancel" }).focus();
      hook.status = connected;
      hook.waiting = false;
      rerender(<TelegramPanel />);
      expect(screen.getByRole("heading", { name: "Telegram" })).toHaveFocus();
    });

    it("moves into the panel when focus was on the body", async () => {
      const rerender = await flip();
      (document.activeElement as HTMLElement).blur();
      hook.status = connected;
      hook.waiting = false;
      rerender(<TelegramPanel />);
      expect(screen.getByRole("heading", { name: "Telegram" })).toHaveFocus();
    });
  });

  it("shows a 503 detail inline", async () => {
    hook.connect.mockRejectedValue(new FakeApiError(503, "Telegram is not set up on this server."));
    render(<TelegramPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Telegram" }));
    expect(await screen.findByText("Telegram is not set up on this server.")).toBeInTheDocument();
  });

  it("the threshold error is tied to the field", async () => {
    hook.status = connected;
    render(<TelegramPanel />);
    const field = screen.getByRole("textbox", { name: "Move threshold" });
    fireEvent.change(field, { target: { value: "99" } });
    fireEvent.blur(field);
    await screen.findByText(/one decimal at most/i);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(/one decimal at most/i);
  });

  it("the threshold is disabled while a switch save is in flight", async () => {
    hook.status = connected;
    hook.update.mockReturnValue(new Promise(() => {}));
    render(<TelegramPanel />);
    fireEvent.click(screen.getByRole("switch", { name: "Price moves" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Move threshold" })).toBeDisabled());
  });

  it("connected: chip, two labelled switches with hints, threshold with suffix, note, Disconnect", () => {
    hook.status = connected;
    render(<TelegramPanel />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    const digest = screen.getByRole("switch", { name: "Morning digest" });
    expect(digest).toBeChecked();
    expect(digest).toHaveAccessibleDescription("New recommendations from the automatic analysis.");
    const moves = screen.getByRole("switch", { name: "Price moves" });
    expect(moves).not.toBeChecked();
    expect(moves).toHaveAccessibleDescription("Tickers that moved at least the threshold since the previous close.");
    const field = screen.getByRole("textbox", { name: "Move threshold" });
    expect(field).toHaveValue("5");
    expect(field).toHaveAccessibleDescription("1 to 50");
    expect(screen.getByText("%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(screen.getByText("What a message looks like")).toBeInTheDocument();
  });

  it("a switch saves on toggle and shows the new value at once", async () => {
    hook.status = connected;
    let release!: () => void;
    hook.update.mockReturnValue(new Promise<void>((r) => (release = r)));
    render(<TelegramPanel />);
    fireEvent.click(screen.getByRole("switch", { name: "Price moves" }));
    expect(hook.update).toHaveBeenCalledWith({ moves_enabled: true });
    expect(screen.getByRole("switch", { name: "Price moves" })).toBeChecked();
    release();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Price moves" })).not.toBeDisabled());
  });

  it("a failed switch save rolls back and shows the error", async () => {
    hook.status = connected;
    hook.update.mockRejectedValue(new FakeApiError(500, "Could not save."));
    render(<TelegramPanel />);
    fireEvent.click(screen.getByRole("switch", { name: "Price moves" }));
    expect(await screen.findByText("Could not save.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Price moves" })).not.toBeChecked();
  });

  it("the threshold saves on blur when valid", async () => {
    hook.status = connected;
    render(<TelegramPanel />);
    const field = screen.getByRole("textbox", { name: "Move threshold" });
    fireEvent.change(field, { target: { value: "7.5" } });
    fireEvent.blur(field);
    await waitFor(() => expect(hook.update).toHaveBeenCalledWith({ move_threshold_pct: 7.5 }));
  });

  it("the threshold saves on Enter, once", async () => {
    hook.status = connected;
    render(<TelegramPanel />);
    const field = screen.getByRole("textbox", { name: "Move threshold" });
    field.focus();
    fireEvent.change(field, { target: { value: "10" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(hook.update).toHaveBeenCalledWith({ move_threshold_pct: 10 }));
    expect(hook.update).toHaveBeenCalledTimes(1);
  });

  it("accepts a comma decimal separator", async () => {
    hook.status = connected;
    render(<TelegramPanel />);
    const field = screen.getByRole("textbox", { name: "Move threshold" });
    fireEvent.change(field, { target: { value: "7,5" } });
    fireEvent.blur(field);
    await waitFor(() => expect(hook.update).toHaveBeenCalledWith({ move_threshold_pct: 7.5 }));
  });

  it.each(["0", "0.5", "51", "5.55", "7,55", ""])("rejects %j: inline error, no save, saved value restored", async (v) => {
    hook.status = connected;
    render(<TelegramPanel />);
    const field = screen.getByRole("textbox", { name: "Move threshold" });
    fireEvent.change(field, { target: { value: v } });
    fireEvent.blur(field);
    expect(await screen.findByText(/1 to 50, one decimal at most/i)).toBeInTheDocument();
    expect(hook.update).not.toHaveBeenCalled();
    expect(field).toHaveValue("5");
  });

  it("leaves the threshold alone when nothing changed", () => {
    hook.status = connected;
    render(<TelegramPanel />);
    const field = screen.getByRole("textbox", { name: "Move threshold" });
    fireEvent.focus(field);
    fireEvent.blur(field);
    expect(hook.update).not.toHaveBeenCalled();
  });

  it("a failed threshold save shows the error and restores the saved value", async () => {
    hook.status = connected;
    hook.update.mockRejectedValue(new FakeApiError(500, "Could not save."));
    render(<TelegramPanel />);
    const field = screen.getByRole("textbox", { name: "Move threshold" });
    fireEvent.change(field, { target: { value: "9" } });
    fireEvent.blur(field);
    expect(await screen.findByText("Could not save.")).toBeInTheDocument();
    expect(field).toHaveValue("5");
  });

  it("Disconnect asks first, then disconnects", async () => {
    hook.status = connected;
    render(<TelegramPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog");
    expect(hook.disconnect).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep connected" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(hook.disconnect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Disconnect Telegram" }));
    await waitFor(() => expect(hook.disconnect).toHaveBeenCalledTimes(1));
  });

  it("a failed disconnect keeps the dialog open with the error", async () => {
    hook.status = connected;
    hook.disconnect.mockRejectedValue(new FakeApiError(500, "Could not disconnect."));
    render(<TelegramPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Disconnect Telegram" }));
    expect(await screen.findByText("Could not disconnect.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("blocked: Needs attention, the warning, Reconnect and Disconnect", async () => {
    hook.status = { ...connected, status: "blocked" };
    render(<TelegramPanel />);
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText("Telegram stopped receiving messages. Reconnect to get them again.")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(URL_, "_blank", "noopener,noreferrer"));
  });

  it("never shows a chat id", () => {
    hook.status = { ...connected, chat_id: 987654321 };
    render(<TelegramPanel />);
    expect(document.body.textContent).not.toContain("987654321");
    expect(document.body.textContent).not.toMatch(/chat id/i);
  });

  it("a status load failure offers Try again", () => {
    hook.status = undefined;
    hook.error = new Error("boom");
    render(<TelegramPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(hook.refresh).toHaveBeenCalled();
  });
});
