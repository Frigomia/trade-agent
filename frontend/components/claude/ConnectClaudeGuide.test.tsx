import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";

const apiFetch = vi.fn();
const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    detail: string;
    code?: string;
    constructor(status: number, detail: string, code?: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
      this.code = code;
    }
  }
  return { FakeApiError };
});
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: FakeApiError,
}));

const replace = vi.fn();
const push = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  useSearchParams: () => new URLSearchParams(search),
}));

import { ConnectClaudeGuide } from "./ConnectClaudeGuide";

const NOT_CONNECTED = { connected: false, last4: null, needs_attention: false };
const KEY = "sk-ant-api03-SECRETSECRET-a1b2";
const REJECTED = "Anthropic did not accept this key. Check that you copied all of it, then try again.";

function renderGuide(step?: string) {
  search = step === undefined ? "" : `step=${step}`;
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ConnectClaudeGuide />
    </SWRConfig>,
  );
}

function type(value: string) {
  fireEvent.change(screen.getByLabelText(/claude api key/i), { target: { value } });
}

describe("ConnectClaudeGuide", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    replace.mockReset();
    push.mockReset();
    apiFetch.mockResolvedValue(NOT_CONNECTED);
  });

  it("starts on step 1 with no Back, the label, title, text and a safe external link", () => {
    renderGuide();
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Create an Anthropic account" })).toBeInTheDocument();
    expect(screen.getByText(/sign up at platform.claude.com/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: /open platform.claude.com/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("clamps ?step= to 1-5 and defaults to 1", () => {
    const { unmount } = renderGuide("9");
    expect(screen.getByText("Step 5 of 5")).toBeInTheDocument();
    unmount();
    const second = renderGuide("0");
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
    second.unmount();
    renderGuide("abc");
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
  });

  it("writes the step to the address when moving on and back", () => {
    renderGuide("2");
    fireEvent.click(screen.getByRole("button", { name: "I have the key, next" }));
    expect(replace).toHaveBeenLastCalledWith("/more/connect-claude?step=3");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(replace).toHaveBeenLastCalledWith("/more/connect-claude?step=1");
  });

  it("rail: earlier steps are buttons that jump back, the current is marked, later ones are inert", () => {
    renderGuide("3");
    const rail = screen.getByRole("navigation", { name: /steps/i });
    fireEvent.click(within(rail).getByRole("button", { name: /create an anthropic account/i }));
    expect(replace).toHaveBeenLastCalledWith("/more/connect-claude?step=1");
    expect(within(rail).getByText("Set a monthly spend limit").closest("[aria-current]")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(within(rail).queryByRole("button", { name: /create a key/i })).not.toBeInTheDocument();
    expect(within(rail).queryByRole("button", { name: /paste it here/i })).not.toBeInTheDocument();
    expect(within(rail).getAllByTestId("step-check")).toHaveLength(2);
  });

  it("step 5: a password field that is not remembered, disabled until it has content", () => {
    renderGuide("5");
    const field = screen.getByLabelText(/claude api key/i);
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAttribute("autocomplete", "off");
    expect(field).toHaveAttribute("spellcheck", "false");
    expect(screen.getByRole("button", { name: "Check and save" })).toBeDisabled();
    type("x");
    expect(screen.getByRole("button", { name: "Check and save" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "I have the key, next" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("shows the reassurance note on every step", () => {
    const { unmount } = renderGuide("1");
    expect(screen.getByText(/stored encrypted\. used only for your own analyses and chat/i)).toBeInTheDocument();
    unmount();
    renderGuide("5");
    expect(screen.getByText(/never places trades/i)).toBeInTheDocument();
  });

  it("saves, shows checking while in flight, then the connected state with the last four and no field", async () => {
    let finish: (v: unknown) => void = () => {};
    let saved = false;
    apiFetch.mockImplementation((path: string, init?: { method?: string }) =>
      init?.method === "PUT"
        ? new Promise((resolve) => {
            finish = (v) => {
              saved = true;
              resolve(v);
            };
          })
        : Promise.resolve(saved ? { connected: true, last4: "a1b2", needs_attention: false } : NOT_CONNECTED),
    );
    renderGuide("5");
    type(KEY);
    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    expect(await screen.findByRole("button", { name: "Checking with Anthropic…" })).toBeDisabled();
    expect(apiFetch).toHaveBeenCalledWith("/me/claude-key", {
      method: "PUT",
      body: JSON.stringify({ api_key: KEY }),
    });
    finish({ connected: true, last4: "a1b2", needs_attention: false });
    expect(await screen.findByRole("heading", { name: "Claude is connected" })).toBeInTheDocument();
    expect(screen.getByText("sk-ant-…a1b2")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.queryByLabelText(/claude api key/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to Today" }));
    expect(push).toHaveBeenCalledWith("/today");
  });

  it("shows the fixed line for invalid_key, tied to the field, without echoing the key", async () => {
    apiFetch.mockImplementation((path: string, init?: { method?: string }) =>
      init?.method === "PUT"
        ? Promise.reject(new FakeApiError(422, `bad ${KEY}`, "invalid_key"))
        : Promise.resolve(NOT_CONNECTED),
    );
    renderGuide("5");
    type(KEY);
    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    const msg = await screen.findByText(REJECTED);
    const field = screen.getByLabelText(/claude api key/i);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field.getAttribute("aria-describedby")).toContain(msg.id);
    expect(msg).toHaveAttribute("role", "alert");
    expect(msg.textContent).toBe(REJECTED);
  });

  it("shows the backend message for other rejections and keeps what was typed on a failure", async () => {
    apiFetch.mockImplementation((path: string, init?: { method?: string }) =>
      init?.method === "PUT"
        ? Promise.reject(new FakeApiError(502, "Anthropic could not be reached. Try again.", "anthropic_unreachable"))
        : Promise.resolve(NOT_CONNECTED),
    );
    renderGuide("5");
    type(KEY);
    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    expect(await screen.findByText("Anthropic could not be reached. Try again.")).toBeInTheDocument();
    expect((screen.getByLabelText(/claude api key/i) as HTMLInputElement).value).toBe(KEY);
    await waitFor(() => expect(screen.getByRole("button", { name: "Check and save" })).toBeEnabled());
  });

  it("Back from step 5 removes the field; coming forward again shows an empty one", () => {
    // replace updates the address like the real router, then we render again.
    replace.mockImplementation((url: string) => {
      search = url.split("?")[1];
    });
    const { rerender } = renderGuide("5");
    const again = () =>
      rerender(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <ConnectClaudeGuide />
        </SWRConfig>,
      );
    type(KEY);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    again();
    expect(screen.getByText("Step 4 of 5")).toBeInTheDocument();
    expect(screen.queryByLabelText(/claude api key/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "I have the key, next" }));
    again();
    expect((screen.getByLabelText(/claude api key/i) as HTMLInputElement).value).toBe("");
  });

  it("moves focus to the step heading on a step change, and to the key field on step 5", () => {
    replace.mockImplementation((url: string) => {
      search = url.split("?")[1];
    });
    const { rerender } = renderGuide("3");
    const again = () =>
      rerender(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <ConnectClaudeGuide />
        </SWRConfig>,
      );
    fireEvent.click(screen.getByRole("button", { name: "I have the key, next" }));
    again();
    expect(screen.getByRole("heading", { level: 2, name: "Create a key" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "I have the key, next" }));
    again();
    expect(screen.getByLabelText(/claude api key/i)).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    again();
    expect(screen.getByRole("heading", { level: 2, name: "Create a key" })).toHaveFocus();
  });

  it.each([
    ["a save", { connected: true, last4: "a1b2", needs_attention: false }, null],
    ["a rejected save", null, new FakeApiError(422, `bad ${KEY}`, "invalid_key")],
  ])("never puts the key in the address or in storage after %s", async (_n, ok, failure) => {
    apiFetch.mockImplementation((path: string, init?: { method?: string }) =>
      init?.method === "PUT" ? (failure ? Promise.reject(failure) : Promise.resolve(ok)) : Promise.resolve(NOT_CONNECTED),
    );
    renderGuide("5");
    type(KEY);
    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/me/claude-key", expect.objectContaining({ method: "PUT" })));
    await screen.findByText(ok ? "Claude is connected" : REJECTED);
    for (const call of [...replace.mock.calls, ...push.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain("SECRET");
    }
    expect(JSON.stringify({ ...localStorage })).not.toContain("SECRET");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("SECRET");
    expect(window.location.href).not.toContain("SECRET");
  });
});

describe("ConnectClaudeGuide links", () => {
  it.each([
    ["1", /open platform\.claude\.com/i, "https://platform.claude.com"],
    ["2", /open billing$/i, "https://platform.claude.com/settings/billing"],
    ["3", /open billing settings/i, "https://platform.claude.com/settings/billing"],
    ["4", /open api keys/i, "https://platform.claude.com/settings/keys"],
  ])("step %s points at the right page", (step, name, href) => {
    apiFetch.mockResolvedValue(NOT_CONNECTED);
    search = `step=${step}`;
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ConnectClaudeGuide />
      </SWRConfig>,
    );
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
  });
});
