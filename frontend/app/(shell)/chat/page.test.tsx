import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

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

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
}));

import ChatPage from "./page";

const HISTORY_PATH = "/chat/messages?session_id=main";
let history: unknown[] = [];
let usage = { analysis_runs: { used: 0, limit: 100 }, chat_messages: { used: 44, limit: 100 } };

function msg(id: number, role: "user" | "assistant", content: string) {
  return { id, session_id: "main", role, content, created_at: "2026-01-01T00:00:00" };
}

function renderFresh() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ChatPage />
    </SWRConfig>,
  );
}

describe("ChatPage", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    replace.mockReset();
    search = "";
    history = [];
    usage = { analysis_runs: { used: 0, limit: 100 }, chat_messages: { used: 44, limit: 100 } };
    apiFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === HISTORY_PATH && (!init || !init.method)) return history;
      if (path === "/me/usage") return usage;
      throw new Error(`unexpected ${init?.method ?? "GET"} ${path}`);
    });
  });

  it("shows starters when empty, and the usage meter", async () => {
    renderFresh();

    expect(await screen.findByText("How is my portfolio doing?")).toBeInTheDocument();
    expect(await screen.findByText("44 / 100")).toBeInTheDocument();
    expect(screen.getByText(/advisory only/i)).toBeInTheDocument();
  });

  it("shows the stored conversation", async () => {
    history = [msg(1, "user", "Why TRIM on NVDA?"), msg(2, "assistant", "It scores **52**.")];
    renderFresh();

    expect(await screen.findByText("Why TRIM on NVDA?")).toBeInTheDocument();
    expect(await screen.findByText("52")).toBeInTheDocument();
    expect(screen.queryByText("How is my portfolio doing?")).not.toBeInTheDocument();
  });

  it("sends a message, shows it at once, then the reply", async () => {
    let release: (value: unknown) => void = () => {};
    apiFetch.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
      if (path === HISTORY_PATH) return history;
      if (path === "/me/usage") return usage;
      if (path === "/chat" && init?.method === "POST") {
        await new Promise((resolve) => (release = resolve));
        history = [msg(1, "user", "hello"), msg(2, "assistant", "Hi there.")];
        return { session_id: "main", message: "Hi there." };
      }
      throw new Error(`unexpected ${path}`);
    });
    renderFresh();

    fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("hello")).toBeInTheDocument();
    expect(screen.getByText(/thinking/i)).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/chat", {
      method: "POST",
      body: JSON.stringify({ session_id: "main", message: "hello" }),
    });

    release(null);
    expect(await screen.findByText("Hi there.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/thinking/i)).not.toBeInTheDocument());
  });

  it("sends a starter when tapped", async () => {
    apiFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === HISTORY_PATH) return history;
      if (path === "/me/usage") return usage;
      if (path === "/chat" && init?.method === "POST") return { session_id: "main", message: "ok" };
      throw new Error(`unexpected ${path}`);
    });
    renderFresh();

    fireEvent.click(await screen.findByText("Which holding has the most risk?"));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/chat", {
        method: "POST",
        body: JSON.stringify({ session_id: "main", message: "Which holding has the most risk?" }),
      }),
    );
  });

  it("puts the text back and shows an error when a send fails", async () => {
    apiFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === HISTORY_PATH) return history;
      if (path === "/me/usage") return usage;
      if (path === "/chat" && init?.method === "POST") throw new FakeApiError(500, "boom");
      throw new Error(`unexpected ${path}`);
    });
    renderFresh();

    fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(/could not get a reply/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toHaveValue("hello");
  });

  it("explains a reached monthly limit and disables the box", async () => {
    usage = { analysis_runs: { used: 0, limit: 100 }, chat_messages: { used: 100, limit: 100 } };
    history = [msg(1, "user", "earlier"), msg(2, "assistant", "An earlier answer.")];
    renderFresh();

    expect(await screen.findByText(/you've used all 100 chat messages this month/i)).toBeInTheDocument();
    expect(screen.getByText(/ask the administrator/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeDisabled();
    expect(screen.getByText("An earlier answer.")).toBeInTheDocument();
  });

  it("switches to the limit state when the server answers with the monthly 429", async () => {
    apiFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === HISTORY_PATH) return history;
      if (path === "/me/usage") return usage;
      if (path === "/chat" && init?.method === "POST") {
        throw new FakeApiError(429, "Monthly limit reached (100 chat messages this month).");
      }
      throw new Error(`unexpected ${path}`);
    });
    renderFresh();

    fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "one more" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(/ask the administrator/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeDisabled();
  });

  it("clears the conversation after a confirmation", async () => {
    history = [msg(1, "user", "hello"), msg(2, "assistant", "Hi.")];
    apiFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === HISTORY_PATH && init?.method === "DELETE") {
        history = [];
        return undefined;
      }
      if (path === HISTORY_PATH) return history;
      if (path === "/me/usage") return usage;
      throw new Error(`unexpected ${path}`);
    });
    renderFresh();

    // The button is disabled until the history has loaded.
    await screen.findByText("Hi.");
    fireEvent.click(screen.getByRole("button", { name: /clear chat/i }));
    expect(await screen.findByText(/cannot be undone/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith(HISTORY_PATH, expect.objectContaining({ method: "DELETE" }));

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(HISTORY_PATH, { method: "DELETE" }),
    );
    expect(await screen.findByText("How is my portfolio doing?")).toBeInTheDocument();
  });

  it("prefills the box from ?ask= without sending, and tidies the URL", async () => {
    search = "ask=Why%20WATCH%20on%20KO%3F";
    renderFresh();

    expect(await screen.findByLabelText("Message")).toHaveValue("Why WATCH on KO?");
    expect(apiFetch).not.toHaveBeenCalledWith("/chat", expect.anything());
    expect(replace).toHaveBeenCalledWith("/chat");
  });
});
